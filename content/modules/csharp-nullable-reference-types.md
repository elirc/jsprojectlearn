# Nullable reference types in practice

`NullReferenceException` is the most common crash in .NET code, and nullable reference types (NRT) are the language's answer. Every new .NET project has `<Nullable>enable</Nullable>` on, so interviewers expect you to read `string?`, explain what `!` does, and know where the analysis stops protecting you. Work through [csharp/05](../../csharp/05-null-safety-csharp/) alongside this guide.

## What NRT is, and what it is not

With NRT enabled, reference types are **non-nullable by default**. `string` means "should never be null"; `string?` means "may be null". The compiler tracks the null state of every variable through your code and warns when you might dereference null or assign null to a non-nullable slot.

```cs
string name = null;          // warning CS8600
string? nick = null;         // fine
Console.WriteLine(nick.Length); // warning CS8602: possible null dereference
if (nick is not null)
    Console.WriteLine(nick.Length); // fine: the compiler knows it is not null here
```

What it is **not**:

- It is not enforced at runtime. The IL for `string` and `string?` is the same `string`; only attributes record the annotation.
- It does not change behaviour. Enabling it on an existing project produces warnings, never different results.
- It is not a guarantee. Callers with NRT off, reflection, deserialisers and `!` can all hand you null.

That last point is why a public library method still starts with `ArgumentNullException.ThrowIfNull(arg)`.

## `int?` and `string?` are different things

For value types, `?` creates a real type: `int?` is `Nullable<int>`, a struct with `HasValue` and `Value`. For reference types, `?` is just an annotation.

| | `int?` | `string?` |
|---|---|---|
| Runtime type | `Nullable<int>` | `string` |
| Has `.Value` / `.HasValue` | Yes | No |
| Effect of the `?` | Changes storage and behaviour | Warnings only |

This split is why unconstrained generics are awkward: in `T? Find<T>()`, `T?` means `Nullable<T>` if you constrain `where T : struct`, and "the default, possibly null" otherwise.

## Null-state analysis and how to cooperate with it

The compiler understands the usual checks:

```cs
if (user is null) return NotFound();   // after this, user is non-null
ArgumentNullException.ThrowIfNull(input); // also narrows: marked [NotNull]
var city = order.Customer?.Address?.City ?? "unknown";
if (order is { Customer.Address.City: string c }) Console.WriteLine(c);
```

Prefer `is null` and `is not null` to `== null`: they cannot be redirected by an overloaded `==` operator.

The analysis is local to a method, so it cannot see what your helper methods guarantee. Attributes in `System.Diagnostics.CodeAnalysis` tell it:

| Attribute | Meaning | Example |
|---|---|---|
| `[NotNullWhen(true)]` | The out argument is non-null when the method returns true | `TryGetValue`, your own `TryFind` |
| `[MaybeNullWhen(false)]` | The out argument may be null when it returns false | Generic `TryGet<T>` |
| `[NotNull]` | The argument is non-null after the call returns (or it throws) | Guard helpers |
| `[MemberNotNull(nameof(_x))]` | The field is non-null after this method runs | `EnsureLoaded()` helpers |
| `[return: NotNullIfNotNull(nameof(input))]` | Returns non-null whenever the input is non-null | Normalise/trim helpers |

```cs
static bool TryFindUser(int id, [NotNullWhen(true)] out User? user)
{
    user = id == 1 ? new User("Ann") : null;
    return user is not null;
}

if (TryFindUser(1, out var u)) Console.WriteLine(u.Name); // no warning
```

## The `!` operator: a promise, not a check

`x!` (the null-forgiving operator) tells the compiler "trust me, this is not null". It generates no code. If you are wrong, you get the same `NullReferenceException` NRT was meant to prevent, just later and further from the cause.

Legitimate uses are narrow:

- EF Core navigation properties and `DbSet`s that the framework sets: `public Customer Customer { get; set; } = null!;`
- Tests, where you deliberately pass null to check a guard.
- After a check the compiler cannot follow, and even then an attribute is often better.

In code review, every `!` is a question: can this be a check or an attribute instead?

## Entities, DTOs and `required`

Nullable warnings on classes usually come from CS8618: "non-nullable property must contain a non-null value when exiting constructor". There are four fixes, and choosing well matters:

| Situation | Fix |
|---|---|
| Value genuinely optional | Make it nullable: `public string? MiddleName { get; set; }` |
| Every creator must provide it | `public required string Email { get; init; }` |
| Always set through the constructor | Assign it in the constructor (or use a record's positional parameter) |
| Framework-populated (EF navigations) | `= null!;` with a comment if it is not obvious |

`required` is enforced by the compiler at each object initialiser, and System.Text.Json (.NET 7+) rejects JSON that omits a required property. For request DTOs, that is a cheap first line of validation.

EF Core reads your annotations: a non-nullable `string` property becomes a `NOT NULL` column and a nullable one allows nulls. Turning NRT on in an existing EF project can therefore change the next migration. Review it before applying.

## Where the analysis stops protecting you

Know the gaps, because interviewers ask "so can I still get a NullReferenceException?":

- **Arrays and default structs.** `new string[3]` contains three nulls typed as `string`. `default(SomeStruct)` has null in its reference fields.
- **Deserialisation.** `JsonSerializer.Deserialize<Order>(json)` returns `Order?`, and a missing property leaves a non-nullable string null unless it is `required`.
- **Generic code** with unconstrained `T`, where the compiler must be conservative.
- **Libraries without annotations**, whose types are "oblivious": no warnings either way.
- **The `!` operator** and `#nullable disable` regions.

Validate at boundaries (HTTP input, files, external APIs) and trust the analysis inside.

## Turning it on in an existing codebase

Enabling NRT on a large project produces hundreds of warnings. Migrate incrementally:

1. Add `#nullable enable` to one file at a time, starting with leaf types such as DTOs and helpers, or set `<Nullable>warnings</Nullable>` to get warnings without changing annotations.
2. Annotate what is truly optional with `?`, and add guards or `required` for what is not.
3. Once the project is clean, set `<Nullable>enable</Nullable>` and `<WarningsAsErrors>nullable</WarningsAsErrors>` so regressions fail the build.

TypeScript developers will recognise this: it is `strictNullChecks` for C#, with the same "the types are a claim, validate the boundary" caveat covered in [runtime validation](typescript-runtime-validation.md).

## What you should be able to answer

- What does enabling nullable reference types change at compile time, and what does it change at runtime?
- What is the difference between `int?` and `string?`?
- What does `!` do, and when is it acceptable?
- How do you fix CS8618 on an entity versus a request DTO?
- What does `[NotNullWhen(true)]` do, and where have you seen it in the BCL?
- Give three ways you can still get a `NullReferenceException` with NRT enabled.
