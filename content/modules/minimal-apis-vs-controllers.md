# Minimal APIs vs controllers

Every new ASP.NET Core project makes this choice, and interviewers use it to
find out whether you know *why* each style exists rather than which one you saw
in a tutorial. A strong answer names concrete features — typed results, route
groups, filters, `[ApiController]` behaviours, .NET 10 validation — and ends
with "it depends on these three things", not with a preference.

## The same endpoint, twice

```cs
// Minimal API
app.MapGet("/todos/{id:int}", async Task<Results<Ok<TodoDto>, NotFound>> (int id, AppDbContext db) =>
    await db.Todos.FindAsync(id) is { } todo
        ? TypedResults.Ok(TodoDto.From(todo))
        : TypedResults.NotFound());
```

```cs
// Controller
[ApiController]
[Route("todos")]
public sealed class TodosController(AppDbContext db) : ControllerBase
{
    [HttpGet("{id:int}")]
    public async Task<ActionResult<TodoDto>> Get(int id)
    {
        var todo = await db.Todos.FindAsync(id);
        return todo is null ? NotFound() : TodoDto.From(todo);
    }
}
```

Both run on the same routing, the same DI container, the same middleware
pipeline (see [aspnet-middleware-pipeline.md](aspnet-middleware-pipeline.md))
and the same authentication. The differences are in how handlers are
discovered, how cross-cutting behaviour attaches, and what the framework does
for you by default. A controller is created per request with its dependencies
in the constructor; a minimal API handler is a delegate whose parameters are
bound per request.

## The trade-offs at a glance

| Concern | Minimal APIs | Controllers |
|---------|--------------|-------------|
| Discovery | Explicit `Map...` calls | Reflection over `ControllerBase` types |
| Ceremony | Low — a lambda or static method | A class, attributes, action methods |
| Cross-cutting | Endpoint filters, route groups | Filter pipeline (authorization, resource, action, exception, result) |
| Validation | .NET 10: `AddValidation()`; earlier: do it yourself | `[ApiController]` automatic 400 |
| Native AOT | Supported (request delegate source generator) | Not supported |
| Model-binding extensibility | `TryParse`/`BindAsync` on the type | Also `IModelBinder` providers, value providers |
| Content negotiation | JSON only out of the box | Output formatters (e.g. XML) |
| Template default | `dotnet new webapi` | `dotnet new webapi --use-controllers` |

Minimal APIs are marginally faster, but performance is rarely the deciding
factor for a CRUD app; the database dominates.

## TypedResults and Results unions

`Results.Ok(x)` returns `IResult`, which tells OpenAPI nothing about the
response. `TypedResults.Ok(x)` returns `Ok<T>`, a concrete type the OpenAPI
generator can read. When a handler has several outcomes, declare them as a
union:

```cs
static async Task<Results<Created<TodoDto>, ValidationProblem, Conflict>> Create(
    CreateTodo input, TodoService todos)
{
    var result = await todos.CreateAsync(input);
    return result switch
    {
        { IsDuplicate: true } => TypedResults.Conflict(),
        { Errors: { } errors } => TypedResults.ValidationProblem(errors),
        _ => TypedResults.Created($"/todos/{result.Todo!.Id}", result.Todo)
    };
}
```

`Results<T1, ..., T6>` accepts up to six result types, and the compiler now
checks you only return one of them. The OpenAPI document lists 201, 400 and 409
without any `.Produces(...)` calls. It also makes unit testing easy: call the
static method and assert the result type. In .NET 9+, templates use
`Microsoft.AspNetCore.OpenApi` (`builder.Services.AddOpenApi()` and
`app.MapOpenApi()`) rather than Swashbuckle.

Controllers get similar metadata from `ActionResult<T>` plus
`[ProducesResponseType]` attributes, which you maintain by hand.

## MapGroup and organising by feature

The complaint "minimal APIs turn `Program.cs` into a 2,000-line file" is about
organisation, not the style. Put each feature in an extension method and use a
route group for the shared prefix and metadata:

```cs
public static class TodoEndpoints
{
    public static RouteGroupBuilder MapTodos(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/todos")
            .WithTags("Todos")
            .RequireAuthorization();

        group.MapGet("/", GetAll);
        group.MapGet("/{id:int}", GetById).WithName("GetTodo");
        group.MapPost("/", Create);
        group.MapDelete("/{id:int}", Delete).RequireAuthorization("AdminOnly");
        return group;
    }

    static async Task<Ok<List<TodoDto>>> GetAll(TodoService todos) =>
        TypedResults.Ok(await todos.ListAsync());
    // GetById, Create, Delete ...
}

// Program.cs
app.MapTodos();
```

Groups nest, and anything applied to a group — authorization, filters, rate
limiting, OpenAPI tags — applies to every endpoint in it. Named static methods
beat lambdas once handlers exceed a few lines: they show up in stack traces and
can be unit tested. The [minimal API project](../../csharp/15-minimal-api-todo/)
starts from this shape.

## Endpoint filters vs action filters

Endpoint filters are the minimal API equivalent of action filters: they wrap
the handler, can inspect arguments, short-circuit, or change the result.

```cs
public sealed class RequireIfMatchFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        if (!context.HttpContext.Request.Headers.ContainsKey("If-Match"))
            return TypedResults.Problem(statusCode: StatusCodes.Status428PreconditionRequired);

        return await next(context);
    }
}

group.MapPut("/{id:int}", Update).AddEndpointFilter<RequireIfMatchFilter>();
```

`context.Arguments` holds the bound parameters, and `context.GetArgument<T>(i)`
reads one by position. Filters run in the order added, outermost first, with
group filters wrapping endpoint filters.

MVC's filter pipeline is richer: authorization filters, resource filters
(which run before model binding — useful for caching), action filters with
access to `ModelState` and `ActionArguments`, exception filters and result
filters. Filters can be global (`options.Filters.Add<T>()`), per controller or
per action. If you rely on several of those stages, that is a real point for
controllers.

## What [ApiController] does for you

The attribute changes behaviour, not just metadata:

- **Automatic 400.** If `ModelState` is invalid after binding and validation,
  the action never runs; the client gets a `ValidationProblemDetails` response.
  You can turn it off with
  `ConfigureApiBehaviorOptions(o => o.SuppressModelStateInvalidFilter = true)`.
- **Binding source inference.** Complex types come from the body, `IFormFile`
  from the form, parameters whose names appear in the route template from the
  route, registered services from DI, and everything else from the query string.
- **ProblemDetails for errors.** `return NotFound();` produces an RFC 9457 body
  rather than an empty response.
- **Attribute routing required.** Conventional routes do not reach
  `[ApiController]` types.

Without the attribute, an invalid model still reaches your action and you must
check `ModelState.IsValid` yourself — a common source of "validation does
nothing" bugs. Binding details are in
[aspnet-model-binding-validation.md](aspnet-model-binding-validation.md).

## Validation in minimal APIs, .NET 10 and before

Before .NET 10, minimal APIs ran no validation at all: DataAnnotations on a
record were silently ignored. You called a validator in the handler or wrote an
endpoint filter to do it.

.NET 10 adds built-in validation:

```cs
builder.Services.AddValidation();

public record CreateTodo([Required, StringLength(200)] string Title, [Range(1, 5)] int Priority);

app.MapPost("/todos", (CreateTodo input) => TypedResults.Created($"/todos/1", input));
// invalid input -> 400 with a ValidationProblemDetails body, handler never runs
```

A source generator discovers the types used as parameters and validates
DataAnnotations attributes on query, header and body parameters, including
nested objects and collections. Opt a single endpoint out with
`.DisableValidation()`. This closes the biggest behavioural gap between the two
styles.

## When controllers still win

Pick controllers when:

- The team already has a large controller codebase and conventions; mixing
  styles in one project has a cost.
- You lean heavily on the MVC filter pipeline, custom `IModelBinder`s, or
  content negotiation with multiple output formatters.
- You are on .NET 8 or 9 and want validation-by-attribute without writing a
  filter.
- You serve views (MVC or Razor Pages) from the same app.

Pick minimal APIs when you are starting fresh, want Native AOT or small
containers, or prefer explicit wiring you can read top to bottom. Both are
fully supported and you can mix them in one app — `MapControllers()` and
`MapGet()` live side by side.

## What you should be able to answer

- What does `TypedResults` give you over `Results`, and what is `Results<T1, T2>` for?
- How do you stop a minimal API project from collapsing into one huge `Program.cs`?
- Compare endpoint filters with MVC action filters. What can the MVC filter pipeline do that endpoint filters cannot?
- List three things `[ApiController]` changes about a controller's behaviour.
- How is validation handled in minimal APIs in .NET 10 versus .NET 8?
- Given a new CRUD API, which style would you choose and what would change your mind?
