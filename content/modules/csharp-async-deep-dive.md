# async/await in C#, past the basics

Most .NET production bugs that are hard to reproduce come from async misuse:
a `.Result` that hangs, an `async void` that takes the process down, a server
that stops responding under load at 30% CPU. JavaScript developers arrive with
the wrong instincts, because in C# the code after an `await` can run in parallel
with other code. [csharp/14](../../csharp/14-async-await-basics/) covers the
syntax; this guide covers what interviewers probe.

## A Task is a promise of a result, not a thread

`Task<T>` represents work that will finish later. It does not own a thread.
While a database query is in flight, no thread is waiting for it; the operating
system signals completion and a thread-pool thread picks up the rest of your
method.

The compiler rewrites an `async` method into a state machine:

```
call -> run synchronously until the first incomplete await
     -> save locals, register continuation, return an incomplete Task
     ...I/O completes...
     -> a pool thread resumes the state machine at the next state
     -> repeat until the method returns, then complete the Task
```

If every awaited task is already complete, the method never yields and runs
start to finish on the caller's thread.

## How C# differs from JavaScript

Node has one thread running your JavaScript, so two callbacks never run at the
same moment. In ASP.NET Core, continuations run on **any** thread-pool thread,
and many run simultaneously:

```cs
var total = 0;
await Task.WhenAll(items.Select(async i =>
{
    var price = await pricing.GetAsync(i);
    total += price;   // data race: two continuations can run this line at once
}));
```

This is correct-looking code in JavaScript and a bug in C#. Use
`Interlocked.Add`, collect the results and sum them afterwards, or lock.

## Synchronisation context and ConfigureAwait

In WinForms, WPF and classic ASP.NET, a **synchronisation context** makes
continuations resume on the original thread (the UI thread, or the request's
context). That produces the classic deadlock:

```cs
// UI thread or classic ASP.NET
var user = GetUserAsync().Result;   // blocks the only thread allowed to resume GetUserAsync
```

`GetUserAsync` finishes its I/O and wants to resume on the blocked thread. The
blocked thread is waiting for `GetUserAsync`. Neither moves.

**ASP.NET Core has no synchronisation context**, so this particular deadlock
cannot happen there and `ConfigureAwait(false)` makes no difference in your app
code. It still belongs in **libraries**, which may be called from a UI app. The
`.Result` is still wrong in ASP.NET Core for a different reason: see
thread-pool starvation below.

## async void

`async void` exists for event handlers, whose signature is fixed. Anywhere else
it is a bug:

```cs
public async void SendWelcome(User u) { await email.SendAsync(u); } // don't
```

The caller gets nothing to await, so it cannot know when the work finished or
whether it failed. An exception has no `Task` to live in, so it is rethrown on
the thread pool, and an unhandled exception there **terminates the process**.
Return `Task`. Watch for `async` lambdas passed to parameters of type `Action`,
such as `list.ForEach(async x => ...)`: that lambda is `async void`.

## Cancellation end to end

Accept a `CancellationToken` in every async method that does I/O, and pass it
all the way down:

```cs
app.MapGet("/reports/{id}", async (int id, ReportService reports, CancellationToken ct) =>
    await reports.BuildAsync(id, ct));   // ct is HttpContext.RequestAborted
```

Minimal APIs and controllers bind a `CancellationToken` parameter to
`HttpContext.RequestAborted`, which fires when the client disconnects. EF Core,
`HttpClient` and `Task.Delay` all accept it, so a user closing the tab stops the
query instead of finishing it for nobody. For a timeout on something that takes
no token, `await task.WaitAsync(TimeSpan.FromSeconds(5), ct)` stops waiting,
though the underlying work carries on. Handle `OperationCanceledException` as
"stopped on purpose", not as a 500.

## Running work concurrently

```cs
var userTask   = users.GetAsync(id, ct);
var ordersTask = orders.ListForAsync(id, ct);
await Task.WhenAll(userTask, ordersTask);          // both in flight at once
var (user, list) = (userTask.Result, ordersTask.Result); // safe: both complete
```

If several tasks fail, `await Task.WhenAll(...)` throws only the **first**
exception. The rest are on the returned task's `Exception`, an
`AggregateException`. Keep a reference to the `WhenAll` task if you need them
all.

Do not do this with two queries on the **same** `DbContext`: it allows one
operation at a time and throws.

`Task.WhenEach` (.NET 9) lets you handle results in completion order:

```cs
await foreach (var done in Task.WhenEach(downloads))
    Console.WriteLine(await done);
```

For a large list with bounded concurrency, use `Parallel.ForEachAsync`, or a
`SemaphoreSlim` if you're composing it yourself:

```cs
await Parallel.ForEachAsync(customerIds,
    new ParallelOptions { MaxDegreeOfParallelism = 8, CancellationToken = ct },
    async (id, token) => await SyncCustomerAsync(id, token));
```

Firing 10,000 HTTP calls with `WhenAll` and no limit exhausts sockets and gets
you rate-limited.

## Fire-and-forget in a web app

```cs
_ = Task.Run(() => audit.WriteAsync(order));   // after the response returns...
```

When the response completes, the request scope is disposed, and the
`DbContext` the audit service holds goes with it. You get
`ObjectDisposedException` on a thread nobody is watching, and on shutdown the
work is lost. Write the work to a queue (a `Channel<T>` read by a hosted
service, or a durable queue) instead. [csharp/32](../../csharp/32-background-work-queue/)
builds it, and the [background jobs guide](background-jobs-and-queues.md)
covers the durable version.

## Streams with IAsyncEnumerable

```cs
public async IAsyncEnumerable<Order> StreamAsync(
    [EnumeratorCancellation] CancellationToken ct = default)
{
    await foreach (var o in db.Orders.AsNoTracking().AsAsyncEnumerable().WithCancellation(ct))
        yield return o;
}

app.MapGet("/orders/export", (OrderService s, CancellationToken ct) => s.StreamAsync(ct));
```

`await foreach` pulls items as they arrive rather than buffering a whole list.
Returning an `IAsyncEnumerable<T>` from an endpoint makes System.Text.Json
stream the JSON array, so a 200,000-row export does not need 200,000 objects in
memory at once.

## Thread-pool starvation, ValueTask and locks

**Starvation.** Blocking on async code (`.Result`, `.Wait()`,
`GetAwaiter().GetResult()`) parks a pool thread while it waits. Under load,
every thread is parked waiting for continuations that need a free thread to
run. The pool injects new threads slowly, so the symptoms are latency climbing
into seconds, requests timing out and CPU sitting low. `dotnet-counters`
shows the thread-pool queue length growing. The fix is async all the way down;
there is no setting that makes sync-over-async safe.

**ValueTask.** Use `ValueTask<T>` when a method usually completes synchronously
(a cache hit) and is hot enough that allocating a `Task` shows up in a profile.
The rules: await it exactly once, never await it concurrently, and don't read
`.Result` before it completes. If you need any of those, call `.AsTask()`.
Default to `Task`.

**Locks.** You cannot `await` inside a `lock` block (the compiler refuses). For
async critical sections, use `SemaphoreSlim(1, 1)` with `WaitAsync` and a
`finally` that releases it. For synchronous ones, .NET 9 added
`System.Threading.Lock`:

```cs
private readonly Lock _gate = new();
lock (_gate) { _count++; }   // the compiler uses Lock.EnterScope(), faster than Monitor
```

## What you should be able to answer

- Why is `async void` dangerous, and where is it acceptable?
- Do you need `ConfigureAwait(false)` in ASP.NET Core? Where do you still use it?
- What happens to exceptions when several tasks passed to `Task.WhenAll` fail?
- How do you stop work when the client disconnects?
- Why can `.Result` deadlock in a UI app, and what does it do to an ASP.NET Core server under load?
- When would you return `ValueTask` instead of `Task`?
