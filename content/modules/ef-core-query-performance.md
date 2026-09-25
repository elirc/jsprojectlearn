# EF Core query performance

Once you can explain N+1 and `IQueryable`, mid-level .NET interviews move on to
"this endpoint is slow, what do you look at?". A strong answer starts from the
SQL EF actually sends and works through tracking, query shape, round trips and
indexes. This guide assumes the basics in [orm-and-ef-core.md](orm-and-ef-core.md).

## Step one: read the SQL

Never tune a LINQ query you have not seen translated. Three tools:

```cs
var query = db.Orders
    .Where(o => o.CustomerId == customerId && o.Status == OrderStatus.Open)
    .OrderByDescending(o => o.CreatedAt)
    .TagWith("Orders: open orders for customer");

Console.WriteLine(query.ToQueryString());   // the SQL, without executing it
```

- **`ToQueryString()`** prints the SQL for one query, with parameter
  declarations. Useful in a test or a debugger watch.
- **`LogTo(Console.WriteLine, LogLevel.Information)`** on the options logs every
  command with its duration. In a real app you get the same through the
  `Microsoft.EntityFrameworkCore.Database.Command` logging category.
- **`TagWith`** adds a SQL comment, so the query is identifiable in SQL Server's
  Query Store or `pg_stat_statements`.

`EnableSensitiveDataLogging()` adds parameter values to those logs. It is
invaluable locally and a data leak in production; gate it on
`builder.Environment.IsDevelopment()`. Once you have the SQL, take the
execution plan in the database (`SET STATISTICS IO ON` on SQL Server,
`EXPLAIN (ANALYZE, BUFFERS)` on Postgres) — see
[sql-fundamentals.md](sql-fundamentals.md).

## Project what you need

Loading entities fetches every mapped column and, by default, starts tracking
them. A projection fetches only the columns it names:

```cs
var rows = await db.Orders
    .Where(o => o.Status == OrderStatus.Open)
    .Select(o => new OrderListItem(o.Id, o.CreatedAt, o.Customer.Name, o.Items.Count))
    .ToListAsync(ct);
```

That compiles to one query with a join and a correlated count, and none of the
results are tracked because they are not entities. For read endpoints that feed
a DTO, a projection is almost always the fastest correct option, and it removes
the need for `Include` entirely.

## Tracking modes

When you do need entities but will not modify them, turn tracking off:

| Mode | Snapshot kept? | Same row twice gives | Use for |
|---|---|---|---|
| Tracking (default) | Yes | One instance | Load, modify, `SaveChanges` |
| `AsNoTracking()` | No | Two separate instances | Read-only lists and details |
| `AsNoTrackingWithIdentityResolution()` | No | One instance | Read-only graphs where rows repeat |

Tracking costs memory and CPU: EF stores an original-values snapshot per
entity and runs identity resolution on every row. `AsNoTracking` skips both.
The trade-off appears when a query returns the same principal many times — ten
orders for one customer with `Include(o => o.Customer)` produces ten `Customer`
objects without identity resolution. If a context is used mostly for reads, set
the default with `UseQueryTrackingBehavior(QueryTrackingBehavior.NoTracking)`
and opt back in with `AsTracking()`.

## Single vs split queries

`Include` on a collection produces a `JOIN`. Include two sibling collections and
the rows multiply — the **cartesian explosion**:

```cs
var orders = await db.Orders
    .Include(o => o.Items)       // 20 items
    .Include(o => o.Payments)    // 5 payments  -> 100 rows per order
    .AsSplitQuery()
    .ToListAsync(ct);
```

`AsSplitQuery()` sends one query per included collection instead. You can make
it the default per context:

```cs
options.UseSqlServer(cs, sql => sql.UseQuerySplittingBehavior(QuerySplittingBehavior.SplitQuery));
```

and opt out per query with `AsSingleQuery()`. Neither is always right:

- **Single** — one round trip, one consistent snapshot, but duplicated data
  and possible explosion.
- **Split** — no duplication, but several round trips, and without a
  serializable or snapshot transaction the data can change between them.

EF logs a warning when you load several collections in single-query mode
without having chosen a behaviour. Treat it as a prompt to decide, and remember
that a projection often avoids the question.

## Client evaluation: only the final Select

Since EF Core 3.0, EF will evaluate C# on the client **only in the top-level
projection**. Anywhere else, an untranslatable expression throws:

```cs
// Fine: FormatName runs in .NET on each result row
db.Customers.Select(c => new { c.Id, Display = FormatName(c.First, c.Last) });

// Throws InvalidOperationException: "could not be translated"
db.Customers.Where(c => FormatName(c.First, c.Last).StartsWith("A"));
```

This is deliberate. Before 3.0, EF silently pulled the whole table and filtered
in memory. If you truly want client-side work, make it explicit with
`AsEnumerable()` after the part the database should do — and make sure that
part already filters the rows down.

## Fewer round trips and less overhead

**Batching.** `SaveChanges` sends all pending inserts, updates and deletes in as
few round trips as the provider allows, inside one transaction. Adding 500
entities and calling `SaveChanges` once is far faster than calling it 500
times. Providers expose `MaxBatchSize` if you need to tune it.

**Set-based writes.** `ExecuteUpdateAsync` and `ExecuteDeleteAsync` (EF 7+) run a
single `UPDATE` or `DELETE` without loading anything. They bypass the change
tracker, so tracked entities go stale and `SaveChanges` interceptors do not
run. EF 10 also lets the setter argument be an ordinary lambda, so you can add
setters conditionally.

**DbContext pooling.** Creating a context is cheap but not free; pooling
reuses instances and resets their state:

```cs
builder.Services.AddDbContextPool<AppDb>(o => o.UseNpgsql(cs));
```

The catch: the context must not hold per-request state of its own, because it
outlives the request. A constructor that takes a scoped service (a tenant
provider, say) does not work with the pool; `AddPooledDbContextFactory` plus a
scoped wrapper is the documented workaround.

**Compiled queries.** For a hot, fixed-shape query, compile the LINQ-to-SQL
translation once:

```cs
private static readonly Func<AppDb, int, Task<Order?>> OrderById =
    EF.CompileAsyncQuery((AppDb db, int id) =>
        db.Orders.AsNoTracking().FirstOrDefault(o => o.Id == id));

var order = await OrderById(db, id);
```

EF already caches translations, so the gain is modest; measure before using it.

## Pagination and indexes

`Skip(n).Take(20)` translates to `OFFSET n ROWS FETCH NEXT 20` (or
`LIMIT/OFFSET`). The database still reads and discards the first `n` rows, so
page 5,000 is slow, and rows inserted meanwhile shift pages. Keyset (seek)
pagination filters on the last value seen:

```cs
var page = await db.Orders
    .Where(o => o.CreatedAt < lastCreatedAt
             || (o.CreatedAt == lastCreatedAt && o.Id < lastId))
    .OrderByDescending(o => o.CreatedAt).ThenByDescending(o => o.Id)
    .Take(20)
    .ToListAsync(ct);
```

With an index on `(CreatedAt, Id)` every page costs the same. The price is no
"jump to page 37". The API side is in
[api-pagination-filtering.md](api-pagination-filtering.md), and
[csharp/34](../../csharp/34-pagination-filtering/) builds both.

### Indexes from the model

EF creates indexes for foreign keys automatically. Everything else you declare:

```cs
[Index(nameof(Email), IsUnique = true)]
public class Customer { /* ... */ }

modelBuilder.Entity<Order>()
    .HasIndex(o => new { o.CustomerId, o.CreatedAt })
    .HasFilter("[Status] = 0");   // provider SQL: a filtered/partial index
```

Column order matters: an index on `(CustomerId, CreatedAt)` serves
`WHERE CustomerId = @c ORDER BY CreatedAt` but not a filter on `CreatedAt`
alone. Indexes arrive through a migration like any other schema change (see
[ef-core-migrations-in-teams.md](ef-core-migrations-in-teams.md)).

## Raw SQL when LINQ cannot say it

```cs
// Entity type, composable: EF wraps it and can add Where/OrderBy
var recent = await db.Orders
    .FromSql($"SELECT * FROM Orders WHERE CreatedAt > {since}")
    .Where(o => o.Status == OrderStatus.Open)
    .ToListAsync(ct);

// EF 8+: any unmapped type, mapped by column name
var totals = await db.Database
    .SqlQuery<CustomerTotal>($"SELECT CustomerId, SUM(Total) AS Total FROM Orders GROUP BY CustomerId")
    .ToListAsync(ct);
```

Both take a `FormattableString`, so `{since}` becomes a parameter, not string
concatenation. `ExecuteSqlAsync` runs non-query commands the same way.

## Parameterised collections

`ids.Contains(o.Id)` used to inline the values as constants, so every distinct
list produced a new SQL string and a new cached plan. EF 8 changed that: on SQL
Server the list is sent as one JSON parameter and expanded with `OPENJSON`; on
Postgres it becomes an array parameter with `= ANY(@ids)`.

```sql
-- EF 8/9 on SQL Server
WHERE [o].[Id] IN (SELECT [i].[value] FROM OPENJSON(@ids) WITH ([value] int '$') AS [i])
```

One plan, but the optimiser cannot see how many values there are. EF 9 added
`EF.Constant(ids)` and `EF.Parameter(ids)` to override the translation per
query. **EF 10** changes the default on SQL Server to multiple scalar
parameters (`IN (@ids1, @ids2, ...)`), padding the count so that plans are
still reused while giving the optimiser cardinality information. If an upgrade
changes a plan, this is a likely suspect.

## What you should be able to answer

- How do you see the SQL EF generates, and why should `EnableSensitiveDataLogging` never reach production?
- When do you use `AsNoTracking` versus `AsNoTrackingWithIdentityResolution`?
- What is a cartesian explosion, and what are the costs of fixing it with split queries?
- Why does a `Where` that calls your own C# method throw, while the same call in `Select` works?
- Why is keyset pagination faster than `Skip`/`Take` on deep pages, and what does it give up?
- How does `ids.Contains(o.Id)` translate in EF 8, and what changes in EF 10?
