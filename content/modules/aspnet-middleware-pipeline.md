# The ASP.NET Core middleware pipeline

"Walk me through what happens to a request in ASP.NET Core" is the opening
question of most .NET backend interviews, and "why does the order of `Use...`
calls matter?" is the follow-up. If you can draw the pipeline, explain where
routing, auth and exception handling sit, and write a middleware both ways, you
are answering at mid-level.

## A pipeline is a chain of delegates

Everything is built on one type:

```cs
public delegate Task RequestDelegate(HttpContext context);
```

A middleware is a function that receives the `HttpContext` and the *next*
`RequestDelegate`. It can do work, call `next`, do more work after `next`
returns, or not call `next` at all. At startup ASP.NET Core composes these
into a single nested delegate — a Russian doll. The request travels inwards,
the response travels back outwards through the same layers in reverse.

```cs
var app = builder.Build();

app.Use(async (context, next) =>
{
    var started = Stopwatch.GetTimestamp();
    await next(context);                        // everything further in runs here
    var ms = Stopwatch.GetElapsedTime(started).TotalMilliseconds;
    app.Logger.LogInformation("{Path} took {Ms} ms", context.Request.Path, ms);
});

app.Run(async context =>
{
    await context.Response.WriteAsync("Hello");  // terminal: there is no next
});

app.Run();
```

That is why order matters: a middleware can only see what happened *inside* it,
and it can only protect what is registered *after* it.

## Use, Run, Map, MapWhen, UseWhen

| Method | What it does | Rejoins the main pipeline? |
|--------|--------------|----------------------------|
| `Use` | Adds a middleware that may call `next` | n/a — it is the main pipeline |
| `Run` | Adds a terminal middleware; nothing after it runs | n/a |
| `Map("/admin", b => ...)` | Branches on a path prefix; moves the matched segment from `Path` to `PathBase` | No |
| `MapWhen(predicate, b => ...)` | Branches on any condition on `HttpContext` | No |
| `UseWhen(predicate, b => ...)` | Conditionally runs extra middleware, then continues | Yes, unless the branch short-circuits |

```cs
// Only API requests get the correlation-id middleware; everything continues afterwards.
app.UseWhen(ctx => ctx.Request.Path.StartsWithSegments("/api"),
    branch => branch.UseMiddleware<CorrelationIdMiddleware>());
```

Do not confuse `app.Map(...)` (a pipeline branch, rarely used now) with
`app.MapGet(...)` (an endpoint registration). Most apps never branch the
pipeline; they use endpoint routing and put conditions in metadata.

## The recommended order, and why each position

```cs
if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler();   // outermost: catches everything below it
    app.UseHsts();               // tells browsers "HTTPS only" — never in dev
}
app.UseHttpsRedirection();
app.UseStaticFiles();            // or app.MapStaticAssets() in .NET 9+
app.UseRouting();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();
app.UseOutputCache();

app.MapControllers();
app.MapGet("/health", () => Results.Ok());
```

- **Exception handler first** so it wraps every later layer. Anything
  registered before it is unprotected.
- **HSTS and HTTPS redirection** early, so nothing is served over plain HTTP.
- **Static files before routing and auth** so `/css/site.css` is served
  cheaply and does not pay for auth. The flip side: files served by
  `UseStaticFiles` are public. In .NET 9+, `MapStaticAssets()` is an
  *endpoint*, which means it takes part in routing and can carry metadata, and
  it adds build-time compression and fingerprinted caching.
- **Routing before CORS and auth** because those middlewares need to know
  *which endpoint* matched to read its `[EnableCors]`, `[Authorize]` or
  `[AllowAnonymous]` metadata.
- **Authentication before authorization**: you must know who someone is before
  deciding what they may do. Swap them and every `[Authorize]` endpoint returns
  401 for a correctly logged-in user, because `HttpContext.User` is still empty.
- **Rate limiter after routing** so endpoint-specific policies work, and after
  authentication if you partition limits by user.
- **Output cache after CORS and auth** so cached responses are not served to
  callers who should have been rejected.

## What WebApplication does for you

The minimal hosting model (`WebApplication.CreateBuilder`) adds several things
implicitly:

- In Development it adds the **developer exception page** first.
- If you do not call `UseRouting()`, it adds routing at the **start** of the
  pipeline; it always adds the endpoint-executing middleware at the **end**.
  There is no `UseEndpoints` call to write.
- If authentication or authorization services are registered and you have not
  called `UseAuthentication()`/`UseAuthorization()`, it adds them for you after
  routing.

The trap: because implicit routing runs first, a middleware you register before
an explicit `UseRouting()` cannot see the endpoint. If a custom middleware
needs endpoint metadata, call `app.UseRouting()` explicitly and register the
middleware after it. Writing the order out explicitly is also clearer for the
next reader.

## Endpoint routing and metadata

Routing is split into two halves: `UseRouting` *selects* an endpoint and stores
it on the context; the endpoint middleware at the end *executes* it. Everything
in between can inspect the choice:

```cs
app.UseRouting();
app.Use(async (context, next) =>
{
    var endpoint = context.GetEndpoint();
    var audit = endpoint?.Metadata.GetMetadata<AuditAttribute>();
    if (audit is not null)
        context.Items["audit"] = audit.Action;
    await next(context);
});
```

This is exactly how the auth, CORS, rate-limiting and output-cache middlewares
work: they read attributes or `.RequireAuthorization()`/`.RequireRateLimiting()`
metadata off the matched endpoint. `GetEndpoint()` returns `null` before
routing has run and when nothing matched (which becomes a 404 at the end).

## Writing middleware: convention-based vs IMiddleware

**Convention-based** — the most common form. No interface; the class needs a
constructor taking `RequestDelegate` and an `Invoke`/`InvokeAsync` method.

```cs
public sealed class CorrelationIdMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, ILogger<CorrelationIdMiddleware> log)
    {
        var id = context.Request.Headers["X-Correlation-Id"].FirstOrDefault()
                 ?? Guid.NewGuid().ToString("N");
        context.Response.Headers["X-Correlation-Id"] = id;
        using (log.BeginScope(new Dictionary<string, object> { ["CorrelationId"] = id }))
        {
            await next(context);
        }
    }
}

app.UseMiddleware<CorrelationIdMiddleware>();
```

It is constructed **once**, so it behaves like a singleton. Injecting a scoped
service (a `DbContext`) into its constructor is a captive-dependency bug; put
scoped services on the `InvokeAsync` parameters instead, where they are
resolved per request.

**Factory-based** — implement `IMiddleware` and register it in DI:

```cs
public sealed class TenantMiddleware(AppDbContext db) : IMiddleware
{
    public async Task InvokeAsync(HttpContext context, RequestDelegate next)
    {
        // db is scoped: a fresh one per request
        await next(context);
    }
}

builder.Services.AddScoped<TenantMiddleware>();
app.UseMiddleware<TenantMiddleware>();
```

`IMiddlewareFactory` resolves it from the request scope each time, so
constructor injection of scoped services is safe and the type is strongly
checked. Forget the `AddScoped` line and the first request throws. See
[dependency-injection-explained.md](dependency-injection-explained.md) for
lifetimes and the [middleware project](../../csharp/19-middleware-pipeline/)
for both styles side by side.

## Short-circuiting, and "the response has already started"

Not calling `next` short-circuits: everything further in is skipped, and the
response travels back out from here.

```cs
app.Use(async (context, next) =>
{
    if (!context.Request.Headers.ContainsKey("X-Api-Key"))
    {
        context.Response.StatusCode = StatusCodes.Status401Unauthorized;
        return;                                  // next is never called
    }
    await next(context);
});
```

Once the first byte of the body is flushed, headers and status code are on the
wire. Setting them afterwards throws `InvalidOperationException` ("Headers are
read-only, response has already started"). Check `context.Response.HasStarted`
before modifying, or use `context.Response.OnStarting(...)` to add a header at
the last safe moment. The same rule applies to the exception handler: if an
exception occurs after the response started streaming, it can no longer send a
ProblemDetails body, and the connection is simply aborted.

.NET 8 added endpoint-level short-circuiting. `.ShortCircuit()` makes the
endpoint run immediately after routing, skipping auth, CORS and anything else
between routing and the end of the pipeline; `MapShortCircuit` returns a fixed
status for noisy paths:

```cs
app.MapGet("/ping", () => "pong").ShortCircuit();
app.MapShortCircuit(404, "robots.txt", "favicon.ico");
```

Only use it for endpoints that genuinely need no auth.

## Exception handling: UseExceptionHandler, IExceptionHandler, ProblemDetails

Since .NET 8 the clean pattern is:

```cs
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<NotFoundExceptionHandler>();

app.UseExceptionHandler();
app.UseStatusCodePages();   // gives bare 404/405 responses a ProblemDetails body too
```

```cs
public sealed class NotFoundExceptionHandler(IProblemDetailsService problems) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext context, Exception exception, CancellationToken ct)
    {
        if (exception is not EntityNotFoundException nf) return false;   // let the next handler try

        context.Response.StatusCode = StatusCodes.Status404NotFound;
        return await problems.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = context,
            Exception = exception,
            ProblemDetails = { Title = "Not found", Detail = nf.Message }
        });
    }
}
```

Handlers run in registration order until one returns `true`. If none does, the
middleware falls back to a generic 500 ProblemDetails. `AddProblemDetails()` is
what lets `UseExceptionHandler()` with no path work, and it makes the whole
framework (status code pages, `Results.Problem`, `[ApiController]` errors) emit
the RFC 9457 shape. Never return stack traces outside Development. The
[ProblemDetails project](../../csharp/20-error-handling-problemdetails/) builds
this end to end; [rest-api-design.md](rest-api-design.md) covers the error
body design, and [logging-and-observability.md](logging-and-observability.md)
where the exception gets logged.

## What you should be able to answer

- What is a `RequestDelegate`, and how does calling or not calling `next` shape the request and response path?
- Give the recommended order of the built-in middlewares and justify where routing, authentication and the exception handler go.
- What is the difference between `Map`, `MapWhen` and `UseWhen`?
- Why must a convention-based middleware not take a `DbContext` in its constructor, and how does `IMiddleware` change that?
- What does "response has already started" mean, and how do you avoid the exception?
- How do `IExceptionHandler`, `AddProblemDetails` and `UseExceptionHandler` fit together in .NET 8+?
