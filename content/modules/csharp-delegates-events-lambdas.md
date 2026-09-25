# Delegates, events and lambdas in C#

In JavaScript, functions are values and you never think about it. In C#, a function value has a type (a delegate), and that type decides whether a lambda runs in memory or becomes SQL. Interviewers ask about `Func` versus `Action`, what `event` adds, closure capture, and why a predicate stored in a variable made an EF Core query slow. Build [csharp/12](../../csharp/12-events-delegates/) as you read.

## A delegate is a typed function reference

A delegate type describes a method signature. A delegate instance points at a method (and, for instance methods, the object to call it on).

```cs
PriceRule tenOff = p => p - 10m;
PriceRule half = Halve;
Console.WriteLine(tenOff(50m) + half(50m)); // 65

static decimal Halve(decimal p) => p / 2;

public delegate decimal PriceRule(decimal price);
```

You rarely declare your own delegate types now; the built-in generic ones cover almost everything:

| Type | Signature | Typical use |
|---|---|---|
| `Action` / `Action<T1..T16>` | Returns `void` | Callbacks, `List<T>.ForEach` |
| `Func<T1..T16, TResult>` | Returns `TResult` (last type argument) | LINQ selectors, factories |
| `Predicate<T>` | `T -> bool` | Older APIs such as `List<T>.FindAll` |
| `EventHandler` / `EventHandler<TEventArgs>` | `(object? sender, TEventArgs e)` | Events |
| `Expression<Func<...>>` | Not a delegate: a data structure describing the lambda | LINQ providers, EF Core |

Declare a named delegate when the name documents intent in a public API or you need `ref`/`out` parameters, which `Func` cannot express.

## Lambdas, method groups and local functions

A lambda is an anonymous function converted to a delegate (or expression tree) by its target type. Since C# 10 a lambda with typed parameters has a natural type, so `var f = (int x) => x * 2;` gives a `Func<int, int>`.

```cs
Func<Order, bool> isLarge = o => o.Total > 1000;     // lambda
Func<string, int> parse = int.Parse;                  // method group
var squares = numbers.Select(static n => n * n);      // static lambda: cannot capture
```

A `static` lambda (C# 9) cannot capture locals or `this`, so the compiler can cache one delegate instance instead of allocating. Use it in hot paths to prove nothing is captured.

For helpers used only inside one method, a **local function** is often better than a lambda stored in a variable: it can be recursive, can be generic, does not allocate a delegate unless converted to one, and can be declared after its use.

## Closures: capturing variables, not values

A lambda that uses a local variable captures the **variable**. The compiler moves it into a hidden class shared by the method and the lambda, so later changes are visible.

```cs
var actions = new List<Action>();
for (int i = 0; i < 3; i++)
    actions.Add(() => Console.Write(i));
foreach (var a in actions) a(); // 333

foreach (var n in new[] { 0, 1, 2 })
    actions.Add(() => Console.Write(n)); // 012: each iteration has a fresh variable
```

A `for` loop has one variable for the whole loop, so every lambda sees its final value. `foreach` has had a fresh variable per iteration since C# 5. This mirrors JavaScript's `var` versus `let` in loops.

Captures have costs: a heap allocation for the closure class, and a lifetime extension. A lambda that captures `this` keeps the whole object alive for as long as the delegate is referenced, which is how event subscriptions leak memory.

## Multicast delegates

Every delegate can hold an invocation list. `+=` appends, `-=` removes the last matching entry.

```cs
Action log = () => Console.Write("a");
log += () => Console.Write("b");
log(); // ab
```

For a multicast `Func`, all handlers run but only the **last** return value is returned. Handlers run synchronously, in order, on the caller's thread, and an exception from one stops the rest. If you need each result, or isolation between handlers, iterate `GetInvocationList()` yourself.

Removal compares delegates for equality, and two separately written lambdas are never equal, so `x -= () => Save();` removes nothing. Store the delegate in a field and remove that instance.

## Events: delegates with access control

An `event` is a delegate field that outside code can only subscribe to (`+=`) and unsubscribe from (`-=`). Only the declaring class can raise or reset it.

```cs
public sealed class OrderService
{
    public event EventHandler<OrderPlacedEventArgs>? OrderPlaced;

    public void Place(Order order)
    {
        // ... save
        OrderPlaced?.Invoke(this, new OrderPlacedEventArgs(order.Id));
    }
}

public sealed record OrderPlacedEventArgs(int OrderId);
```

Without `event`, any caller could write `service.OrderPlaced = null;` and wipe out every subscriber, or invoke it themselves. The `?.Invoke` pattern skips the call when nobody has subscribed and reads the field once, avoiding a race with an unsubscribe on another thread.

Conventions: name events in the past tense (`OrderPlaced`) or as `...ing` for cancellable pre-events, use `EventHandler<T>`, and pass `this` as the sender. Since .NET 4.5 the args type no longer has to derive from `EventArgs`.

### Events and memory leaks

The publisher holds a reference to every subscriber through its handlers. If a short-lived object subscribes to a long-lived publisher (a singleton, a static event) and never unsubscribes, it can never be collected. In ASP.NET Core this shows up as scoped services subscribing to singleton events. Unsubscribe in `Dispose`, or avoid in-process events across lifetimes entirely.

### Events versus other options

C# events are synchronous and in-process. `async void` handlers are the only way to await inside one, and they turn exceptions into process crashes. For application-level notifications in a web app, prefer an explicit interface (`IOrderPlacedHandler`) resolved from DI, a mediator library, or a durable queue when work must survive failures (see [background jobs and queues](background-jobs-and-queues.md)). Events remain the right tool inside UI frameworks and for component-level notifications.

## Delegates versus expression trees

The same lambda text can become two different things depending on its target type:

```cs
Func<Order, bool> compiled = o => o.Total > 1000;               // IL: runs in memory
Expression<Func<Order, bool>> described = o => o.Total > 1000;  // a tree EF Core can read
```

`Queryable.Where` takes the expression tree and translates it to SQL. A `Func` cannot be translated, so passing one makes overload resolution pick `Enumerable.Where`, and EF Core loads every row before filtering in memory. When you factor out a reusable predicate for EF Core, type it as `Expression<Func<T, bool>>`. You can call `.Compile()` on an expression to get a delegate, but not the reverse. The [LINQ in depth](csharp-linq-in-depth.md) guide covers the `IQueryable` side.

## Delegates as a design tool

A `Func<>` parameter is the lightest form of dependency injection: pass behaviour in instead of hard-coding it.

```cs
public sealed class RetryPolicy(int attempts, Func<int, TimeSpan> backoff) { /* ... */ }

var policy = new RetryPolicy(3, attempt => TimeSpan.FromMilliseconds(200 * Math.Pow(2, attempt)));
```

This is ideal for small strategies (sorting keys, backoff, formatting). When the behaviour grows several methods or needs its own dependencies, an interface is clearer. ASP.NET Core itself is built on delegates: middleware is a `RequestDelegate` pipeline, and minimal API endpoints are lambdas.

## What you should be able to answer

- What is a delegate, and when would you use `Func`, `Action` or a named delegate type?
- What does the `event` keyword add to a delegate field?
- Why does a `for` loop of lambdas print the same value, and why does `foreach` not?
- What happens when one event handler throws, and what does a multicast `Func` return?
- How can event subscriptions leak memory in a long-running app?
- What is the difference between `Func<T, bool>` and `Expression<Func<T, bool>>`, and why does it matter for EF Core?
