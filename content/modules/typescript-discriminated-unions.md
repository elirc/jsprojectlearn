# Discriminated unions for application state

"How would you type a request that can be loading, failed or loaded?" is one of
the most common TypeScript interview questions, and the answer interviewers want
is a discriminated union. It is the single pattern that most improves everyday
TypeScript code: fewer null checks, fewer impossible states, and compile errors
when someone forgets a case.

## The problem with optional fields

The first version everyone writes:

```ts
type User = { id: string; name: string };

type UserState = {
  isLoading: boolean;
  error?: string;
  data?: User;
};
```

Three fields give eight combinations, and only three of them mean anything.
`isLoading: true` with `error` set? `data` and `error` both present? The type
allows it, so somewhere a bug will produce it, and every consumer has to write
defensive checks for states that "can't happen".

A discriminated union lists the states that *can* happen, and nothing else:

```ts
type User = { id: string; name: string };

type UserState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'success'; data: User };
```

Each member has a **discriminant**, a property with a literal type (`status`),
and the fields that only exist in that state. Check the discriminant and
TypeScript narrows to that member:

```ts
type User = { id: string; name: string };
type UserState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'success'; data: User };

function render(state: UserState): string {
  if (state.status === 'success') return `Hello ${state.data.name}`;
  if (state.status === 'error') return `Failed: ${state.error}`;
  return 'Loading...';
}

function broken(state: UserState) {
  return state.data;   // Error: 'data' does not exist on the other members
}
```

You cannot read `data` without first proving you are in the `success` state.
That is the phrase to use in an interview: **make impossible states
unrepresentable**. The [impossible-states project](../../typescript/30-impossible-states/)
refactors exactly this.

## What makes a good discriminant

| Rule | Why |
|---|---|
| A literal type on every member (`'loading'`, `404`, `true`) | `string` cannot narrow anything |
| The same property name on every member | narrowing needs a shared key to compare |
| One discriminant, not two booleans | `isLoading` + `isError` is four states pretending to be two |
| Names that describe state, not UI (`'error'`, not `'showRedBanner'`) | the state outlives the component |

String literals are the norm. Booleans work (`{ ok: true; value: T } | { ok: false; error: E }`)
and are common for results. Avoid enums as discriminants in new code; a string
literal union serialises to the same JSON and needs no import.

## Exhaustive handling with `satisfies never`

A `switch` over the discriminant is the idiomatic way to handle every state.
Make the compiler prove you did:

```ts
type Shape =
  | { kind: 'circle'; radius: number }
  | { kind: 'rect'; width: number; height: number }
  | { kind: 'triangle'; base: number; height: number };

function area(shape: Shape): number {
  switch (shape.kind) {
    case 'circle': return Math.PI * shape.radius ** 2;
    case 'rect': return shape.width * shape.height;
    case 'triangle': return (shape.base * shape.height) / 2;
    default:
      shape satisfies never;
      throw new Error(`Unknown shape: ${JSON.stringify(shape)}`);
  }
}
```

In the `default` branch every member has been removed, so `shape` is `never`.
Add `{ kind: 'hexagon'; side: number }` to the union and `shape satisfies never`
fails with "Type '{ kind: "hexagon"; ... }' does not satisfy the expected type
'never'", pointing at the exact place you forgot. `satisfies never` needs no
helper function; the older `const _exhaustive: never = shape` or an
`assertNever(shape)` helper do the same job. Keep the `throw`: at runtime, data
from a newer server can still contain a kind your code has never heard of. The
[exhaustive switch project](../../typescript/12-exhaustive-switch/) drills this.

## Form state

Forms have more states than people model. A submit flow is typically:

```ts
type FieldErrors = Partial<Record<'email' | 'password', string>>;

type SubmitState =
  | { phase: 'editing'; errors: FieldErrors }
  | { phase: 'submitting' }
  | { phase: 'failed'; message: string; retryable: boolean }
  | { phase: 'done'; redirectTo: string };

function submitLabel(state: SubmitState): string {
  switch (state.phase) {
    case 'editing': return 'Sign in';
    case 'submitting': return 'Signing in...';
    case 'failed': return state.retryable ? 'Try again' : 'Contact support';
    case 'done': return 'Redirecting...';
  }
}
```

The last function has no `default` and no `return` after the switch, yet it
compiles with a `string` return type. TypeScript sees the switch is exhaustive,
so the end of the function is unreachable. Remove a case and you get "Function
lacks ending return statement". That is a second, lighter exhaustiveness check.

## API responses and results

The same shape works for anything that can succeed or fail. A generic result
type is common in service layers:

```ts
type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

type NotFound = { code: 'not_found'; id: string };
type Invalid = { code: 'invalid'; fields: string[] };

function findOrder(id: string): Result<{ id: string; total: number }, NotFound | Invalid> {
  if (!id.startsWith('ord_')) return { ok: false, error: { code: 'invalid', fields: ['id'] } };
  return { ok: true, value: { id, total: 4200 } };
}

const r = findOrder('ord_1');
if (r.ok) console.log(r.value.total);
else if (r.error.code === 'invalid') console.log(r.error.fields.join(', '));
```

Notice the nesting: the result is a union on `ok`, and the error inside it is a
union on `code`. Each level narrows independently. See the
[result type project](../../typescript/36-result-type/) and the
[error handling guide](typescript-error-handling.md) for when to return errors
versus throw them.

## Reducers and actions

A reducer is a function from `(state, action)` to a new state. Type both as
unions and each action's payload is checked against its `type`, whatever
framework (or none) you use:

```ts
type Cart = { lines: { sku: string; qty: number }[]; couponCode: string | null };

type CartAction =
  | { type: 'added'; sku: string }
  | { type: 'qtyChanged'; sku: string; qty: number }
  | { type: 'couponApplied'; code: string }
  | { type: 'cleared' };

function cartReducer(state: Cart, action: CartAction): Cart {
  switch (action.type) {
    case 'added':
      return { ...state, lines: [...state.lines, { sku: action.sku, qty: 1 }] };
    case 'qtyChanged':
      return { ...state, lines: state.lines.map((l) => (l.sku === action.sku ? { ...l, qty: action.qty } : l)) };
    case 'couponApplied':
      return { ...state, couponCode: action.code };
    case 'cleared':
      return { lines: [], couponCode: null };
    default:
      action satisfies never;
      return state;
  }
}
```

Dispatching `{ type: 'qtyChanged', sku: 'A' }` without `qty` is a compile error.
For React-specific typing of `useReducer`, see
[TypeScript in React](typescript-in-react.md); the
[typed actions](../../typescript/32-typed-actions/) and
[typed state machine](../../typescript/33-typed-state-machine/) projects take it
further, restricting which actions are valid in which state.

## When a union beats optional fields (and when it does not)

Use a union when:

- fields are **only meaningful together** (`data` only on success, `retryAfter`
  only on a 429)
- one field's value **decides which others exist** (a payment `method` that
  decides whether you have `iban` or `last4`)
- you find yourself writing `if (state.data && !state.error && !state.isLoading)`

Keep optional fields when they are **genuinely independent**. A user profile
with optional `bio`, `avatarUrl` and `website` is not three states; any
combination is valid, and a union would be combinatorial nonsense. The test:
if you can name each combination as a state, use a union; if the combinations
are just "whatever the user filled in", use optionals.

One refinement for unions: stale data. "Refreshing, but show the old list" is a
real state, so model it (`{ status: 'refreshing'; data: User[] }`) rather than
bolting `isRefreshing?: boolean` onto the success member.

## Serialising unions over JSON

Discriminated unions survive `JSON.stringify` intact because the discriminant is
just a string property. That makes them a good wire format for API responses,
webhook payloads and messages between a worker and the main thread.

The catch is the other direction. `JSON.parse` returns `any`, and asserting it
with `as UserState` checks nothing. Validate at the boundary and let the schema
produce the union:

```ts
import { z } from 'zod';

const Event = z.discriminatedUnion('type', [
  z.object({ type: z.literal('order.paid'), orderId: z.string(), amount: z.number() }),
  z.object({ type: z.literal('order.refunded'), orderId: z.string(), reason: z.string() }),
]);
type Event = z.infer<typeof Event>;
```

A few serialisation details worth knowing:

- `Date` becomes a string. Use `string` (ISO 8601) in the wire type and convert
  deliberately.
- `undefined` properties are dropped, so `{ error: undefined }` and `{}` are
  the same JSON. Another reason not to use optionals as state flags.
- An unknown discriminant from a newer server must be handled, which is why the
  `throw` after `satisfies never` matters.

More on this boundary in [runtime validation](typescript-runtime-validation.md).

## What you should be able to answer

- How would you type the state of a request that can be idle, loading, failed or
  loaded, and why is that better than `isLoading`/`error?`/`data?`?
- What makes a property a usable discriminant?
- How do you make a `switch` fail to compile when a new union member is added,
  and why keep a runtime `throw` as well?
- When would you keep optional fields instead of a union?
- How do you type a reducer so each action's payload is checked?
- What happens to a discriminated union when it crosses a JSON boundary, and
  where do you validate it?
