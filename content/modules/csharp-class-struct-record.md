# Class, struct or record: choosing a type in C#

Modern C# gives you five ways to declare a type: `class`, `struct`, `record`, `record struct` and `readonly record struct`. "When would you use a record?" is now a standard interview question, and the answer reveals whether you think about identity, equality and immutability or just copy what the last project did. Pair this guide with [csharp/07](../../csharp/07-records-immutability/).

## The three questions that decide

Ask these about the thing you are modelling:

1. **Does it have identity?** Two customers with the same name are still two customers. Two `Money(10, "GBP")` values are interchangeable.
2. **Should it change after creation?** Entities change over their lifetime; messages, DTOs and value objects usually should not.
3. **Is it small and created in huge numbers?** Only then does avoiding a heap allocation matter.

| You are modelling | Pick | Why |
|---|---|---|
| EF Core entity, service, controller | `class` | Identity, mutable state, reference semantics |
| API request/response DTO | `record` (or class with `init`) | Immutable, value equality, readable `ToString` |
| Domain event, command, message | `record` | Immutable data that is compared and logged |
| Small value object used heavily: money, coordinates | `readonly record struct` | Value equality, no allocation |
| Interop or performance-critical buffer element | `struct` | Full control over layout |

## class: identity and behaviour

A class is a reference type. Equality is reference equality unless you override it, the default value is `null`, and it supports inheritance. Services and entities are classes because their identity matters: EF Core's change tracker, for example, tracks *this instance* of `Order`, not "an order that looks like this".

```cs
public class Order
{
    public int Id { get; private set; }
    public OrderStatus Status { get; private set; } = OrderStatus.Draft;
    private readonly List<OrderLine> _lines = [];
    public IReadOnlyList<OrderLine> Lines => _lines;

    public void AddLine(Product p, int qty) { /* enforce rules here */ }
}
```

Encapsulate: private setters and methods that enforce invariants, not public setters that let any caller put the object into an invalid state.

## record: data with value equality

A `record` (short for `record class`) is still a reference type, but the compiler generates value-based equality, `GetHashCode`, a readable `ToString`, a `Deconstruct` method, and support for `with`.

```cs
var a = new Point(1, 2);
var b = a with { Y = 5 };      // non-destructive copy
Console.WriteLine(a == new Point(1, 2)); // True
Console.WriteLine(b);                    // Point { X = 1, Y = 5 }

public record Point(int X, int Y);
public record CreateOrderRequest(int CustomerId, List<int> ProductIds);
```

Details interviewers probe:

- Positional parameters become public `init` properties, so a record is immutable by default (shallowly).
- Equality compares every field with its own `Equals`. A `List<T>` member uses reference equality, so two records holding equal-looking lists are **not** equal. Use `ImmutableArray<T>` with a custom comparison, or leave collections out of equality-sensitive records.
- Records also compare their runtime type through a generated `EqualityContract`, so a derived record never equals a base record with the same values.
- `with` makes a shallow copy: the new record shares any reference-type members with the old one.

Records suit DTOs: System.Text.Json deserialises positional records through their constructor, and minimal API parameters bind to them happily.

## Why records are a poor fit for entities

It is tempting to make EF Core entities records. Resist:

- Value equality clashes with identity. Two instances representing different rows but with the same values would compare equal, which confuses sets and dictionaries.
- `with` creates a new, untracked instance. Modify it and `SaveChanges` does nothing.
- A hash code that changes when properties change breaks `HashSet<T>` membership.

Keep entities as classes; map to and from record DTOs at the API boundary.

## struct and record struct: values without allocation

Structs are value types: copied on assignment, stored inline, zeroed by default, no inheritance. `record struct` adds generated equality and `ToString`. Watch the difference in mutability:

```cs
public record struct Size(int Width, int Height);          // properties are get; set;
public readonly record struct Money(decimal Amount, string Currency); // get; init;
```

A positional `record struct` has **settable** properties, unlike a `record` class. Add `readonly` to get immutability and to let the compiler avoid defensive copies. Keep structs small (roughly 16 bytes; `Money` above is 24 on 64-bit, which is still reasonable) because every assignment and parameter pass copies the whole thing.

`default(Money)` gives `Amount = 0` and `Currency = null` regardless of constructors, so a struct must tolerate its zeroed state. That is another reason entities are classes.

## Immutability tools for any type

You do not need a record to be immutable:

| Feature | What it does |
|---|---|
| `init` accessor | Settable only in the constructor or an object initialiser |
| `required` (C# 11) | Compiler error if an initialiser omits the member |
| `readonly` field | Assignable only in the declaration or constructor |
| Primary constructor on a class (C# 12) | Parameters are captured as mutable hidden fields, not properties |

```cs
public class UserDto
{
    public required string Email { get; init; }
    public string? DisplayName { get; init; }
}
```

The primary constructor detail catches people out: on a class, `class Report(ILogger<Report> logger)` does **not** create a property, and the captured parameter can be reassigned inside the class. On a record, the same syntax creates `init` properties. For services taking injected dependencies, the class form is fine and saves boilerplate.

## Equality, summarised

| Type | `==` by default | `Equals` by default |
|---|---|---|
| `class` | Reference | Reference |
| `record` | Value (+ runtime type) | Value (+ runtime type) |
| `struct` | Does not compile unless you define it | Field by field via reflection (slow, boxes) |
| `record struct` | Value | Value, generated and fast |
| `string` | Contents (ordinal) | Contents (ordinal) |

If you override `Equals` on a class, override `GetHashCode` too (use `HashCode.Combine`), or dictionary and set lookups will fail.

## Inheritance and sealing

Records can inherit from records; classes from classes; structs from nothing. Inheritance hierarchies of entities are usually a mistake in CRUD code; prefer composition and interfaces ([generics and constraints](csharp-generics-constraints.md) and [delegates](csharp-delegates-events-lambdas.md) cover the alternatives). Mark classes `sealed` unless you designed them for inheritance: it documents intent, and the JIT can devirtualise calls on sealed types.

## What you should be able to answer

- How do you decide between a class, a record and a struct for a given concept?
- What does the compiler generate for `public record Point(int X, int Y);`?
- Why are two records containing equal lists not equal?
- Why should EF Core entities not be records?
- What is the difference between `record struct` and `readonly record struct`?
- What does a primary constructor create on a class versus on a record?
