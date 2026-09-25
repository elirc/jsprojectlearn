# Designing API errors with problem details

Anyone can return a 200. Interviewers learn far more from how you design the
failure path: what the client can branch on, what the user sees, what support
can trace, and what an attacker learns.

## RFC 9457 in one screen

RFC 9457 (July 2023, replacing RFC 7807 with the same shape) defines a JSON
error format served with the media type `application/problem+json`. It has five
standard members, all optional:

| Member | Meaning | Rule of thumb |
|---|---|---|
| `type` | URI identifying the *kind* of problem | Stable forever; clients branch on it. Defaults to `about:blank` |
| `title` | Short human summary of the type | Same for every occurrence of that type; do not interpolate values |
| `status` | The HTTP status code, repeated | Must match the real status line; it is advisory, for logs and proxies that strip headers |
| `detail` | Human explanation of *this* occurrence | Written for the end user or developer, never parsed by code |
| `instance` | URI identifying this occurrence | Often the request path, or a URN of the error id |

Anything else is an **extension member**: an `errors` map for validation, a
`traceId` for correlation, or data the client needs, such as `balance` below.

```json
{
  "type": "https://api.example.com/problems/insufficient-funds",
  "title": "Insufficient funds",
  "status": 409,
  "detail": "Your balance of £30.00 is less than the £45.00 required.",
  "instance": "/api/transfers/7f3a",
  "code": "INSUFFICIENT_FUNDS",
  "balance": 3000,
  "traceId": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
}
```

The `type` URI need not resolve, but if it does it should point at human
documentation. A client that does not recognise a `type` falls back to the
status code, which is what makes the format safe to evolve.

## Stable machine-readable codes

The most important property of an error contract: **no client ever matches on
English prose**. You will reword and translate `detail`; any
`if (msg.includes('already exists'))` then breaks silently. The `type` URI or a
`code` extension is the branchable identifier. Treat codes as public API:

- Name them by the domain condition, not the exception class:
  `EMAIL_TAKEN`, not `DbUpdateException`.
- Never rename or reuse one. Deprecate and add a new one.
- Keep the catalogue small and documented.
- The status code gives the category; the code gives the case. `409` +
  `EMAIL_TAKEN` and `409` + `VERSION_CONFLICT` need different UI.

## Validation errors that map back to form fields

The client's job here is specific: put each message beside the right input.
The ASP.NET Core convention, easy to copy in Node, is an `errors` object keyed
by field path, each value an array of messages:

```json
{
  "type": "https://api.example.com/problems/validation",
  "title": "One or more validation errors occurred.",
  "status": 400,
  "errors": {
    "email": ["Enter a valid email address."],
    "items[0].quantity": ["Must be between 1 and 99."]
  },
  "traceId": "00-..."
}
```

Decisions to make once and keep:

- **Keys match the JSON the client sent** (`email`, not `Email`). MVC keys
  model state by C# property name unless you register
  `SystemTextJsonValidationMetadataProvider`; check what yours emits.
- **Nested paths use one predictable syntax** (`items[0].quantity`).
- **Return every failure at once**, not the first.
- Use `""` or a reserved key for errors that belong to the whole object
  ("end date must be after start date").

In React 19 with React Hook Form, the mapping is a loop:

```tsx
async function onSubmit(values: OrderForm) {
  const res = await fetch('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(values),
  });
  if (res.ok) return navigate('/orders');

  const problem = await readProblem(res);
  if (problem.errors) {
    for (const [field, messages] of Object.entries(problem.errors)) {
      const path = field.replace(/\[(\d+)\]/g, '.$1'); // items[0].x -> items.0.x
      setError(path as FieldPath<OrderForm>, { message: messages[0] });
    }
  } else {
    setError('root.server', { message: problem.title });
  }
}
```

Server validation is authoritative; client-side rules are a copy for speed.
When they disagree, this loop is what keeps the user unstuck. See
[the model binding guide](aspnet-model-binding-validation.md) for where the
.NET side of this comes from.

## 4xx versus 5xx: what goes in the body

The status class decides who the message is for and how much you can say.

| | 4xx | 5xx |
|---|---|---|
| Whose fault | The client's | Yours |
| `detail` | Specific and actionable: which field, which limit | Generic: "An unexpected error occurred." |
| Codes | Rich domain codes the UI branches on | One or two (`INTERNAL`, `DEPENDENCY_UNAVAILABLE`) |
| Retry? | Not unchanged (except 408, 409 after refetch, 429 after waiting) | Maybe, with backoff, if the method is idempotent |
| `traceId` | Yes | Essential |

What **never** leaks, in any status: stack traces, exception type names, SQL
text or constraint names, file paths, internal hostnames, library versions,
and whether an account exists (login and password-reset errors must be
identical for "no such user" and "wrong password"). A unique-constraint
violation becomes `409 EMAIL_TAKEN`, not
`duplicate key value violates unique constraint "ix_users_email"`.

A `403` confirms the resource exists; when that matters, return the same `404`
problem as for a missing record. Statuses in full:
[HTTP status codes in depth](http-status-codes-in-depth.md).

## Correlation: the traceId is the bridge

The client sees a generic 500; your logs have the exception. The `traceId` is
the only thing joining them, so it must be the identifier your logs and traces
already use. ASP.NET Core writes `Activity.Current?.Id` (a W3C `traceparent`
value) by default. In Node, use the OpenTelemetry trace id, or a per-request
UUID from middleware, and put it in every log line for that request.

Show it to the user ("Reference: 4bf92f35") so support tickets carry it. Log
5xx at error level with the full exception; log 4xx at information level
without the stack, or your alerts drown in typos. [Logging and observability](logging-and-observability.md) and
[the .NET OpenTelemetry guide](dotnet-logging-opentelemetry.md) cover the
pipeline.

## ASP.NET Core: AddProblemDetails, IExceptionHandler, ValidationProblem

Since .NET 8 the pieces are built in. `AddProblemDetails()` produces problem
details for unhandled exceptions and empty error responses; `IExceptionHandler`
translates known domain exceptions into specific problems.

```csharp
builder.Services.AddProblemDetails();   // adds traceId to every problem by default
builder.Services.AddExceptionHandler<DomainExceptionHandler>();

var app = builder.Build();
app.UseExceptionHandler();      // uses the handlers above
app.UseStatusCodePages();       // bare 404/405 become problem details too

public sealed class DomainExceptionHandler(IProblemDetailsService problems)
    : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext http, Exception ex, CancellationToken ct)
    {
        if (ex is not InsufficientFundsException e) return false; // next handler / default 500

        http.Response.StatusCode = StatusCodes.Status409Conflict;
        return await problems.TryWriteAsync(new()
        {
            HttpContext = http,
            Exception = ex,
            ProblemDetails =
            {
                Type = "https://api.example.com/problems/insufficient-funds",
                Title = "Insufficient funds",
                Status = 409,
                Detail = e.Message,
                Extensions = { ["code"] = "INSUFFICIENT_FUNDS" },
            },
        });
    }
}
```

For validation, `[ApiController]` returns a `ValidationProblemDetails` 400
automatically when model state is invalid. In minimal APIs, .NET 10's built-in
validation (`AddValidation()`) does the same for annotated parameters, or you
return it yourself:

```csharp
if (errors.Count > 0)
    return TypedResults.ValidationProblem(errors); // IDictionary<string, string[]>
```

In Development the developer exception page replaces all of this, so test the
production path explicitly. The project
[../../csharp/20-error-handling-problemdetails/](../../csharp/20-error-handling-problemdetails/)
builds this end to end.

## Express 5: one error middleware

Express 5 forwards rejected promises from async handlers to error middleware,
so `express-async-errors` is gone. Throw typed errors; translate them once:

```js
export class ProblemError extends Error {
  constructor(status, code, title, detail, extra = {}) {
    super(detail ?? title);
    Object.assign(this, { status, code, title, detail, extra });
  }
}

// last middleware, after all routes
export function problemHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const traceId = req.id; // set by request-id middleware
  const known = err instanceof ProblemError;
  const status = known ? err.status : err.type === 'entity.parse.failed' ? 400 : 500;

  if (status >= 500) req.log.error({ err, traceId }, 'unhandled error');
  else req.log.info({ code: err.code, traceId }, 'client error');

  res.status(status).type('application/problem+json').json({
    type: known ? `https://api.example.com/problems/${err.code.toLowerCase()}` : 'about:blank',
    title: known ? err.title : status === 400 ? 'Malformed JSON' : 'Internal Server Error',
    status,
    ...(known && err.detail ? { detail: err.detail } : {}),
    instance: req.originalUrl,
    ...(known ? { code: err.code, ...err.extra } : {}),
    traceId,
  });
}
```

`res.json()` only sets `application/json` when no content type is present, so set
`application/problem+json` with `.type()` first and Express keeps it. Add a
catch-all 404 route before the handler so unknown paths also get a
problem body. Compare with [../../65-rest-api/](../../65-rest-api/).

## Handling problems on the client

One function turns any failed response into a problem, including ones your API
did not produce, such as a proxy's HTML 502.

```ts
type Problem = {
  type: string; title: string; status: number;
  detail?: string; code?: string; traceId?: string;
  errors?: Record<string, string[]>;
};

export async function readProblem(res: Response): Promise<Problem> {
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/problem+json') || ct.includes('application/json')) {
    try { return { type: 'about:blank', status: res.status, title: res.statusText, ...(await res.json()) }; }
    catch { /* body was not JSON after all */ }
  }
  return { type: 'about:blank', title: res.statusText || 'Request failed', status: res.status };
}
```

`fetch` only rejects on network failure; a 500 resolves, so check `res.ok`.
Branch on `code`, fall back on `status`, show `traceId` for 5xx, and retry only
5xx, 408 and 429 on idempotent requests (see
[idempotency and safe retries](idempotency-and-safe-retries.md)).

## What you should be able to answer

- What are the five standard problem details members, and which one should a client branch on?
- Why must clients never match on the `detail` text, and how do you evolve error codes safely?
- Design a validation error response and show how a React form maps it to fields.
- What must never appear in an error body, and how does a unique-constraint violation get translated?
- How does a user-facing trace id connect to your logs, and what log level do 4xx and 5xx get?
- How do `AddProblemDetails`, `IExceptionHandler` and `UseExceptionHandler` fit together in ASP.NET Core?
