# Pattern matching in modern C#

Pattern matching has quietly replaced a lot of `if`/`else` chains and casts in C# codebases. Interviewers use it as a currency check ("have you written C# since 2019?") and as a design question: can you express a business rule as a readable table rather than nested conditions? Practise with [csharp/31](../../csharp/31-pattern-matching-rules/) and [csharp/06](../../csharp/06-enums-and-switch/).

## Where patterns can appear

Patterns are used in three places:

- `is` expressions: `if (shape is Circle { Radius: > 10 } c)`
- `switch` expressions: `var label = status switch { ... };`
- `case` labels in a `switch` statement

The switch **expression** (C# 8) is the one you will write most. It returns a value, each arm is `pattern => result`, and arms are tried top to bottom.

```cs
string Describe(OrderStatus s) => s switch
{
    OrderStatus.Draft => "Not submitted",
    OrderStatus.Paid or OrderStatus.Shipped => "In progress",
    OrderStatus.Delivered => "Complete",
    _ => throw new ArgumentOutOfRangeException(nameof(s), s, null),
};
```

## The pattern catalogue

| Pattern | Example | Matches when |
|---|---|---|
| Constant | `null`, `0`, `"GBP"`, `Status.Paid` | The value equals the constant |
| Type / declaration | `Circle c` | The value is a `Circle` (and not null); binds `c` |
| `var` | `var x` | Always, including null; binds `x` |
| Discard | `_` | Always |
| Relational (C# 9) | `> 100`, `<= 0` | Comparison holds (numeric, char, enum constants) |
| Logical (C# 9) | `>= 0 and < 100`, `not null`, `A or B` | Combination holds |
| Property | `{ Status: Status.Paid, Total: > 0 }` | Value is not null and each property matches |
| Extended property (C# 10) | `{ Customer.Address.Country: "UK" }` | Same, through a chain, null-safe at each step |
| Positional | `(0, 0)`, `Point(var x, var y)` | Deconstructed parts match |
| List (C# 11) | `[]`, `[var first, .., var last]` | Length and elements match; `..` slices |

A property pattern always includes a null check, which is why `order is { }` is an idiom for "not null", and why `order is { Customer.Address.Country: "UK" }` cannot throw.

## is null, is not null, and why they beat ==

```cs
if (user is null) return Results.NotFound();
if (input is not { Length: > 0 }) return Results.BadRequest();
```

`is null` always performs a real null check, whereas `== null` calls a user-defined `==` operator if the type has one. The compiler also understands `is not null` for nullable analysis. See the [nullable reference types](csharp-nullable-reference-types.md) guide.

## Precedence: `not`, `and`, `or`

The pattern combinators bind in the order `not`, then `and`, then `or`. This produces a real bug:

```cs
if (ch is not 'a' or 'b') { }    // means (not 'a') or 'b': true for everything except 'a'
if (ch is not ('a' or 'b')) { }  // what was intended
```

Use parentheses whenever you combine `not` with `or`.

## Arm order and exhaustiveness

Arms are tested in order, and there is no "most specific wins" rule. If an earlier arm already covers a later one, the compiler reports an error (CS8510), so a discard `_` must come last and ranges must be ordered carefully.

```cs
static string Tier(decimal total) => total switch
{
    < 0 => throw new ArgumentOutOfRangeException(nameof(total)),
    < 100 => "small",
    < 1000 => "medium",
    _ => "large",
};
```

Because the arms run in order, `< 1000` does not need `>= 100`.

If the arms do not cover every possible input, the compiler warns (CS8509) and an unmatched value throws `SwitchExpressionException` at runtime. For enums the compiler warns even when every named member is listed, because an enum variable can hold any integer (`(Status)99`). Add a final `_` arm that throws, and treat the warning as an error.

## Patterns for business rules

Tuple patterns let you switch on several inputs at once, turning a nested `if` into a decision table:

```cs
decimal Shipping(bool isMember, decimal total, string country) => (isMember, total, country) switch
{
    (true, _, "UK") => 0m,
    (_, >= 50m, "UK") => 0m,
    (_, _, "UK") => 4.99m,
    (_, _, _) => 12.99m,
};
```

Property patterns do the same for objects:

```cs
string Review(Order o) => o switch
{
    { Status: OrderStatus.Cancelled } => "ignore",
    { Total: > 10_000, Customer.IsVerified: false } => "manual review",
    { Lines.Count: 0 } => "empty order",
    _ => "auto approve",
};
```

A reviewer can read each rule on its own line. When a table grows past a dozen arms, or the rules change at runtime, move them into data (a rules list or configuration) instead.

## Type patterns and polymorphism

Switching on type is useful at boundaries: mapping exceptions to HTTP responses, handling a closed set of message types, or inspecting results.

```cs
IResult ToResult(Exception ex) => ex switch
{
    ValidationException v => Results.BadRequest(v.Message),
    NotFoundException => Results.NotFound(),
    UnauthorizedAccessException => Results.Forbid(),
    _ => Results.Problem(statusCode: 500),
};
```

Inside your own domain, prefer a virtual method or interface over switching on types scattered through the code: adding a new type then means finding every switch. The rule of thumb is that pattern matching suits data you do not own or a closed set of shapes; polymorphism suits behaviour that belongs to the type. The [discriminated unions](typescript-discriminated-unions.md) guide shows the TypeScript equivalent, which C# approximates with a sealed record hierarchy.

```cs
public abstract record PaymentResult;
public sealed record Paid(string TransactionId) : PaymentResult;
public sealed record Declined(string Reason) : PaymentResult;
```

C# has no closed hierarchies yet, so the compiler cannot prove such a switch exhaustive; keep the `_` arm.

## List patterns

List patterns match arrays, lists and spans by shape:

```cs
string Route(string[] segments) => segments switch
{
    [] => "home",
    ["orders"] => "order list",
    ["orders", var id] => $"order {id}",
    ["orders", var id, "lines", ..] => $"lines of {id}",
    _ => "not found",
};
```

`..` matches any number of elements (a slice), and can bind: `[var head, .. var rest]`. They are handy for parsing command-line arguments and CSV rows.

## Statement or expression?

Use a switch expression when every branch produces a value. Use a `switch` statement when branches perform different actions with several statements each. A C# `switch` statement does not fall through: each non-empty section must end in `break`, `return` or `throw`, although several `case` labels can share one section.

## What you should be able to answer

- What is the difference between a switch statement and a switch expression?
- Name five kinds of pattern and give an example of each.
- Why does `is null` differ from `== null`?
- What happens when no arm of a switch expression matches, and why does an enum switch still warn when every member is listed?
- What does `x is not 1 or 2` actually test?
- When would you use pattern matching over polymorphism, and vice versa?
