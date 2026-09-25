# Error handling in TypeScript: throw, Result and typed errors

"How do you handle errors in a TypeScript service?" sounds like a soft question,
but it tests whether you know where the type system stops. TypeScript has no
checked exceptions, so a function's signature never says what it throws. A
mid-level answer explains what `catch` actually receives, when to return an
error instead of throwing one, and how errors become HTTP responses.

## What the type system does not tell you

Look at this signature:

```ts
declare function loadInvoice(id: string): Promise<{ id: string; total: number }>;
```

It promises an invoice and says nothing about "not found" or "database down".
TypeScript has no `throws` clause, because almost any line of JavaScript can
throw (a property read on `undefined`, a `JSON.parse`, a stack overflow).

Two consequences follow:

- The caller cannot be forced to handle a thrown error. Forgetting a
  `try/catch` compiles.
- A rejected promise carries an untyped reason. `Promise<T>` only describes
  the success value.

So when a failure is *expected* and the caller must deal with it, you need to
put it in the return type. That is what a `Result` type does.

## What `catch` receives

Under `strict` (specifically `useUnknownInCatchVariables`, on since TS 4.4), the
catch variable is `unknown`, because JavaScript lets you throw anything:

```ts
function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Unknown error';
}

try {
  JSON.parse('{oops');
} catch (err) {
  console.error(describe(err)); // err is unknown here, not any
}
```

Do not "fix" the error by writing `catch (err: any)` or `(err as Error).message`.
Libraries do throw strings, plain objects and `Response`s, and code that assumes
`Error` then crashes inside its own error handler, which is the worst place to
crash. A small `toError(err: unknown): Error` helper at the top of the codebase
keeps every handler honest.

When you rethrow with more context, keep the original with `cause` (ES2022):

```ts
import { readFile } from 'node:fs/promises';

async function readConfig(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    throw new Error(`Could not read config at ${path}`, { cause: err });
  }
}
```

Node 24 prints the `cause` chain in uncaught-error output, so you lose nothing
from the original stack. Your `lib` must include `es2022` for the two-argument
`Error` constructor to type-check.

## Custom error classes

Subclassing `Error` gives you `instanceof` checks and a readable `name`:

```ts
class NotFoundError extends Error {
  override readonly name = 'NotFoundError';
  constructor(readonly resource: string, readonly id: string) {
    super(`${resource} ${id} not found`);
  }
}

try {
  throw new NotFoundError('Invoice', 'inv_42');
} catch (err) {
  if (err instanceof NotFoundError) console.log(err.resource, err.id);
}
```

Two practical notes. First, `instanceof` on subclasses of built-ins only works
when you compile to ES2015 or later; with `target: es5` the prototype chain was
broken and you needed `Object.setPrototypeOf(this, new.target.prototype)`. No
2026 project should target ES5, but you will meet that line in old code.
Second, `instanceof` fails across realms and duplicated packages (two copies
of a library in `node_modules` means two `NotFoundError` classes). Errors that
cross a package boundary are safer to discriminate with a string `code`
property, which is also what Node itself does (`err.code === 'ENOENT'`).

## The `Result` type

A `Result` is a discriminated union: success or a typed failure.

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

const ok = <T>(value: T) => ({ ok: true, value }) as const;
const err = <E>(error: E) => ({ ok: false, error }) as const;

type SignupError =
  | { code: 'email_taken' }
  | { code: 'weak_password'; minLength: number };

function signup(email: string, password: string): Result<{ id: string }, SignupError> {
  if (password.length < 12) return err({ code: 'weak_password', minLength: 12 });
  if (email === 'taken@example.com') return err({ code: 'email_taken' });
  return ok({ id: 'usr_1' });
}

const r = signup('ann@example.com', 'correct horse battery');
if (!r.ok) {
  // r.error is SignupError; r.value does not exist here
  console.log(r.error.code);
} else {
  console.log(r.value.id);
}
```

What this buys you: the caller cannot reach `value` without checking `ok`, the
error codes are listed in the signature, and adding a new code shows up at every
exhaustive `switch`. It is the same narrowing covered in the
[discriminated unions guide](typescript-discriminated-unions.md); the
[result type project](../../typescript/36-result-type/) builds one with `map`
and `andThen` helpers.

## Throw or return? A working rule

The debate is usually framed as "exceptions versus Result". In practice you use
both, and the dividing line is whether the caller can do something sensible.

| Situation | Choice | Why |
| --- | --- | --- |
| User input fails a business rule (email taken, stock too low) | Return `Result` | Expected; the caller must show a specific message |
| Record not found for a lookup the caller chose | Return `Result` or `null` | The caller decides between 404 and a fallback |
| Database or network is down | Throw | Nothing local can fix it; let it reach the top-level handler |
| A bug: impossible state, broken invariant | Throw | You want a stack trace and an alert, not a branch |
| Validation of untrusted JSON at the edge | `safeParse`-style result | The failure details become a 400 response |

Signs you have overdone `Result`: every function returns one and most callers
just pass the error straight up. Keep `Result` for the service layer's *domain* failures and let infrastructure
failures throw.

## Async code

A `Promise` has two channels: the resolved value (typed) and the rejection
(untyped). Choose one channel per failure kind:

```ts
type Invoice = { id: string; total: number };
type LoadError = { code: 'not_found' } | { code: 'forbidden' };

async function findInvoice(id: string, userId: string): Promise<Result<Invoice, LoadError>> {
  if (id !== 'inv_1') return { ok: false, error: { code: 'not_found' } };
  if (userId !== 'usr_1') return { ok: false, error: { code: 'forbidden' } };
  return { ok: true, value: { id, total: 4200 } };
}
```

Expected failures resolve as `{ ok: false }`; a dropped database connection
still rejects. To bring a throwing API into this style, wrap it once:

```ts
async function attempt<T>(fn: () => Promise<T>): Promise<Result<T, Error>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}
```

Note the `await` inside the `try`: `return fn()` without it would let the
rejection escape the `catch`. For several independent calls,
`Promise.allSettled` already returns a typed result per item
(`PromiseSettledResult<T>` with `status: 'fulfilled' | 'rejected'`), so you rarely
need to write your own.

The async bug that types do not catch is the floating promise: calling an
async function without `await` or `.catch`. The rejection becomes an unhandled
rejection, which terminates a Node 24 process by default. Turn on
`@typescript-eslint/no-floating-promises`; `tsc` alone will not flag it.

## Turning errors into HTTP responses

The edge of your API is where typed errors pay off. Map each domain error code
to a status and an RFC 9457 problem details body in one place:

```ts
type DomainError =
  | { code: 'not_found'; resource: string }
  | { code: 'conflict'; detail: string }
  | { code: 'validation'; fields: Record<string, string> };

function toProblem(e: DomainError): { status: number; title: string } {
  switch (e.code) {
    case 'not_found': return { status: 404, title: `${e.resource} not found` };
    case 'conflict': return { status: 409, title: e.detail };
    case 'validation': return { status: 422, title: 'Validation failed' };
    default: return e satisfies never;
  }
}
```

`satisfies never` in the `default` branch turns a forgotten case into a compile
error the day someone adds `'rate_limited'`. Anything that was *thrown* rather
than returned goes to a single error middleware (Express 5 forwards rejected
async handlers to it automatically), which logs the full error with its
`cause` and returns a generic 500 without leaking the stack trace. The
[REST API design guide](rest-api-design.md) covers the problem details format
itself.

## Functions that never return, and assertions

Two signatures help the compiler follow your error paths:

```ts
function fail(message: string): never {
  throw new Error(message);
}

function assertDefined<T>(value: T, name: string): asserts value is NonNullable<T> {
  if (value == null) fail(`${name} is required`);
}

const port = process.env.PORT;
assertDefined(port, 'PORT');
console.log(port.length); // string: the assertion narrowed it
```

`never` tells control-flow analysis that code after `fail(...)` is unreachable,
so `const id = param ?? fail('missing id')` is a `string`. Assertion functions
narrow the argument for the rest of the scope. One trap: an assertion function
must be called through an explicitly typed reference, so an arrow function
assigned to an unannotated `const` will not narrow.

## Libraries and when to reach for them

- **neverthrow** gives you `Result`, `ResultAsync`, `map` and `andThen`, plus an
  ESLint rule that flags unhandled results.
- **Effect** models errors, dependencies and concurrency in one type
  (`Effect<A, E, R>`). It is a different programming style: a team decision.
- **Zod, Valibot** and friends return a result from `safeParse`, which is
  often the only `Result` a CRUD app needs. See the
  [runtime validation guide](typescript-runtime-validation.md).

For most CRUD services, a 10-line `Result` type, a `toError` helper and one
error middleware is enough. The [typed errors project](../../typescript/35-typed-errors/)
puts those together.

## What you should be able to answer

- Why is the `catch` variable typed `unknown`, and how do you safely read a message from it?
- TypeScript has no `throws` clause. How do you make a caller handle an expected failure?
- When would you return a `Result` and when would you throw? Give an example of each.
- Why can `instanceof` on a custom error class fail, and what do you use instead?
- How do you keep the original error when rethrowing with more context?
- How do typed domain errors become consistent HTTP responses, and what makes a missed case a compile error?
