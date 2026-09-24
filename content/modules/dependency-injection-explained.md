# Dependency injection, in both stacks

"Singleton, scoped or transient: when would you use each?" is the most-asked
ASP.NET Core question there is, and "what's a captive dependency?" is how the
interviewer finds out whether you have shipped one. NestJS has brought the same
ideas to Node. Underneath the containers is one simple habit, and it's the habit
that makes code testable.

## The idea without a container

A class that creates its own dependencies is welded to them:

```cs
public class OrderService
{
    private readonly SmtpEmailSender _email = new("smtp.example.com"); // can't swap this
}
```

Dependency injection means the class asks for what it needs and someone else
supplies it:

```cs
public class OrderService(IOrderRepository orders, IEmailSender email, TimeProvider clock)
{
    public async Task PlaceAsync(Order order, CancellationToken ct)
    {
        order.PlacedAt = clock.GetUtcNow();
        await orders.AddAsync(order, ct);
        await email.SendConfirmationAsync(order, ct);
    }
}
```

That's the whole technique. A test passes a fake repository and a fake clock; the
real app passes the real ones. No container is involved yet. The primary
constructor (C# 12) just keeps it short.

## The composition root

Somebody has to call `new`. The rule is that it happens in **one place**, at
the application's entry point, and nowhere else. In ASP.NET Core that is
`Program.cs`; in an Express app it is the file that builds the app. Everything
below the root receives its dependencies and never constructs them. A container
is a tool for writing the composition root, not a requirement.

## The .NET container

```cs
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<IOrderRepository, EfOrderRepository>();
builder.Services.AddScoped<OrderService>();
builder.Services.AddTransient<IEmailSender, SmtpEmailSender>();
builder.Services.AddDbContext<AppDb>(o => o.UseNpgsql(cs)); // registers AppDb as scoped
```

The container reads each constructor, resolves the parameters recursively and
builds the graph. Controllers, minimal API handlers, middleware and hosted
services all get their dependencies this way. `IServiceProvider` is the
container itself; you rarely touch it directly (see service locator below).

## Lifetimes in depth

| Lifetime | One instance per | Real use |
|---|---|---|
| Singleton | application | `IHttpClientFactory` itself, an `IMemoryCache`, `TimeProvider`, options |
| Scoped | scope (in a web app: one HTTP request) | `DbContext`, the current user, a unit of work |
| Transient | every resolution | lightweight, stateless helpers |

"Scoped" means ASP.NET Core creates a scope when a request arrives and disposes
it when the response is done. Everything scoped that the request touches shares
that one instance, which is why two repositories in the same request see the
same `DbContext` and commit in one `SaveChanges`.

**The captive dependency.** A service can safely depend on anything that lives
*as long or longer* than itself. When a longer-lived service depends on a
shorter-lived one, it captures it:

```cs
builder.Services.AddSingleton<PriceCache>();   // lives forever
public class PriceCache(AppDb db) { ... }      // AppDb is scoped: captured forever
```

The singleton is built once, with the first request's `DbContext`, and holds
it for the life of the process. That context is not thread-safe, keeps tracking
every entity it has ever loaded, and was disposed when the first request ended.
You get `ObjectDisposedException`, cross-request data, or both. The [ORM
guide](orm-and-ef-core.md) explains why `DbContext` must be scoped in the first
place.

**Detecting it.** In the Development environment, `WebApplicationBuilder` turns
on `ValidateScopes` (throws when a scoped service is resolved from the root
provider or a singleton) and `ValidateOnBuild` (checks every registration can be
constructed at startup). Both are off in Production for startup speed, so a
captive dependency that only appears in production means you never ran the app
in Development. Note that a **transient captured by a singleton** is not
flagged: it silently becomes a singleton too.

## Scopes outside a request

A `BackgroundService` is a singleton, and there is no request, so there's no
scope. Create one per unit of work:

```cs
public class InvoiceWorker(IServiceScopeFactory scopes, ILogger<InvoiceWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            await using (var scope = scopes.CreateAsyncScope())
            {
                var db = scope.ServiceProvider.GetRequiredService<AppDb>();
                // one scope, one DbContext, per batch
            }
            await Task.Delay(TimeSpan.FromMinutes(1), ct);
        }
    }
}
```

This is the one legitimate place to resolve from a provider by hand.
[csharp/32](../../csharp/32-background-work-queue/) builds exactly this.

## Advanced registration

- **Factories:** `AddScoped<IStorage>(sp => new S3Storage(sp.GetRequiredService<IOptions<S3Options>>().Value))`
  when construction needs logic.
- **Keyed services (.NET 8+):** `AddKeyedSingleton<INotifier, SmsNotifier>("sms")`,
  consumed with `[FromKeyedServices("sms")] INotifier notifier`. Useful when two
  implementations of one interface are both needed.
- **Options:** `IOptions<T>` is a singleton bound on first use and never reloaded, `IOptionsSnapshot<T>` is
  re-read per request (scoped), `IOptionsMonitor<T>` is a singleton that sees
  changes. Injecting `IOptionsSnapshot` into a singleton is a captive dependency.
- **Decorators:** the built-in container has no `Decorate`; teams use Scrutor or
  register a factory that wraps the inner service.
- **Disposal:** the container disposes what it created, when its scope ends.
  Never dispose an injected service yourself. A disposable transient resolved
  from the root provider is held until shutdown, which is a slow memory leak.

[csharp/18](../../csharp/18-dependency-injection/) practises the basics.

## Node: do you need a container?

Usually not. ES modules are cached, so a module that exports an instance is
already a singleton:

```ts
// db.ts: a module singleton
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```

That's fine for the pool but awkward for tests, which then need module mocking.
The functional alternative is factory functions and a composition root:

```ts
export function makeOrderService(deps: { orders: OrderRepo; email: EmailSender; now: () => Date }) {
  return {
    async place(order: Order) {
      order.placedAt = deps.now();
      await deps.orders.add(order);
      await deps.email.sendConfirmation(order);
    },
  };
}

// app.ts: the composition root
const orderService = makeOrderService({ orders: pgOrderRepo(pool), email: resendSender(), now: () => new Date() });
```

For per-request state (the current user, a request id) without threading it
through every call, `AsyncLocalStorage` from `node:async_hooks` gives you a
request-scoped store. Containers exist when you want them: **NestJS** has one
built in, with default (singleton), `REQUEST` and `TRANSIENT` scopes and the same
captive-dependency behaviour, as request scope bubbles up to every consumer.
**tsyringe** and **awilix** are standalone containers; tsyringe relies on
decorators and `reflect-metadata`.

## Anti-patterns

- **Service locator:** injecting `IServiceProvider` and calling
  `GetService<T>()` inside methods. Dependencies become invisible and tests
  have to build a container. Only background scopes and factories should do it.
- **An interface per class:** `IOrderService` with one implementation that is
  never faked adds a file and nothing else. Extract an interface at a real seam:
  I/O, the clock, third parties.
- **Constructor explosion:** eight constructor parameters is not a DI problem,
  it is a class doing eight things. Split it.

## DI and testing

The payoff is that tests replace registrations rather than code:

```cs
factory.WithWebHostBuilder(b => b.ConfigureTestServices(services =>
{
    services.RemoveAll<IEmailSender>();
    services.AddSingleton<IEmailSender, FakeEmailSender>();
}));
```

Prefer a hand-written **fake** (an in-memory `IEmailSender` that records what
it sent) for things you check state on, and a **mock** only when the interaction
itself is the behaviour. The [.NET testing guide](dotnet-testing.md) covers the
full setup.

## What you should be able to answer

- Singleton, scoped, transient: give a real use for each.
- What is a captive dependency, why is it a bug, and how would you detect it?
- How do you use a scoped `DbContext` from a `BackgroundService`?
- Why is injecting `IServiceProvider` into a service a smell?
- Does a Node app need a DI container? What do you use instead?
- How do you replace one registration in an integration test?
