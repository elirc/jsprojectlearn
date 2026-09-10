# ORMs, EF Core, and the queries they hide

An ORM maps rows to objects so you write C# instead of SQL. The trade-off is
that it generates queries you did not write and cannot see unless you look. An
ORM you do not understand will happily issue 400 queries for one page load.

This guide is EF Core specific in its examples, but the concepts transfer
directly to Prisma, TypeORM, Hibernate and the rest.

## The mental model

`DbContext` is two things at once:

1. **A unit of work** — it tracks the changes you make and writes them all on
   `SaveChanges()`.
2. **A query builder** — `DbSet<T>` is an `IQueryable<T>` you compose LINQ onto,
   which is translated to SQL when you enumerate it.

Both of those have consequences people get caught by.

## Change tracking

```csharp
var order = await db.Orders.FirstAsync(o => o.Id == 7);
order.Status = "shipped";
await db.SaveChangesAsync();   // generates UPDATE ... SET status = ...
```

No explicit update call. The context snapshotted the entity when it loaded it,
compares on save, and writes only the changed columns.

The cost: snapshotting every loaded entity is real work and memory. For a
read-only query — which is most of them — turn it off:

```csharp
var orders = await db.Orders
    .AsNoTracking()
    .Where(o => o.CustomerId == id)
    .ToListAsync();
```

Measurably faster on large result sets, and it is the single easiest EF
performance win to mention in an interview.

## IQueryable vs IEnumerable — the one that matters most

```csharp
// BAD: fetches every user, then filters in your process
var users = db.Users.ToList()
    .Where(u => u.IsActive)
    .Take(10);

// GOOD: filter and limit become SQL
var users = await db.Users
    .Where(u => u.IsActive)
    .Take(10)
    .ToListAsync();
```

While the chain is `IQueryable`, LINQ builds an **expression tree** the provider
translates to SQL. The moment you call `ToList()`, `AsEnumerable()`, or iterate,
you have `IEnumerable` and everything after runs in memory over rows already
fetched.

This is the highest-value EF Core question there is, and the bug is invisible
until the table gets big.

A related trap: not every C# expression can be translated. Call a local method
inside a `Where` and EF either throws or silently falls back to client
evaluation (older versions did the latter, which is how people ended up loading
whole tables by accident).

## Deferred execution

The query does not run when you write it. It runs when you enumerate it — which
means:

```csharp
var query = db.Orders.Where(o => o.Status == "open");
var count = await query.CountAsync();     // SELECT COUNT(*)
var list  = await query.ToListAsync();    // SELECT * — a second round trip
```

Two queries, not one. Fine if intended; wasteful if not.

## The N+1 problem, in ORM form

```csharp
var orders = await db.Orders.Take(100).ToListAsync();
foreach (var o in orders)
{
    Console.WriteLine(o.Customer.Name);   // one query per order
}
```

101 queries. The property access looks free and is not.

**Fixes, best first:**

```csharp
// 1. Project only what you need — fetches fewer columns AND one query
var rows = await db.Orders
    .Select(o => new OrderRow(o.Id, o.Total, o.Customer.Name))
    .ToListAsync();

// 2. Eager load the navigation
var orders = await db.Orders
    .Include(o => o.Customer)
    .ToListAsync();

// 3. Split query, when Include creates a cartesian explosion
var orders = await db.Orders
    .Include(o => o.Items)
    .AsSplitQuery()
    .ToListAsync();
```

Option 3 matters when you include multiple collections: a single joined query
multiplies rows (10 items × 5 payments = 50 rows carrying duplicated order
data). `AsSplitQuery` issues one query per collection instead.

**How you detect it:** log the generated SQL in development.

```csharp
builder.Services.AddDbContext<AppDb>(o => o
    .UseNpgsql(cs)
    .LogTo(Console.WriteLine, LogLevel.Information)
    .EnableSensitiveDataLogging());   // development only — it logs parameter values
```

Watching your own SQL scroll past is the fastest way to develop ORM intuition.

## Why DbContext is Scoped

It is **not thread-safe** and it holds per-request change-tracking state. Two
concurrent requests sharing one would corrupt each other.

That is why injecting a `DbContext` into a **singleton** is a bug — the classic
**captive dependency**. The singleton captures one context at construction and
reuses it forever, across every request and thread.

For background work, create your own scope:

```csharp
using var scope = scopeFactory.CreateScope();
var db = scope.ServiceProvider.GetRequiredService<AppDb>();
```

Note also that within one context, awaiting two EF queries concurrently throws —
`DbContext` allows one operation at a time.

## Migrations

```
dotnet ef migrations add AddShippedAtToOrders
dotnet ef database update
```

EF diffs your model against the last migration's snapshot and generates a class
with `Up` and `Down`. **Read the generated code before committing it** — a
rename is frequently scaffolded as a drop plus an add, which destroys data.

Applying migrations automatically at startup is convenient and risky: a failed
migration takes the app down, and multiple replicas starting simultaneously race
each other. Better is a dedicated pipeline step, or an init container, that runs
once before the new version starts.

For anything on a large live table, use expand/contract (see the SQL guide):
add nullable, backfill in batches, dual-write, migrate reads, then tighten the
constraint. This is also what makes rolling deploys safe, because old and new
code run simultaneously.

## Transactions

`SaveChanges()` is already a transaction — every tracked change commits or none
does. You only need an explicit one to span multiple saves or raw commands:

```csharp
await using var tx = await db.Database.BeginTransactionAsync();
try
{
    // ... several SaveChangesAsync calls
    await tx.CommitAsync();
}
catch
{
    await tx.RollbackAsync();
    throw;
}
```

Keep them short. A transaction held open across an HTTP call to a payment
provider holds locks for the duration of someone else's outage.

## Concurrency

Add a concurrency token and EF adds it to the WHERE clause of every update:

```csharp
public class Order
{
    public int Id { get; set; }
    [Timestamp] public byte[] RowVersion { get; set; } = default!;
}
```

If zero rows are affected, EF throws `DbUpdateConcurrencyException` — catch it
and return 409 with a message the user can act on.

## Repository pattern: have an opinion

The question comes up constantly for .NET roles.

**Against:** `DbContext` is already a unit of work and `DbSet<T>` is already a
repository. A repository that only forwards `GetById` and `Add` adds a layer and
removes EF's expressiveness (no `Include`, no projection, no composable
queries).

**For:** a repository expressing *domain-meaningful* queries —
`FindOverdueInvoicesFor(customerId)` — keeps query logic out of controllers,
gives you one place to enforce tenant filtering, and makes unit tests trivial.

The defensible position: **do not wrap EF for the sake of it; do extract a
named query object when the query has domain meaning or appears more than
once.** Say that and explain the trade-off, and it lands well either way.

## Testing data access

The in-memory provider does not enforce constraints, does not translate SQL, and
allows queries a real database rejects — so tests can pass against behaviour
that will fail in production. It is acceptable for testing code *around* the
data layer, not for testing the data layer.

Better: SQLite in-memory for speed with real SQL semantics, or a containerised
Postgres/SQL Server for the real thing. `WebApplicationFactory` plus a
containerised database is the setup that actually catches problems.

## The checklist

- [ ] `AsNoTracking()` on read-only queries
- [ ] `ToList()` at the *end* of the chain, never the middle
- [ ] SQL logging on in development, and you have actually read it
- [ ] Navigation properties in loops are eager-loaded or projected
- [ ] `AsSplitQuery` where multiple collections are included
- [ ] DbContext is Scoped and never injected into a singleton
- [ ] Migrations reviewed before commit, applied by the pipeline
- [ ] A concurrency token on anything two users can edit
