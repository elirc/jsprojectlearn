# Narrowing and control-flow analysis

Most TypeScript you write is not declaring types, it is persuading the compiler
that a `string | undefined` is a `string` by the line you need it. Interviewers
ask about narrowing because it separates people who reach for `as` from people
who understand what the checker actually tracks, and why it sometimes forgets.

## What narrowing is

A variable has a **declared type** and, at each point in the code, a **narrowed
type**. TypeScript walks the control flow (ifs, returns, throws, switches,
assignments) and works out which members of a union are still possible.

```ts
function label(id: string | number | null) {
  if (id === null) return 'none';
  // id: string | number
  if (typeof id === 'number') return `#${id.toFixed(0)}`;
  // id: string
  return id.toUpperCase();
}
```

Nothing here is a cast. Each check removes members from the union, and the early
`return` means everything below it only sees what survived. This is
**control-flow analysis**, and it is why early returns read so well in
TypeScript. The [narrowing project](../../typescript/09-narrowing/) drills the
basics.

## The built-in narrowing checks

| Check | Narrows | Watch out for |
|---|---|---|
| `typeof x === 'string'` | primitives, `'function'`, `'object'` | `typeof null === 'object'`, so `'object'` keeps `null` |
| `x instanceof Date` | class instances | fails across realms (iframes, some test runners); useless for plain JSON |
| `'email' in x` | union members that declare (or lack) the key | a member without the key is kept if it could still have it |
| `x === 'paid'`, `x !== null` | literals and `null`/`undefined` | `x != null` removes both `null` and `undefined` |
| `if (x)` truthiness | removes `null`, `undefined`, and falsy literals | also removes `0` and `''`, which may be valid values |
| `Array.isArray(x)` | arrays | narrows `unknown` to `any[]`, not `unknown[]` |

The truthiness trap is the one you will be asked about:

```ts
function formatQty(qty: number | undefined) {
  if (!qty) return 'n/a';   // bug: 0 is a real quantity
  return qty.toString();
}

function formatQtyFixed(qty: number | undefined) {
  if (qty === undefined) return 'n/a';
  return qty.toString();
}
```

Both compile. Only the second is correct. Narrowing is a type-level tool; it does
not stop you writing the wrong runtime check.

## Discriminant checks

When every member of a union has a literal property in common, checking that
property narrows the whole object:

```ts
type Payment =
  | { method: 'card'; last4: string }
  | { method: 'bank'; iban: string }
  | { method: 'cash' };

function describe(p: Payment) {
  if (p.method === 'card') return `Card ending ${p.last4}`;
  if (p.method === 'bank') return `Bank ${p.iban.slice(-4)}`;
  return 'Cash';
}
```

This is the backbone of state modelling and gets its own guide:
[discriminated unions](typescript-discriminated-unions.md). Destructuring works
too: `const { method } = p; if (method === 'card') p.last4` narrows `p`, as
long as the destructured variables are `const`.

## Assignment narrowing

Assigning to a variable narrows it to the assigned type, within its declared
type:

```ts
let input: string | number = Math.random() > 0.5 ? 'a' : 1;
input = 'hello';
input.toUpperCase();          // fine: narrowed to string by the assignment
input = 42;
input.toFixed(2);             // fine: now number
```

`const` declarations are narrowed permanently. `let` declarations are narrowed
until the next assignment, which is why the checker is more cautious with `let`
inside closures (see below).

## User-defined type guards and assertion functions

When a check is too complex to inline, move it into a function and tell the
compiler what a `true` result means:

```ts
type Customer = { id: string; email: string };

function isCustomer(value: unknown): value is Customer {
  return (
    typeof value === 'object' && value !== null &&
    'id' in value && typeof value.id === 'string' &&
    'email' in value && typeof value.email === 'string'
  );
}

function assertIsDefined<T>(value: T, name: string): asserts value is NonNullable<T> {
  if (value === null || value === undefined) throw new Error(`${name} is missing`);
}

declare const body: unknown;
if (isCustomer(body)) body.email;          // Customer inside the if

declare const apiUrl: string | undefined;   // e.g. from process.env
assertIsDefined(apiUrl, 'API_URL');
apiUrl.startsWith('https');                // string from here on
```

- A **type predicate** (`value is Customer`) narrows in the branch where the
  function returned `true`, and narrows to the *exclusion* in the `else`.
- An **assertion function** (`asserts value is X`) narrows everything after the
  call, because returning at all means the check passed.

The catch: **the compiler trusts your predicate completely.** If `isCustomer`
returned `true` for anything, every caller would be wrong and nothing would
complain. A type guard is a small `as` with a function wrapped round it, so keep
guards short and test them. For anything bigger than a handful of fields, use a
schema library instead ([runtime validation](typescript-runtime-validation.md),
[type-guard project](../../typescript/11-type-guards/)).

Assertion functions have one awkward rule: they must be called through an
explicitly typed reference. An arrow function assigned to an untyped `const`
fails with "Assertions require every name in the call target to be declared
with an explicit type annotation". Use a `function` declaration.

## Inferred type predicates (TypeScript 5.5+)

Before 5.5, this was a classic complaint:

```ts
const ids = ['a', undefined, 'b'];
const present = ids.filter((id) => id !== undefined);
// 5.4: (string | undefined)[]    5.5+: string[]
```

Since 5.5, TypeScript infers `id is string` for a function that returns a
boolean, has no explicit return type, and whose `true` result genuinely proves
the narrower type (and whose `false` proves the opposite). So `.filter(x => x !== undefined)`
now does what you want.

It does **not** infer from truthiness on types where falsy values are valid:

```ts
const counts = [0, 1, undefined];
const truthy = counts.filter((n) => !!n);   // (number | undefined)[]
```

`false` would not prove `n` is `undefined` (it could be `0`), so no predicate
is inferred. That is the checker being correct, not being dim.

## Why narrowing gets lost

Narrowing is attached to a *reference at a point in the flow*. It is discarded
when the checker cannot prove nothing changed in between.

```ts
type Draft = { title: string | null };

function publish(draft: Draft, save: (t: string) => void) {
  if (draft.title === null) return;
  save(draft.title);                        // fine: string

  [1, 2].forEach(() => save(draft.title)); // Error: string | null inside the callback
}
```

Inside the callback, `draft.title` is a property of a mutable object and the
callback could run later, after someone set it back to `null`. So the narrowing
is reset. The same applies after an `await` for anything the rest of your
program could mutate in the meantime. The fix is to **copy into a `const`**:

```ts
type Draft = { title: string | null };

async function publish(draft: Draft, save: (t: string) => Promise<void>) {
  const title = draft.title;
  if (title === null) return;
  await save(title);
  [1, 2].forEach(() => save(title));  // fine: const cannot change
}
```

Rules of thumb:

- A narrowed `const` or parameter that is never reassigned stays narrowed
  inside closures (since 5.4, closures created after the last assignment keep
  narrowing for `let` and parameters too).
- A narrowed **property access** (`obj.prop`) is dropped inside callbacks and
  after any function call that could have mutated it.
- `as` is the wrong fix. A local `const` is free and honest.

## `never` and exhaustiveness

When every member of a union has been removed, the remaining type is `never`.
You can use that to make the compiler tell you about cases you have not handled:

```ts
type Status = 'draft' | 'published' | 'archived';

function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${JSON.stringify(value)}`);
}

function badge(status: Status): string {
  switch (status) {
    case 'draft': return 'grey';
    case 'published': return 'green';
    case 'archived': return 'amber';
    default: return assertNever(status);
  }
}
```

Add `'scheduled'` to `Status` and `assertNever(status)` becomes an error:
`'scheduled'` is not assignable to `never`. The runtime `throw` covers data that
arrives from outside the type system, such as a newer API returning a status
your client does not know. See the [exhaustive switch project](../../typescript/12-exhaustive-switch/).

`never` also shows up as the return type of functions that always throw, which
is how the checker knows code after `assertNever(...)` is unreachable.

## `as` versus narrowing

| You write | The compiler does | Runtime check? |
|---|---|---|
| `if (typeof x === 'string')` | narrows from real evidence | yes |
| `isCustomer(x)` | trusts your predicate | yes, if the guard is right |
| `x as Customer` | believes you | no |
| `x!` | removes `null`/`undefined` | no |

Reach for them in that order. An `as` is sometimes fine (a test fixture, a DOM
query you know exists), but in review each one should have a reason.

## What you should be able to answer

- Which built-in checks narrow a union, and what does `typeof x === 'object'`
  leave behind?
- Why does `if (!qty)` compile but hide a bug for numbers?
- What is the difference between a type predicate and an assertion function, and
  what happens if the predicate lies?
- What changed in TypeScript 5.5 about `.filter(x => x !== undefined)`?
- Why is `obj.prop` narrowed on one line but not inside a `forEach` callback, and
  how do you fix it?
- How do you get a compile error when someone adds a new member to a union?
