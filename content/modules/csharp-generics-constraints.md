# Generics and constraints in C#

Generics are everywhere in .NET: `List<T>`, `Task<T>`, `ILogger<T>`, `DbSet<T>`, `IOptions<T>`. Interviewers ask you to write a generic repository or cache, explain what a constraint buys you, and occasionally ask why `IEnumerable<string>` can be passed where `IEnumerable<object>` is expected. This guide covers what a mid-level developer should know; build [csharp/11](../../csharp/11-generics-lru/) to practise.

## Why generics exist

Before generics, reusable code took `object`. That meant casts at every call site, runtime `InvalidCastException`s instead of compile errors, and boxing for every value type.

```cs
// Without generics: casts, boxing, runtime errors
object Largest(object[] items) { /* ... */ return items[0]; }

// With generics: type-safe, no boxing, the type flows through
T Largest<T>(IEnumerable<T> items) where T : IComparable<T>
{
    T? best = default;
    bool any = false;
    foreach (var item in items)
        if (!any || item.CompareTo(best!) > 0) { best = item; any = true; }
    return any ? best! : throw new InvalidOperationException("Empty sequence");
}
```

Unlike TypeScript, C# generics are **reified**: the type argument exists at runtime. `typeof(T)` works, `List<int>` and `List<string>` are distinct runtime types, and the JIT generates specialised code for each value-type argument, so a `List<int>` stores raw `int`s. See [TypeScript generics](typescript-generics.md) for the erased, compile-time-only contrast.

## Generic methods, classes and interfaces

A generic **class** fixes `T` for the lifetime of each instance; a generic **method** picks `T` per call, usually by inference from the arguments.

```cs
public class Cache<TKey, TValue> where TKey : notnull
{
    private readonly Dictionary<TKey, TValue> _items = new();
    public bool TryGet(TKey key, out TValue? value) => _items.TryGetValue(key, out value);
}

public static T Clamp<T>(T value, T min, T max) where T : IComparable<T> =>
    value.CompareTo(min) < 0 ? min : value.CompareTo(max) > 0 ? max : value;

var n = Clamp(15, 0, 10); // T inferred as int
```

Inference works only from arguments, never from the return type. `T Parse<T>(string s)` must be called as `Parse<int>("42")`.

## Constraints: what you are allowed to do with T

Without constraints, the compiler lets you do only what works for every possible type: assign, compare with `null`, call `object` members. Constraints widen that.

| Constraint | Lets you | Example use |
|---|---|---|
| `where T : class` | Assume a reference type; `T?` means nullable reference | Repositories of entities |
| `where T : class?` | Reference type, nullable allowed | Rare |
| `where T : struct` | Assume a non-nullable value type; `T?` means `Nullable<T>` | Numeric helpers |
| `where T : notnull` | Forbid nullable type arguments | Dictionary keys |
| `where T : new()` | Call `new T()` | Factories, test builders |
| `where T : SomeBase` | Use base-class members | `where T : Entity` |
| `where T : ISomething` | Call interface members | `where T : IComparable<T>` |
| `where T : unmanaged` | Blittable value types only | Binary serialisation |
| `where T : struct, Enum` | Enum-specific helpers | `Enum.GetValues<T>()` wrappers |
| `where T : allows ref struct` (C# 13) | Accept `Span<T>` and other ref structs | Low-level library code |

Constraints combine: `where T : class, IEntity, new()`. The order is fixed: one primary constraint first (`class`, `struct`, `notnull`, `unmanaged` or a base class), then interfaces, then `new()`.

A typical repository:

```cs
public interface IEntity { int Id { get; } }

public class Repository<T>(AppDbContext db) where T : class, IEntity
{
    public Task<T?> FindAsync(int id, CancellationToken ct) =>
        db.Set<T>().FirstOrDefaultAsync(e => e.Id == id, ct);
}
```

`class` is needed because `DbContext.Set<T>()` requires it; `IEntity` makes `e.Id` compile.

## Equality and operators inside generic code

`a == b` does not compile for an unconstrained `T`, because the compiler cannot know which `==` to call. Use `EqualityComparer<T>.Default.Equals(a, b)`, which uses `IEquatable<T>` when available and avoids boxing.

For arithmetic, C# 11 added **static abstract interface members** and the generic math interfaces in `System.Numerics`:

```cs
static T Sum<T>(IEnumerable<T> values) where T : INumber<T>
{
    T total = T.Zero;
    foreach (var v in values) total += v;
    return total;
}
```

This works for `int`, `decimal`, `double` and your own types that implement the interfaces. You will mostly consume these interfaces rather than write your own.

## Static members are per closed type

Each constructed type has its own static fields. `Counter<int>.Count` and `Counter<string>.Count` are separate variables.

```cs
Counter<int>.Count++;
Counter<int>.Count++;
Counter<string>.Count++;
Console.WriteLine($"{Counter<int>.Count} {Counter<string>.Count}"); // 2 1

static class Counter<T> { public static int Count; }
```

This is a feature: a generic static class is a cheap per-type cache (`TypeCache<T>.Properties`), with no dictionary lookup and thread-safe initialisation through the static constructor.

## Variance: `out` and `in`

Can an `IEnumerable<string>` be used as an `IEnumerable<object>`? Yes, because `IEnumerable<out T>` is **covariant**: `T` only comes out, so a sequence of strings is safely a sequence of objects.

Can a `List<string>` be used as a `List<object>`? No. A list both accepts and returns `T`; if the conversion were allowed, you could add an `int` to a list of strings.

| Variance | Keyword | Direction | BCL examples |
|---|---|---|---|
| Covariant | `out T` | Derived to base | `IEnumerable<out T>`, `IReadOnlyList<out T>`, `Func<out TResult>` |
| Contravariant | `in T` | Base to derived | `IComparer<in T>`, `Action<in T>`, `IEqualityComparer<in T>` |
| Invariant | none | Exact match only | `List<T>`, `IList<T>`, `Dictionary<K, V>` |

Variance applies only to interfaces and delegates, and only to reference-type arguments: `IEnumerable<int>` is not an `IEnumerable<object>`. This is one more reason to accept `IReadOnlyList<T>` rather than `List<T>` in parameters.

## Nullable annotations and T?

With nullable reference types on, an unconstrained `T?` means "the default of T, which may be null" and is often used for `Find`-style methods. With `where T : struct`, `T?` is `Nullable<T>`. With `where T : class`, it is a nullable reference. When a generic method needs to express "may return default", `[return: MaybeNull]` or `T?` both work; `FirstOrDefault` is annotated this way.

## Generics and dependency injection

The ASP.NET Core container understands open generic registrations, so one line registers a repository for every entity type:

```cs
builder.Services.AddScoped(typeof(IRepository<>), typeof(Repository<>));
```

`ILogger<T>` is resolved the same way: the category name comes from `T`. The [dependency injection guide](dependency-injection-explained.md) covers lifetimes.

## When not to use generics

- A generic repository over EF Core often adds nothing: `DbSet<T>` already is one, and it hides the query shaping you need for performance. Many teams prefer query-specific methods.
- If a method only ever handles one or two types, overloads are clearer.
- If you find yourself checking `typeof(T)` inside a generic method to branch, you want polymorphism or separate methods.

## What you should be able to answer

- What problem do generics solve compared with `object` parameters?
- What does `where T : class, IEntity, new()` allow inside the method, and why is each part there?
- Why can you not use `==` on an unconstrained `T`, and what do you use instead?
- Why can `IEnumerable<string>` be passed as `IEnumerable<object>` but `List<string>` cannot be passed as `List<object>`?
- How do C# generics differ from TypeScript generics at runtime?
- How do you register a generic repository for every entity type in ASP.NET Core?
