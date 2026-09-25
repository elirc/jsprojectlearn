# Value types, reference types and memory in C#

"What is the difference between a value type and a reference type?" is the first C# question in almost every .NET interview, and the follow-ups (boxing, the GC, `Span<T>`) are how the interviewer finds your ceiling. JavaScript gives you one object model; C# gives you two, and choosing between them changes correctness as well as performance. Build [csharp/02](../../csharp/02-value-vs-reference/) alongside this guide.

## The one rule: what does assignment copy?

Forget "stack versus heap" for a moment. The rule that matters is what `=` copies.

- A **value type** variable holds the data itself. Assigning it copies the whole value.
- A **reference type** variable holds a reference to an object. Assigning it copies the reference, so both variables point at the same object.

```cs
struct PointS { public int X; }
class PointC { public int X; }

var a = new PointS { X = 1 };
var b = a;          // copies the value
b.X = 99;
Console.WriteLine(a.X); // 1

var c = new PointC { X = 1 };
var d = c;          // copies the reference
d.X = 99;
Console.WriteLine(c.X); // 99
```

| Kind | Examples | Assignment copies | Default value |
|---|---|---|---|
| Value type | `int`, `decimal`, `bool`, `DateTime`, `Guid`, enums, any `struct`, `record struct` | The data | All fields zeroed |
| Reference type | `string`, arrays, `List<T>`, any `class`, `record`, delegates | The reference | `null` |

`string` is a reference type that behaves like a value because it is immutable: every "change" produces a new string. That is why `==` on strings compares contents.

## Where things actually live

The common line "value types live on the stack" is only half true, and interviewers like to catch it.

- Local variables and parameters of value types usually live in the method's stack frame (or in CPU registers).
- A value type that is a **field of a class** lives inside that object, on the heap.
- Elements of an `int[]` live inline inside the array, which is on the heap.
- Locals captured by a lambda, or held across an `await` or `yield`, are hoisted into a compiler-generated class, so they end up on the heap as well.

Reference type objects always live on the managed heap; the variable holding the reference sits wherever the variable lives. The accurate answer is: **value types are stored inline wherever their container is; reference types are always a separate heap object**.

## Parameters: by value unless you say otherwise

C# passes every argument by value by default. For a reference type, the *reference* is copied, so the method can mutate the object but cannot make the caller's variable point somewhere else.

```cs
void Rename(User u) { u.Name = "Changed"; u = new User { Name = "New" }; }

var user = new User { Name = "Ann" };
Rename(user);
Console.WriteLine(user.Name); // Changed
```

The modifiers change that:

| Modifier | Meaning | Typical use |
|---|---|---|
| `ref` | Pass the variable itself; the callee can read and reassign it | Rare in application code |
| `out` | The callee must assign it before returning | `TryParse`, `TryGetValue` |
| `in` / `ref readonly` | Pass by reference, read-only | Avoiding copies of large structs |

## Boxing: when a value type becomes an object

Converting a value type to `object` or to an interface it implements **boxes** it: the runtime allocates a heap object and copies the value in. Unboxing copies it back out.

```cs
int n = 42;
object o = n;         // box: heap allocation
int m = (int)o;       // unbox: copy out
IComparable c = n;    // also boxes
```

Boxing is invisible in the source, which is what makes it dangerous in hot paths. Classic sources are non-generic collections (`ArrayList`), `string.Format` with value-type arguments in old code, calling an interface method on a struct through the interface, and `Equals(object)` on a struct that does not implement `IEquatable<T>`. Generics fixed most of this: a `List<int>` stores `int`s directly, with no boxing.

## Structs: when they help and when they hurt

A struct avoids a heap allocation, which matters when you create millions of small values. The costs are copying and surprising mutation.

```cs
var list = new List<Point> { new Point() };
// list[0].X = 5;   // CS1612: the indexer returns a copy
struct Point { public int X; }
```

Mutable structs lose writes silently: a `readonly` field of a mutable struct type hands every method call a defensive copy, and `foreach` iteration variables are read-only copies. The rules of thumb that interviewers want:

- Use a struct for small (roughly 16 bytes or less), immutable values that represent a single concept: money, coordinates, a date range.
- Declare it `readonly struct` or `readonly record struct` so the compiler enforces immutability and skips defensive copies.
- Implement `IEquatable<T>` (records do it for you) so equality does not box.
- Everything else, including entities and services, is a class.

The [class, struct or record](csharp-class-struct-record.md) guide covers the choice in detail.

## The garbage collector in five facts

1. The GC reclaims heap objects that nothing reachable refers to. It follows references from roots: static fields, locals on active stacks, CPU registers, GC handles.
2. It is **generational**. New objects start in generation 0, which is collected often and cheaply; survivors move to gen 1 and then gen 2. Most objects die young, which is why short-lived allocations are cheap.
3. Objects of 85,000 bytes or more go to the **large object heap**, which is collected only with gen 2 and not compacted by default. Repeatedly allocating big buffers is a performance smell.
4. A "memory leak" in .NET means something reachable is still holding a reference: a static list that only grows, an event subscription on a long-lived publisher, a singleton cache without limits.
5. The GC frees memory; it never calls `Dispose`. Files, sockets and connections need deterministic cleanup, covered in [exceptions and disposal](csharp-exceptions-and-disposal.md).

ASP.NET Core uses Server GC by default, which has a heap per core and favours throughput. You rarely tune it; you reduce allocations instead.

## Span, Memory and allocation-free code

`Span<T>` is a view over contiguous memory, whether an array, part of a string, or a `stackalloc` buffer, stored as a reference plus a length. Slicing a span allocates nothing.

```cs
string line = "2026-09-24,ORDER,42";
ReadOnlySpan<char> date = line.AsSpan(0, 10);
int id = int.Parse(line.AsSpan(17));   // no Substring allocation
```

Because a span may point at stack memory, it is a `ref struct` and the compiler keeps it off the heap:

- it cannot be a field of a class, be boxed, or be captured by a lambda;
- it cannot be live across an `await` (C# 13 lets async methods declare span locals as long as they are not used after an await).

When you need to store a buffer view or carry it across an await, use `Memory<T>` / `ReadOnlyMemory<T>`: an ordinary struct you convert with `.Span` at the point of use. This is why `Stream.WriteAsync` takes `ReadOnlyMemory<byte>`.

| Need | Use |
|---|---|
| Parse or slice synchronously without allocating | `ReadOnlySpan<char>` / `Span<T>` |
| Small temporary buffer of known, bounded size | `stackalloc` into a `Span<T>` |
| Buffer view stored in a field or used across `await` | `Memory<T>` |
| Large temporary buffers, reused | `ArrayPool<T>.Shared.Rent` and `Return` |

For CRUD work you will mostly *consume* span-based APIs rather than write them; knowing why they exist is enough for a mid-level interview.

## How this differs from JavaScript

JavaScript primitives (number, string, boolean) copy on assignment and objects share references, so the object half of the model is familiar. What is new is that C# lets *you* define value types, that `default` for a struct is a zeroed value rather than `undefined`, and that an `int` can end up on the heap through boxing or capture. Equality follows the same split: `==` on a class compares references unless the type overloads it, as records and `string` do.

## What you should be able to answer

- What does assignment copy for a value type and for a reference type, and where does each live?
- Why is "value types live on the stack" incomplete? Give two counter-examples.
- What is boxing, where does it hide, and how did generics reduce it?
- When would you choose a struct, and why should it be `readonly`?
- What does the generational GC optimise for, and what does a memory leak look like in .NET?
- What problem does `Span<T>` solve, and why can it not cross an `await` when `Memory<T>` can?
