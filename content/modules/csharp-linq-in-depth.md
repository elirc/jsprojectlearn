# LINQ in depth

LINQ is the part of C# you will use every day, and the part interviewers use to find out whether you know what your code actually does. "When does this query run?", "why did this page issue 400 queries?" and "what is the difference between `IEnumerable` and `IQueryable`?" all come from here. Build [csharp/04](../../csharp/04-linq-pipeline/) and [csharp/29](../../csharp/29-linq-deep-dive/) as you read.

## LINQ is a pipeline of iterators

Most LINQ operators are extension methods on `IEnumerable<T>` that return another `IEnumerable<T>`. They build a pipeline; nothing runs until something pulls items through it.

```cs
var query = orders
    .Where(o => o.Total > 100)     // nothing happens yet
    .Select(o => o.CustomerId);    // still nothing

foreach (var id in query)          // now each order flows through Where, then Select
    Console.WriteLine(id);
```

Items stream one at a time: the first order is filtered and projected before the second is even read. This is **deferred execution**, and it is the same model as JavaScript generators rather than array methods, which run eagerly.

## Deferred versus immediate operators

| Deferred, streaming | Deferred, but buffers everything on first pull | Immediate |
|---|---|---|
| `Where`, `Select`, `SelectMany`, `Take`, `Skip`, `Concat`, `Zip`, `Chunk`, `Index` | `OrderBy`, `GroupBy`, `Reverse`, `Distinct` (streams, but remembers keys), `Join` (buffers the inner side) | `ToList`, `ToArray`, `ToDictionary`, `ToHashSet`, `Count`, `Sum`, `Max`, `First`, `Single`, `Any`, `All` |

Two consequences you must be able to explain:

- **Multiple enumeration.** Every `foreach` or `Count()` over a deferred query runs it again from the source, repeating any side effects, database calls or expensive projections. If you will use the results twice, materialise once with `ToList()`.
- **Late exceptions and captured variables.** Errors inside a lambda surface when the query is enumerated, not where it was written, and a lambda sees a captured variable's value at enumeration time.

```cs
int min = 10;
var big = numbers.Where(n => n > min);
min = 100;
Console.WriteLine(big.Count());   // uses 100, not 10
```

## IEnumerable versus IQueryable

The same method names exist twice. `Enumerable.Where` takes a `Func<T, bool>`: compiled code that runs in memory. `Queryable.Where` takes an `Expression<Func<T, bool>>`: a data structure describing the lambda, which a provider such as EF Core translates to SQL.

```cs
IQueryable<Order> q = db.Orders.Where(o => o.Total > 100); // becomes SQL WHERE
IEnumerable<Order> e = db.Orders.AsEnumerable().Where(o => o.Total > 100); // loads every row, filters in memory
```

The switch from `IQueryable` to `IEnumerable` is silent. It happens when you call `AsEnumerable()`, when a method's parameter or return type is `IEnumerable<T>`, or when you pass a `Func<>` variable rather than a lambda, because a `Func` cannot become an expression tree. The result is correct but fetches the whole table. Keep query-building code on `IQueryable<T>` until the final `ToListAsync()`. The [EF Core query performance](ef-core-query-performance.md) guide goes further.

## Choosing the right single-item operator

| Operator | Zero matches | One match | Many matches |
|---|---|---|---|
| `First` | Throws | Returns it | Returns the first |
| `FirstOrDefault` | `default` (null) | Returns it | Returns the first |
| `Single` | Throws | Returns it | Throws |
| `SingleOrDefault` | `default` | Returns it | Throws |

Use `Single`/`SingleOrDefault` when more than one match would be a bug, such as lookup by a unique email; it documents intent and fails loudly. Use `First` with an `OrderBy`, since "first" without an ordering is arbitrary in SQL. Since .NET 6 you can pass the fallback: `FirstOrDefault(defaultValue)`.

For existence, use `Any()` rather than `Count() > 0`: `Any` stops at the first match, whereas `Count` walks the whole sequence (unless the source is a collection with a known count).

## Grouping, joining and set operations

`GroupBy` returns groups that each have a `Key` and are themselves sequences.

```cs
var totals = orders
    .GroupBy(o => o.Region)
    .Select(g => new { Region = g.Key, Count = g.Count(), Revenue = g.Sum(o => o.Total) });
```

.NET 9 added shortcuts that avoid building groups: `CountBy(o => o.Status)` yields `KeyValuePair<TKey, int>`, and `AggregateBy` folds values per key. `ToLookup` is the eager cousin of `GroupBy`: a read-only multi-map where a missing key returns an empty sequence rather than throwing.

`Join` is an inner join; unmatched elements vanish. .NET 10 added `LeftJoin` and `RightJoin` (which EF Core 10 translates to SQL); before that, a left join was `GroupJoin` plus `SelectMany(... .DefaultIfEmpty())`.

| Operator | SQL analogue | Notes |
|---|---|---|
| `Concat` | `UNION ALL` | Keeps duplicates |
| `Union` / `UnionBy` | `UNION` | Removes duplicates |
| `Intersect` / `IntersectBy` | `INTERSECT` | Hash-based, O(n + m) |
| `Except` / `ExceptBy` | `EXCEPT` | "In A but not B" |
| `Distinct` / `DistinctBy` | `DISTINCT` | `DistinctBy` keeps the first element per key |

The `...By` variants (.NET 6) take a key selector, as do `MinBy` and `MaxBy`, which return the whole element with the lowest or highest key rather than just the key.

## Equality inside LINQ

`Distinct`, `Union`, `GroupBy`, `ToDictionary` and `Contains` all use the default equality comparer. For a class without overridden equality, two objects with identical data are different. Fix it by using records, passing an `IEqualityComparer<T>`, or using a `...By` operator with a key. For strings, pass `StringComparer.OrdinalIgnoreCase` when case should not matter.

`ToDictionary` throws `ArgumentException` on a duplicate key. When duplicates are possible, group first or use `ToLookup`.

## Performance: what matters and what does not

LINQ to objects has overhead (delegate calls, iterator allocations), but it is rarely the bottleneck in a CRUD app. What does matter:

- **Accidental O(n²).** `list.Where(x => other.Contains(x.Id))` with `other` a `List<T>` scans `other` for every item. Build a `HashSet<T>` first.
- **Materialising too early or too often.** `ToList()` inside a loop, or `ToList()` before a filter that could have run in the database.
- **Enumerating a deferred query repeatedly.** See above.
- **Sorting to get one element.** `OrderBy(x => x.Price).First()` sorts everything; `MinBy(x => x.Price)` is a single pass.

In hot paths, a plain `foreach` can be clearer and faster. .NET 9 and 10 have made common operators such as `Where().Select()`, `Sum` and `Any` considerably cheaper, so measure before rewriting.

## Writing your own operator

A custom operator is an extension method with `yield return`, and it inherits deferred execution.

```cs
public static IEnumerable<T> WhereNotNull<T>(this IEnumerable<T?> source) where T : class
{
    foreach (var item in source)
        if (item is not null) yield return item;
}
```

One gotcha: argument validation inside an iterator runs only on the first `MoveNext`. Validate in a non-iterator wrapper method and delegate to a private iterator (or local function) if you want the error at the call site. The [iterators project](../../csharp/30-iterators-yield/) explores this.

## Query syntax

`from o in orders where o.Paid select o.Total` compiles to exactly the same method calls. Most teams use method syntax; query syntax earns its place with multiple `from` clauses, `let`, and joins, where it reads more like SQL.

## What you should be able to answer

- What is deferred execution, and which operators force a query to run?
- Why is enumerating the same query twice a problem, and how do you avoid it?
- What is the difference between `IEnumerable<T>` and `IQueryable<T>`, and how can you accidentally switch from one to the other?
- When do you use `Single` instead of `First`, and why `Any()` over `Count() > 0`?
- How do `Distinct` and `GroupBy` decide that two elements are equal?
- What LINQ patterns cause O(n²) behaviour, and how do you fix them?
