# Exceptions, finally and IDisposable in C#

Two questions come up in nearly every .NET interview: "how do you handle errors in your API?" and "what does `using` do?". They belong together, because `using` is `try`/`finally` in disguise and both are about leaving the system in a clean state when something goes wrong. Build [csharp/08](../../csharp/08-exceptions-vs-result/) and [csharp/20](../../csharp/20-error-handling-problemdetails/) alongside this guide.

## When to throw

.NET's guidance is simple: throw when a method cannot do what its name promises. Do not use exceptions for expected outcomes on a hot path.

| Situation | Approach |
|---|---|
| Invalid argument from a programmer error | Throw `ArgumentException` / `ArgumentNullException` / `ArgumentOutOfRangeException` |
| Object in the wrong state for this call | Throw `InvalidOperationException` |
| Expected "not found" or "invalid input" | Return `null`, a `bool` with `Try...`, or a result type |
| Infrastructure failure (database down, timeout) | Let the exception propagate |
| Business rule violated deep in the domain | A custom exception is acceptable if the boundary maps it |

Exceptions are relatively expensive (stack trace capture, unwinding) and, more importantly, invisible in signatures. The `Try` pattern (`int.TryParse`, `TryGetValue`) exists for cases where failure is normal. .NET 8+ has one-line guards that throw the right type with the parameter name filled in:

```cs
ArgumentNullException.ThrowIfNull(order);
ArgumentException.ThrowIfNullOrWhiteSpace(email);
ArgumentOutOfRangeException.ThrowIfNegativeOrZero(quantity);
```

## Catching well

Catch an exception only where you can do something useful: retry, translate it, add context, or turn it into a response. Everywhere else, let it bubble.

```cs
try
{
    await gateway.ChargeAsync(payment, ct);
}
catch (HttpRequestException ex) when (ex.StatusCode == HttpStatusCode.TooManyRequests)
{
    await Task.Delay(retryAfter, ct);
    // retry...
}
```

Rules interviewers check:

- **Catch specific types.** `catch (Exception)` belongs only at a boundary (middleware, a background job's loop) that logs and moves on.
- **Order matters.** More derived types first; the compiler rejects a catch that can never be reached.
- **Never swallow silently.** An empty catch hides bugs for months.
- **Rethrow with `throw;`**, not `throw ex;`. `throw ex;` resets the stack trace to the current line, destroying the evidence of where it started.
- **Wrap with context** when crossing a layer: `throw new ImportFailedException($"Row {row} failed", ex);` keeps the original as `InnerException`.

### Exception filters

A `when` clause is evaluated **before** the stack unwinds. If it returns false, the catch is skipped as though it did not exist, and the original stack is intact for debuggers and crash dumps. That makes filters better than catching and rethrowing conditionally, and enables a logging idiom: `catch (Exception ex) when (LogAndReturnFalse(ex))`.

### Rethrowing later

To rethrow an exception you caught earlier and stored (in a retry helper or a queue), use `ExceptionDispatchInfo.Capture(ex).Throw()`, which preserves the original trace. `await` uses the same mechanism to rethrow a faulted task's exception.

## What `finally` guarantees

A `finally` block runs whether the `try` completes, returns early, or throws. It does not run if the process is killed, and an exception thrown inside `finally` replaces the original one, which is then lost.

```cs
var conn = new SqlConnection(cs);
try
{
    conn.Open();
    // work
}
finally
{
    conn.Dispose();
}
```

That pattern is exactly what `using` generates.

## IDisposable and using

The garbage collector frees memory, but only eventually and never for anything outside the managed heap. File handles, sockets, database connections and locks need to be released **now**. `IDisposable.Dispose()` is the contract for that, and `using` guarantees it is called.

```cs
using var stream = File.OpenRead(path);          // disposed at the end of the enclosing scope
using var reader = new StreamReader(stream);
var firstLine = await reader.ReadLineAsync(ct);
```

| Form | Disposes |
|---|---|
| `using (var x = ...) { }` | At the closing brace |
| `using var x = ...;` (C# 8) | At the end of the enclosing block, in reverse declaration order |
| `await using var x = ...;` | Calls `DisposeAsync()` at the end of the block |

Use `await using` for types that implement `IAsyncDisposable` and do I/O on disposal, such as flushing a buffered stream or a `DbContext`.

### Who disposes what

The rule is ownership: **whoever creates a disposable object disposes it**.

- Objects from the DI container are disposed by the container when their scope ends. Never dispose an injected `DbContext` yourself.
- An `HttpClient` from `IHttpClientFactory` does not need disposing; creating `new HttpClient()` per request and disposing it exhausts sockets under load.
- A method that returns a disposable transfers ownership to the caller.
- A class that owns a disposable field should itself implement `IDisposable` and forward the call.

### The dispose pattern, and when you do not need it

The full pattern, with a finaliser, `protected virtual void Dispose(bool disposing)` and `GC.SuppressFinalize(this)`, exists for types that directly own unmanaged handles or are designed for inheritance. Almost no application code needs it: wrap raw handles in a `SafeHandle` instead. A sealed class that owns a stream and a connection just needs this:

```cs
public sealed class ReportWriter : IDisposable
{
    private readonly FileStream _file;
    private readonly SqlConnection _conn;
    // ...
    public void Dispose()
    {
        _file.Dispose();
        _conn.Dispose();
    }
}
```

`Dispose` should be safe to call more than once, and methods called after disposal should throw `ObjectDisposedException` (`ObjectDisposedException.ThrowIf(_disposed, this)` in .NET 7+).

## Async code changes where exceptions surface

An exception in an `async Task` method is stored in the task and rethrown when awaited. An `async void` method has no task, so its exceptions crash the process. `Task.WhenAll` rethrows only the first exception when awaited; the task's `Exception.InnerExceptions` holds the rest. Disposal also interacts with async: returning a task from inside a `using` without awaiting disposes the resource before the work finishes. The [async deep dive](csharp-async-deep-dive.md) covers these in detail.

## Exceptions at the API boundary

In ASP.NET Core, handle unexpected exceptions once, centrally, and return RFC 9457 problem details rather than stack traces:

```cs
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<DomainExceptionHandler>(); // IExceptionHandler, .NET 8+

app.UseExceptionHandler();
app.UseStatusCodePages();
```

An `IExceptionHandler` can map known domain exceptions (`OrderNotFoundException` to 404, `ConcurrencyException` to 409) and fall through to a generic 500 for everything else. Validation failures should normally be returned as a 400 `ValidationProblem` by the endpoint, not thrown. Clients disconnecting cause `OperationCanceledException`; log those at a low level rather than as errors. See [middleware pipeline](aspnet-middleware-pipeline.md) for where this sits.

## Exceptions versus result types

Some teams return `Result<T>` objects (or use libraries such as ErrorOr or FluentResults) for expected business failures, keeping exceptions for the unexpected. The trade-off:

| | Exceptions | Result types |
|---|---|---|
| Visible in the signature | No | Yes |
| Cost on the failure path | High | Low |
| Easy to ignore by accident | Yes (it propagates) | Yes (you can skip the check) |
| Fits BCL and framework code | Naturally | Needs mapping at the edges |

A sensible middle ground: `Try` methods or result types for expected outcomes such as "email already taken", exceptions for bugs and infrastructure failures. Be consistent within a codebase.

## What you should be able to answer

- When should a method throw, and when should it return a failure value?
- What is the difference between `throw;` and `throw ex;`, and how do exception filters differ from catching and rethrowing?
- What does `finally` guarantee, and what can make you lose the original exception?
- What does `using` compile to, and when do you need `await using`?
- Who is responsible for disposing an object resolved from DI, and why is `new HttpClient()` per request a problem?
- How should an ASP.NET Core API turn exceptions into responses?
