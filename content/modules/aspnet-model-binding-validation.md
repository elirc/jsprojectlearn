# Model binding and validation in ASP.NET Core

Most "my endpoint gets null" and "validation does nothing" bugs in .NET are
model-binding bugs. Interviewers probe it because the answer shows whether you
understand where each parameter value comes from, what the JSON serializer
does with casing, and how you stop a client setting fields it should never
touch.

## Where values come from

Binding turns parts of the HTTP request into typed parameters. Each attribute
names a source explicitly:

| Attribute | Source | Typical use |
|-----------|--------|-------------|
| `[FromRoute]` | Route template values | `/orders/{id}` |
| `[FromQuery]` | Query string | paging, filters |
| `[FromHeader]` | A request header | `If-Match`, idempotency keys |
| `[FromBody]` | Request body, via the JSON input formatter | create/update DTOs |
| `[FromForm]` | `application/x-www-form-urlencoded` or multipart | HTML forms, `IFormFile` |
| `[FromServices]` | The DI container | services in an action or handler |
| `[AsParameters]` | Minimal APIs: expands a type's properties into parameters | grouping many query values |

```cs
app.MapGet("/orders/{customerId:int}", (
    int customerId,                              // route (name matches template)
    [FromQuery(Name = "status")] OrderStatus? s, // query ?status=Shipped
    [FromHeader(Name = "X-Tenant")] string tenant,
    OrderService orders) => orders.List(customerId, s, tenant));
```

## Inference: minimal APIs vs controllers

You rarely write every attribute, because both styles infer a source. The rules
differ slightly.

**Minimal APIs** apply these rules in order: an explicit attribute wins; then
special types (`HttpContext`, `HttpRequest`, `CancellationToken`,
`ClaimsPrincipal`); then a type with `BindAsync`; then a string or a type with
`TryParse` comes from the route if the name matches a route parameter,
otherwise the query string; then a type registered in DI comes from services;
anything left over comes from the JSON body. `IFormFile` binds from the form.

**Controllers with `[ApiController]`** infer: complex types from the body,
`IFormFile`/`IFormFileCollection` from the form, names in the route template
from the route, registered services from DI, everything else from the query.
Without `[ApiController]`, MVC tries form, route and query for every parameter
and never reads JSON unless you say `[FromBody]` — the classic "my POST model
is all nulls" bug.

`[AsParameters]` keeps handlers tidy when a query has many values:

```cs
public record OrderQuery(int Page = 1, int PageSize = 20, string? Sort = null, [FromHeader(Name = "X-Tenant")] string? Tenant = null);

app.MapGet("/orders", ([AsParameters] OrderQuery q, OrderService orders) => orders.Search(q));
```

## Only one body

A request has one body stream, and it can be read once. So an action or handler
can have **only one** body-bound parameter. Minimal APIs fail at startup if two
parameters are inferred as body; MVC rejects a second `[FromBody]`. If you want
two objects, wrap them in one DTO. Mixing a JSON body with form fields in the
same request is not supported either.

The body is also read in full before your code runs, which is why a missing
`Content-Type: application/json` header produces a 415 Unsupported Media Type
rather than reaching your handler.

## Custom binding: TryParse and BindAsync

For value-like types, add a static `TryParse` and the type becomes bindable
from route, query and header in minimal APIs:

```cs
public readonly record struct Sku(string Value)
{
    public static bool TryParse(string? input, IFormatProvider? provider, out Sku sku)
    {
        sku = default;
        if (string.IsNullOrWhiteSpace(input) || input.Length != 8) return false;
        sku = new Sku(input.ToUpperInvariant());
        return true;
    }
}

app.MapGet("/products/{sku}", (Sku sku) => ...);   // "abc" -> 400, never reaches the handler
```

When a value needs the whole request — several headers, the user, a cookie —
implement `BindAsync`:

```cs
public sealed record Paging(int Page, int Size)
{
    public static ValueTask<Paging?> BindAsync(HttpContext ctx, ParameterInfo parameter)
    {
        int.TryParse(ctx.Request.Query["page"], out var page);
        int.TryParse(ctx.Request.Query["size"], out var size);
        return ValueTask.FromResult<Paging?>(new(Math.Max(page, 1), Math.Clamp(size, 1, 100)));
    }
}
```

MVC also honours `TryParse` for simple-type binding, and has its own heavier
extension point in `IModelBinder`.

## JSON: the web defaults

ASP.NET Core configures `System.Text.Json` with `JsonSerializerDefaults.Web`:

- **camelCase** property names on output (`OrderId` becomes `orderId`).
- **Case-insensitive** matching on input, so `{"ORDERID": 5}` still binds.
- Numbers may be read from strings (`"5"` binds to an `int`).
- Enums serialize as **numbers** unless you add `JsonStringEnumConverter`.

```cs
builder.Services.ConfigureHttpJsonOptions(o =>                 // minimal APIs
    o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));

builder.Services.AddControllers().AddJsonOptions(o =>          // controllers
    o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
```

The two are separate settings; configuring one does not affect the other. A
bare `new JsonSerializerOptions()` in your own code does *not* get the web
defaults — use `new JsonSerializerOptions(JsonSerializerDefaults.Web)`.

## DataAnnotations, FluentValidation and ModelState

**DataAnnotations** (`[Required]`, `[StringLength]`, `[Range]`,
`[EmailAddress]`, `IValidatableObject` for cross-field rules) run
automatically in MVC after binding. Results land in `ModelState`, a dictionary
of keys to errors. With `[ApiController]` an invalid `ModelState` returns 400
before your action runs; without it you must check:

```cs
if (!ModelState.IsValid) return ValidationProblem(ModelState);
```

You can add your own errors, e.g. after a uniqueness check:
`ModelState.AddModelError(nameof(dto.Email), "Already registered.");`.
Minimal APIs get attribute validation only from .NET 10's
`builder.Services.AddValidation()`; see
[minimal-apis-vs-controllers.md](minimal-apis-vs-controllers.md).

**FluentValidation** keeps rules in a separate class, which suits complex or
database-dependent rules. Its old ASP.NET auto-validation package is
deprecated; the maintainers recommend calling the validator yourself:

```cs
app.MapPost("/customers", async (CreateCustomer dto, IValidator<CreateCustomer> validator, CustomerService svc) =>
{
    var result = await validator.ValidateAsync(dto);
    if (!result.IsValid)
        return Results.ValidationProblem(result.ToDictionary());
    return Results.Created($"/customers/{await svc.CreateAsync(dto)}", null);
});
```

Wrap that in a generic endpoint filter or MVC action filter if you want it on
every endpoint. The [model binding project](../../csharp/17-model-binding-validation/)
practises both.

## The ValidationProblemDetails shape

Validation errors come back as RFC 9457 problem details with an extra
`errors` member:

```http
HTTP/1.1 400 Bad Request
Content-Type: application/problem+json
```

```json
{
  "type": "https://tools.ietf.org/html/rfc9110#section-15.5.1",
  "title": "One or more validation errors occurred.",
  "status": 400,
  "errors": {
    "Title": ["The Title field is required."],
    "Priority": ["The field Priority must be between 1 and 5."]
  },
  "traceId": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
}
```

`errors` maps a field to an array of messages, so a client can show each one
beside its input. Malformed JSON produces keys like `$.priority` and a
serializer message. By default MVC keys use C# property names; if the frontend
expects `title`, register `SystemTextJsonValidationMetadataProvider` in
`options.ModelMetadataDetailsProviders` so keys follow the JSON names. Error
body design in general is in [rest-api-design.md](rest-api-design.md).

## Overposting and DTOs

Bind an EF entity directly and the client can set any property it can name:

```json
{ "name": "Ana", "isAdmin": true, "accountBalance": 1000000 }
```

This is overposting (mass assignment). Bind to a request DTO that contains only
the fields the client may set, then map onto the entity:

```cs
public sealed record UpdateProfile([Required, StringLength(100)] string Name, string? Bio);
```

DTOs also decouple your API contract from your schema, so a column rename does
not break clients, and stop you serialising navigation properties into cycles.

## Nullable reference types mean required

With `<Nullable>enable</Nullable>` (the template default), a non-nullable
reference-type property on an MVC model is treated as if it had `[Required]`.
`string Name` missing from the body gives "The Name field is required.";
`string? Bio` is optional. In minimal APIs, a non-nullable parameter that is
missing (`int page` with no `?page=`) returns 400; make it `int? page` or give
it a default.

Value types are the gap: a missing `int Quantity` in a JSON body binds to `0`,
and `[Required]` cannot tell 0 from absent. Use `int?` with `[Required]`, or a
`[Range]` that excludes 0. The C# `required` modifier is enforced by
`System.Text.Json`, so a missing `required` property fails deserialisation.

## What you should be able to answer

- How does a minimal API decide whether a parameter comes from the route, query, services or body? How does `[ApiController]` differ?
- Why can a handler have only one body parameter, and what do you do if you need two objects?
- When would you implement `TryParse` versus `BindAsync` on a type?
- What are the System.Text.Json web defaults, and how do you make enums serialize as strings?
- What is overposting and how do DTOs prevent it?
- Why might `[Required] int Quantity` not catch a missing value, and how does nullable reference type annotation affect validation?
