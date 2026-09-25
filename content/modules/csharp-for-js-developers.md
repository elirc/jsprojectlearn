# C# for JavaScript and TypeScript developers

If you already write TypeScript, C# will look familiar within an hour: classes, generics, `async`/`await`, lambdas, even `?.` and `??`. The trouble is that the familiar syntax sits on a different runtime model, and interviewers for full-stack .NET roles probe exactly the places where JavaScript instincts mislead you. This guide maps what transfers, what changes, and what has no equivalent. Start with [csharp/01](../../csharp/01-hello-fizzbuzz/).

## The big differences in one table

| Topic | JavaScript / TypeScript | C# |
|---|---|---|
| Types | TS types erased at build time | Types exist at runtime; casts are checked |
| Numbers | One `number` (double) | `int`, `long`, `decimal`, `double`, ...; `7 / 2 == 3` |
| Objects | Everything is a reference | Value types (structs) *and* reference types |
| Missing values | `undefined` and `null` | `null` only; value types need `int?` |
| Equality | `===` reference for objects | `==` can be overloaded; records and strings compare by value |
| Concurrency | Single thread, event loop | Thread pool; code after `await` can run in parallel |
| Modules | ES modules, one file per module | Namespaces and assemblies; files are not modules |
| Collections | `Array`, `Map`, `Set` | `List<T>`, `Dictionary<K, V>`, `HashSet<T>`, arrays |
| Array methods | `map`, `filter`, `reduce` (eager) | LINQ `Select`, `Where`, `Aggregate` (lazy) |
| Package manager | npm | NuGet (`dotnet add package`) |

## Static types that exist at runtime

TypeScript's types disappear when compiled; a `User` annotation on parsed JSON is a promise nobody checks. C# types are real at runtime: `obj is User`, `typeof(T)` and generic type arguments all work, and an invalid cast throws `InvalidCastException` immediately.

That changes how you write code:

- **No structural typing.** A class must declare that it implements an interface; having the right shape is not enough. Anonymous types and tuples are the exceptions.
- **`var` is not `any`.** `var x = 5;` is an `int` for ever. The closest thing to `any` is `dynamic`, which you should almost never use.
- **Deserialisation is typed.** `JsonSerializer.Deserialize<Order>(json)` builds a real `Order`. Missing properties get default values, so pair it with `required` members or validation.
- **Overloading exists.** Several methods can share a name with different parameter lists, which TypeScript can only fake.

## Numbers, strings and dates

C# has distinct numeric types, and integer division truncates.

```cs
Console.WriteLine(7 / 2);      // 3
Console.WriteLine(7 / 2.0);    // 3.5
decimal price = 9.99m;         // m suffix: decimal literal; use decimal for money
int n = int.MaxValue; n++;     // wraps to int.MinValue unless in a checked context
```

Strings are immutable like JavaScript's, but `char` is its own type, and `$"..."` replaces template literals. Compare strings with an explicit `StringComparison` when case or culture matter. For dates, use `DateTimeOffset` for timestamps, `DateOnly` for dates of birth, and inject `TimeProvider` rather than calling `DateTime.UtcNow` directly, so tests can control time.

## Values, references and null

In JavaScript, primitives copy and objects share. C# lets you define your own copy-on-assign types with `struct`, and a struct is never null: its default is zeroed fields. There is no `undefined`; an unassigned field is `null` or zero, and the compiler refuses to let you read an unassigned local.

Nullable reference types are C#'s `strictNullChecks`: `string?` may be null, `string` should not be. They are warnings only, just as TypeScript types are compile-time only. See [value vs reference and memory](csharp-value-reference-memory.md) and [nullable reference types](csharp-nullable-reference-types.md).

## Classes, properties and records

C# classes carry more ceremony than TypeScript's, mostly because access and mutability are explicit.

```cs
public class Customer
{
    public int Id { get; init; }                 // settable only during construction
    public required string Email { get; set; }   // must be set by the creator
    public string? Nickname { get; set; }        // optional
}

public record CustomerDto(int Id, string Email); // immutable DTO with value equality
```

Properties (`{ get; set; }`) replace public fields; a TypeScript `readonly` is roughly `init`. Records are the natural home for the DTOs you would write as TypeScript `type` aliases. There are no object literals for named types; an object initialiser (`new Customer { Email = "a@b.c" }`) is the closest match, and anonymous types (`new { Id = 1 }`) exist for local use only. The [class, struct or record](csharp-class-struct-record.md) guide covers the choice.

## Collections and LINQ

LINQ looks like array methods but behaves like generators: it is lazy.

| JavaScript | C# LINQ |
|---|---|
| `arr.map(f)` | `seq.Select(f)` |
| `arr.filter(f)` | `seq.Where(f)` |
| `arr.find(f)` | `seq.FirstOrDefault(f)` |
| `arr.some(f)` / `arr.every(f)` | `seq.Any(f)` / `seq.All(f)` |
| `arr.reduce(f, init)` | `seq.Aggregate(init, f)` (or `Sum`, `Max`) |
| `arr.flatMap(f)` | `seq.SelectMany(f)` |
| `Object.groupBy(arr, f)` | `seq.GroupBy(f)` |
| `[...a, ...b]` | `[.. a, .. b]` (collection expression) or `a.Concat(b)` |

`orders.Where(o => o.Paid)` does nothing until you iterate it or call `ToList()`. Call it twice and it runs twice. Against EF Core, the same code becomes SQL. The [LINQ in depth](csharp-linq-in-depth.md) and [collections](csharp-choosing-collections.md) guides go further.

## async/await: same words, different model

`Task<T>` is C#'s `Promise<T>`, and `async`/`await` read the same. The differences cause real bugs:

- **There is no single thread.** After an `await`, your method may resume on a different thread-pool thread, while other requests run truly in parallel. Shared mutable state needs locks or concurrent collections; in Node it did not.
- **Blocking is possible, and fatal.** `.Result` and `.Wait()` block a thread and can deadlock or starve the pool. Node has no way to block on a promise; C# does, so do not.
- **Tasks are hot.** Calling an async method starts it, like a promise. `Task.WhenAll` is `Promise.all`; `Task.WhenAny` is `Promise.race`.
- **Cancellation is built in.** Pass a `CancellationToken` through every async call, like an `AbortSignal` but universal across the framework.
- **`async void` is dangerous**, unlike a fire-and-forget async function in JavaScript: its exceptions crash the process.

The [async deep dive](csharp-async-deep-dive.md) covers this properly.

## Errors

C# has no checked exceptions, like JavaScript, but you catch by type rather than inspecting an error object: `catch (SqlException ex) when (ex.Number == 2627)`. Rethrow with `throw;`, never `throw ex;`. Resources are released with `using`, the same idea JavaScript only recently gained with `using` declarations (explicit resource management). See [exceptions and disposal](csharp-exceptions-and-disposal.md).

## Project structure and tooling

| npm world | .NET world |
|---|---|
| `package.json` | `.csproj` (SDK-style XML) |
| `node_modules` | NuGet cache, restored by `dotnet restore` |
| `npm run build` / `npm test` | `dotnet build` / `dotnet test` |
| `tsconfig.json` strictness | `<Nullable>enable</Nullable>`, `<TreatWarningsAsErrors>` |
| Monorepo workspace | Solution file (`.sln` or `.slnx`) with several projects |
| `import { x } from './x'` | `using Namespace;` plus a project reference |
| ESLint + Prettier | Roslyn analysers, `.editorconfig`, `dotnet format` |

Namespaces are not files: everything in the project compiles together into one assembly, and `internal` means visible within that assembly. Dependency injection is built into ASP.NET Core rather than an optional library; see [dependency injection explained](dependency-injection-explained.md).

## Habits to unlearn

- Returning `null` or throwing strings for errors: use `Try` methods, result types or typed exceptions.
- Using `double` for money: use `decimal`.
- Assuming one request runs at a time: singletons are shared by concurrent requests.
- Calling `.ToList()` on everything "to be safe", or never materialising at all.
- Treating `var` as dynamic, or avoiding it entirely: use it when the type is obvious from the right-hand side.

## What you should be able to answer

- How do C# types at runtime differ from TypeScript types, and what does that change about deserialising JSON?
- Why does `7 / 2` print 3, and which numeric type should hold money?
- How does `await` in C# differ from `await` in Node in terms of threads and shared state?
- How does LINQ's execution model differ from JavaScript array methods?
- What replaces `package.json`, `node_modules` and ES module imports in .NET?
- Which JavaScript habits cause bugs in C#?
