# Logging and OpenTelemetry in .NET

.NET interviews probe logging through small, precise questions: why the
analyser complains about an interpolated log message, how a category gets its
level, what a scope is for, how a trace id ends up on a log line. This guide
is the .NET-specific layer on top of
[logging-and-observability.md](logging-and-observability.md), which covers the
three signals in general.

## ILogger<T> and categories

You never create loggers by hand. You inject `ILogger<T>`, and `T`'s full type
name becomes the **category**:

```cs
public sealed class OrderService(ILogger<OrderService> logger, AppDb db)
{
    public async Task ShipAsync(int orderId, CancellationToken ct)
    {
        logger.LogInformation("Shipping order {OrderId}", orderId);
        // category: "MyShop.Orders.OrderService"
    }
}
```

The category is what filtering keys on. Framework code logs under categories
such as `Microsoft.AspNetCore.Hosting.Diagnostics` and
`Microsoft.EntityFrameworkCore.Database.Command`, which is how you can silence
one noisy component without touching the rest. If you need a logger for a
non-generic context, inject `ILoggerFactory` and call
`CreateLogger("MyShop.Import")`.

## Levels and filtering in appsettings

The six levels, lowest to highest: `Trace`, `Debug`, `Information`, `Warning`,
`Error`, `Critical` (plus `None` to switch a category off). Filtering lives in
the `Logging` section:

```json
{
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning",
      "Microsoft.EntityFrameworkCore.Database.Command": "Warning"
    },
    "Console": {
      "LogLevel": { "Default": "Warning" }
    }
  }
}
```

The rules to state in an interview:

- The **longest matching category prefix** wins. `Microsoft.AspNetCore` covers
  every category beneath it unless a more specific entry exists.
- A **provider section** (`Console`, `Debug`, `EventSource`) overrides the
  general `LogLevel` for that provider only.
- Configuration is layered, so `appsettings.Development.json` or an
  environment variable (`Logging__LogLevel__Default=Debug`) can change levels
  without a rebuild. See [dotnet-options-pattern.md](dotnet-options-pattern.md)
  for provider precedence.

The default template sets `Microsoft.AspNetCore` to `Warning`, which is why
you do not see one line per request out of the box.

## Message templates, not interpolation

This is the classic question. The first argument is a **template**; each
`{Placeholder}` becomes a named property that a structured sink stores as a
field:

```cs
logger.LogWarning("Payment {PaymentId} declined for {CustomerId}", paymentId, customerId);
logger.LogWarning($"Payment {paymentId} declined for {customerId}");  // CA2254
```

The interpolated version is wrong for three reasons:

1. **Structure is lost.** The sink receives one flat string, so you cannot
   query `PaymentId = 991` or group by `CustomerId`.
2. **Cost.** The string is formatted before `LogWarning` runs, even when
   `Warning` is filtered out.
3. **Cardinality.** Every message is unique, so tools that group by template
   cannot group anything.

The analyser rule is **CA2254: the template should be a static expression**.
Placeholders are matched by **position**, not by name — `{CustomerId}` does
not bind to a variable called `customerId`. Use PascalCase names and keep them
stable, because dashboards and alerts end up depending on them. Pass the
exception as the first argument, not inside the template:
`logger.LogError(ex, "Import {FileName} failed", name)`.

## The LoggerMessage source generator

On hot paths, even templates cost something: the arguments are boxed into an
array and the template is parsed. The `[LoggerMessage]` attribute generates a
strongly typed, allocation-light method at compile time:

```cs
public static partial class Log
{
    [LoggerMessage(EventId = 1001, Level = LogLevel.Information,
        Message = "Order {OrderId} shipped in {ElapsedMs} ms")]
    public static partial void OrderShipped(ILogger logger, int orderId, long elapsedMs);
}

// usage
Log.OrderShipped(logger, order.Id, sw.ElapsedMilliseconds);
```

The method must be `partial`, and the generator checks at compile time that
every placeholder has a matching parameter. The generated code also checks
`IsEnabled` before doing any work. Beyond performance, you get one named
method per event and a stable `EventId`, which is useful when an alert keys on
a particular event. Reaching for it everywhere is overkill; a sensible answer
is "for high-volume events, and in libraries".

## Scopes

A scope attaches properties to every log line written inside it, without
threading those values through every call:

```cs
using (logger.BeginScope(new Dictionary<string, object>
{
    ["OrderId"] = order.Id,
    ["TenantId"] = tenantId
}))
{
    logger.LogInformation("Reserving stock");
    await stock.ReserveAsync(order, ct);   // its logs carry OrderId and TenantId too
    logger.LogInformation("Stock reserved");
}
```

Scopes flow with the async context, so they reach lines logged by other
classes that the code inside the block calls. A provider only emits them if
configured to: `"Console": { "FormatterOptions": { "IncludeScopes": true } }`
for the console formatter, `IncludeScopes = true` for the OpenTelemetry logger.
ASP.NET Core already opens a scope per request containing `RequestId` and
`RequestPath`.

## HTTP logging middleware, and its PII problem

`AddHttpLogging` logs request and response details for you:

```cs
builder.Services.AddHttpLogging(o =>
{
    o.LoggingFields = HttpLoggingFields.RequestPropertiesAndHeaders
                    | HttpLoggingFields.ResponseStatusCode
                    | HttpLoggingFields.Duration;
    o.RequestHeaders.Add("X-Correlation-Id");
    o.CombineLogs = true;   // .NET 8+: one entry per request
});

app.UseHttpLogging();
```

It logs at `Information` under the `Microsoft.AspNetCore.HttpLogging`
category, so with the default `Microsoft.AspNetCore: Warning` you will see
nothing until you lower that category. Headers not on the allow-list are
written as `[Redacted]`.

The risk is what you opt into. Adding `RequestBody` or `ResponseBody` means
passwords, tokens, card numbers and personal data land in your log store,
which usually has wider access and longer retention than your database. Never
allow-list `Authorization` or `Cookie`. For production, prefer the metrics and
traces that OpenTelemetry already records, and turn body logging on only
temporarily, for one endpoint, with `.WithHttpLogging(...)`. The position of
`UseHttpLogging` in the pipeline is covered in
[aspnet-middleware-pipeline.md](aspnet-middleware-pipeline.md).

## OpenTelemetry: wiring the three signals

.NET's own diagnostics types are the OpenTelemetry API. An `Activity` is a
span, an `ActivitySource` creates them, and a `Meter` creates instruments. The
OpenTelemetry SDK listens to those and exports them.

```sh
dotnet add package OpenTelemetry.Extensions.Hosting
dotnet add package OpenTelemetry.Instrumentation.AspNetCore
dotnet add package OpenTelemetry.Instrumentation.Http
dotnet add package OpenTelemetry.Exporter.OpenTelemetryProtocol
```

```cs
builder.Services.AddOpenTelemetry()
    .ConfigureResource(r => r.AddService("orders-api"))
    .WithTracing(t => t
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddSource("MyShop.Orders"))
    .WithMetrics(m => m
        .AddAspNetCoreInstrumentation()
        .AddHttpClientInstrumentation()
        .AddMeter("MyShop.Orders"))
    .WithLogging()
    .UseOtlpExporter();   // endpoint from OTEL_EXPORTER_OTLP_ENDPOINT
```

The built-in instrumentation gives you a server span per request (with route,
method and status code), a client span per outgoing `HttpClient` call, and
metrics such as `http.server.request.duration`. `AddSource` and `AddMeter`
must name your own sources, or your custom telemetry is silently dropped —
the single most common "why is my span missing" cause.

## Custom spans and metrics

```cs
public sealed class Checkout(IMeterFactory meters)
{
    private static readonly ActivitySource Source = new("MyShop.Orders");
    private readonly Counter<long> _placed =
        meters.Create("MyShop.Orders").CreateCounter<long>("orders.placed");
    private readonly Histogram<double> _value =
        meters.Create("MyShop.Orders").CreateHistogram<double>("orders.value", unit: "GBP");

    public async Task PlaceAsync(Order order, CancellationToken ct)
    {
        using var activity = Source.StartActivity("PlaceOrder");
        activity?.SetTag("order.item_count", order.Items.Count);
        try
        {
            await SaveAsync(order, ct);
            _placed.Add(1, new KeyValuePair<string, object?>("payment.method", order.Method));
            _value.Record((double)order.Total);
        }
        catch (Exception ex)
        {
            activity?.SetStatus(ActivityStatusCode.Error, ex.Message);
            throw;
        }
    }
}
```

`StartActivity` returns **null** when nothing is listening, hence the `?.`. A
counter only goes up; a histogram records a distribution so you can ask for
p95. Keep tag values low-cardinality: a payment method is fine, a user id on a
metric creates a time series per user.

## Propagation and trace ids in logs

Since .NET 5 the default id format is **W3C Trace Context**. An incoming
`traceparent` header continues the caller's trace, and `HttpClient` adds one
to outgoing calls:

```sh
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
#            version-trace id (32 hex)-parent span id (16 hex)-flags
```

That is what stitches one request across three services into one trace. Log
correlation follows from it: a log written while an `Activity` is current is
exported by the OpenTelemetry logger with its `TraceId` and `SpanId`, so your
backend can jump from a slow span to the exact log lines. For the plain
console provider, set `ActivityTrackingOptions` on the logging builder to add
`TraceId` and `SpanId` to the scope. Background work picked from a queue has no
ambient activity; carry the `traceparent` in the message, as described in
[background-jobs-and-queues.md](background-jobs-and-queues.md).

### Aspire, briefly

Aspire's **service defaults** project packages all of the above — OpenTelemetry
with OTLP export, health checks, `HttpClient` resilience and service discovery
— behind one `builder.AddServiceDefaults()` call. Its **dashboard** is an OTLP
receiver with a UI for logs, traces and metrics, and runs standalone as a
container, which makes it a good local backend even for projects that do not
use the rest of Aspire. In an interview it is enough to say what it gives you
and that it sits on standard OpenTelemetry, so nothing locks you in.

## What you should be able to answer

- Why does CA2254 flag `logger.LogInformation($"User {id} logged in")`, and what do you lose by ignoring it?
- How do categories and the `Logging:LogLevel` section decide whether a line is written?
- When would you use the `[LoggerMessage]` source generator, and what does it generate?
- What does `BeginScope` add, and why might the scope values not appear in your output?
- Why is enabling request body logging in `AddHttpLogging` dangerous in production?
- How does a trace id reach a downstream service and your log lines, and why might a custom `ActivitySource` produce no spans?
