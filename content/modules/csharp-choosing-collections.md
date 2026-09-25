# Choosing a collection in .NET

"Which collection would you use here, and why?" sounds basic, but the answer shows whether you think in terms of lookups, ordering, mutation and thread safety. Picking `List<T>` for everything works until a `Contains` call in a loop turns a 50 ms request into a 5 s one. Build [csharp/03](../../csharp/03-collections-choice/) alongside this guide.

## Start from the operation, not the type

Before choosing, name the operation you will do most:

| Main operation | Choose | Cost |
|---|---|---|
| Append and iterate in order, access by index | `List<T>` | O(1) index, amortised O(1) add |
| Fixed-size data, or the result of a query | `T[]` | O(1) index, no growth |
| Look up a value by key | `Dictionary<TKey, TValue>` | O(1) average |
| "Have I seen this?" and de-duplication | `HashSet<T>` | O(1) average `Add`/`Contains` |
| Keys kept in sorted order | `SortedDictionary` / `SortedSet` | O(log n) |
| First in, first out | `Queue<T>` | O(1) |
| Last in, first out | `Stack<T>` | O(1) |
| Always take the lowest priority first | `PriorityQueue<TElement, TPriority>` | O(log n) |
| Build once at startup, read many times | `FrozenDictionary` / `FrozenSet` | Fastest reads, slow build |
| Shared between threads | `ConcurrentDictionary`, `Channel<T>` | Thread-safe |

## List<T>: the default, and its costs

`List<T>` wraps an array. When it fills up, it allocates an array twice the size and copies everything across, so adding is amortised O(1). If you know the size roughly, pass a capacity: `new List<Order>(expectedCount)`.

What is **not** cheap on a list:

- `Contains`, `IndexOf` and `Remove(item)` scan linearly: O(n).
- `Insert(0, x)` and `RemoveAt(0)` shift every element: O(n). Use a `Queue<T>` or `LinkedList<T>` if you do this constantly.
- Modifying a list inside a `foreach` over it throws `InvalidOperationException`.

The most common performance bug in collection code:

```cs
// O(n * m): Contains scans the list for every order
var vipOrders = orders.Where(o => vipIds.Contains(o.CustomerId)).ToList();

// O(n + m): build a set once
var vipSet = vipIds.ToHashSet();
var vipOrders2 = orders.Where(o => vipSet.Contains(o.CustomerId)).ToList();
```

## Dictionary<TKey, TValue>: lookups done right

A dictionary hashes the key to find a bucket, then compares keys with `Equals`. That gives O(1) average lookups, with conditions:

- The key's `GetHashCode` and `Equals` must agree, and must not change while the key is in the dictionary. Never use a mutable object whose hash depends on mutable fields as a key.
- String keys are case-sensitive and ordinal by default. Pass a comparer when that is wrong: `new Dictionary<string, User>(StringComparer.OrdinalIgnoreCase)`.
- Iteration order is not guaranteed. It often looks like insertion order until you remove something. If order matters, sort, or use `SortedDictionary`, or keep a separate list.

The API choices matter:

```cs
if (cache.TryGetValue(key, out var value)) { /* one lookup */ }
cache[key] = value;            // add or overwrite
cache.Add(key, value);         // throws if the key exists
cache.TryAdd(key, value);      // returns false if the key exists
```

`dict[key]` throws `KeyNotFoundException` for a missing key; `TryGetValue` and `GetValueOrDefault` do not. Since .NET Core 3.0 you may call `Remove` while enumerating a `Dictionary`; `Add` during enumeration still throws.

## HashSet<T>: membership and set logic

A `HashSet<T>` is a dictionary with keys only. `Add` returns `false` for a duplicate rather than throwing, which makes de-duplication a one-liner:

```cs
var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
foreach (var email in emails)
    if (!seen.Add(email)) Console.WriteLine($"Duplicate: {email}");
```

It also has in-place set operations: `UnionWith`, `IntersectWith`, `ExceptWith`, `IsSubsetOf`, `Overlaps`.

## Queues, stacks and priority queues

`Queue<T>` suits in-memory work lists processed in arrival order; `Stack<T>` suits undo history and depth-first traversal. `PriorityQueue<TElement, TPriority>` (.NET 6) dequeues the element with the **lowest** priority value first, and does not guarantee order among equal priorities. For "highest first", pass a reversed comparer or negate numeric priorities.

In a web app, an in-memory queue disappears on restart. Background work that must survive a deploy needs a durable queue; see [background jobs and queues](background-jobs-and-queues.md). For in-process producer/consumer pipelines, `Channel<T>` is the modern, async-friendly choice.

## Read-only versus immutable versus frozen

These are three different promises, and interviewers like the distinction:

| Type | Promise | Can the data change? |
|---|---|---|
| `IReadOnlyList<T>`, `IReadOnlyDictionary<K, V>` | *You* cannot change it through this reference | Yes, the owner can |
| `ReadOnlyCollection<T>` (`list.AsReadOnly()`) | A wrapper with no mutating methods | Yes, it reflects the underlying list |
| `ImmutableList<T>`, `ImmutableArray<T>`, `ImmutableDictionary<K, V>` | Nobody can change it; "mutations" return a new collection | No |
| `FrozenDictionary<K, V>`, `FrozenSet<T>` (.NET 8) | Immutable and optimised for reads | No |

Frozen collections spend extra time at construction to make lookups faster. Build them once for data that is fixed for the life of the app, such as a country-code table loaded at startup, and store them in a singleton. They are the wrong choice for anything you rebuild per request.

`ImmutableList<T>.Add` returns a new list. Forgetting to use the return value is the classic bug. For small immutable data read far more often than it changes, `ImmutableArray<T>` is usually cheaper than `ImmutableList<T>`.

## What to accept and what to return

In method signatures, be liberal in what you accept and specific in what you return:

- **Parameters**: accept the least capable interface you need. `IEnumerable<T>` if you iterate once; `IReadOnlyCollection<T>` if you need `Count`; `IReadOnlyList<T>` if you index. Accept `IList<T>` only if you will modify the caller's collection, which is rare and surprising.
- **Return types**: return `IReadOnlyList<T>` (backed by a list or array) from services, so callers know the results are materialised and cannot mutate your internal state. Returning `IEnumerable<T>` from a method that wraps a lazy LINQ query invites multiple enumeration.
- **Empty results**: return an empty collection (`[]`), never `null`.

Collection expressions (C# 12) work across all of these: `List<int> a = [];`, `int[] b = [1, 2, 3];`, `ImmutableArray<int> c = [.. a, 4];`.

## Thread safety

Standard collections are safe for many concurrent readers, but not for any writer alongside readers or other writers. A `List<T>` or `Dictionary` held in a singleton and written by concurrent requests can corrupt itself, throw odd exceptions, or loop forever.

| Need | Use |
|---|---|
| Shared cache or counters keyed by id | `ConcurrentDictionary<K, V>` (`GetOrAdd`, `AddOrUpdate`) |
| Producer/consumer work hand-off | `Channel<T>` |
| Read-mostly data swapped occasionally | An immutable or frozen collection behind a field you replace atomically |
| Anything else | A `lock` around a normal collection |

`ConcurrentDictionary.GetOrAdd` can run the value factory more than once for the same key under contention; wrap the value in `Lazy<T>` if creation must happen exactly once.

## What you should be able to answer

- Which collection would you use for lookup by id, for de-duplication, and for a priority work list, and what are their costs?
- Why is `list.Contains` inside a loop a problem, and how do you fix it?
- What must be true of a type used as a dictionary key?
- What is the difference between read-only, immutable and frozen collections?
- What should a service method accept and return, and why not return `null` for "no results"?
- Which collections are safe to share across requests in a singleton?
