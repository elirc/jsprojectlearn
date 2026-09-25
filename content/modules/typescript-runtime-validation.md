# Runtime validation at the type boundary

TypeScript's types vanish when the code runs, so every value that arrives from
outside your program (a request body, a `fetch` response, an environment
variable, `localStorage`) has whatever type you *claim* it has. Interviewers ask
about this because it separates people who use TypeScript as decoration from
people who understand where it actually protects them.

## Why `as` and `res.json()` lie

```ts
type User = { id: string; email: string };

async function getUser(id: string): Promise<User> {
  const res = await fetch(`/api/users/${id}`);
  return res.json();                 // any, silently widened to User
}

async function getUserCast(id: string) {
  const res = await fetch(`/api/users/${id}`);
  return (await res.json()) as User; // the same lie, just louder
}
```

`res.json()` returns `Promise<any>`, and `any` is assignable to everything, so
the first version compiles with no complaint. The cast in the second version
is a promise *you* make to the compiler, and nothing checks it. If the API
renames `email` to `emailAddress`, both functions still compile and your bug
surfaces three files away as `undefined.toLowerCase()`.

The fix is to treat outside data as `unknown` (see
[ts/13](../../typescript/13-unknown-boundary/)) and earn the real type by
checking it. That checking is runtime code, and it has to exist somewhere.

## Parse, don't validate

A validator answers yes or no. A parser takes `unknown` and returns a typed
value or fails:

```ts
type User = { id: string; email: string };

function isUser(x: unknown): boolean {          // validator: the type is lost
  return typeof x === 'object' && x !== null && 'id' in x;
}

function parseUser(x: unknown): User {          // parser: the type is the output
  if (
    typeof x === 'object' && x !== null &&
    'id' in x && typeof x.id === 'string' &&
    'email' in x && typeof x.email === 'string'
  ) {
    return { id: x.id, email: x.email };
  }
  throw new Error('Not a user');
}
```

After `parseUser`, the rest of the program holds a `User` and never has to
re-check. The parser also copies only the fields it knows, so extra properties
(such as `isAdmin: true` smuggled into a request body) do not ride along. Writing
these by hand does not scale, which is what schema libraries are for
([ts/23](../../typescript/23-typed-validator/) builds a tiny one).

## Zod 4: one schema, one type

You declare the shape once, as a value, and derive the static type from it with
`z.infer`. The two can never drift apart.

```ts
import { z } from 'zod';

const User = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string().min(1),
  role: z.enum(['admin', 'member']).default('member'),
  createdAt: z.iso.datetime(),
});
type User = z.infer<typeof User>;

async function getUser(id: string): Promise<User> {
  const res = await fetch(`/api/users/${id}`);
  return User.parse(await res.json());   // throws ZodError on a mismatch
}
```

Zod 4 moved string formats to the top level (`z.email()`, `z.uuid()`,
`z.url()`, `z.iso.datetime()`); the Zod 3 forms such as `z.string().email()`
still work but are deprecated. `z.object` strips unknown keys by default; use
`z.strictObject` to reject them.

`parse` throws; `safeParse` returns a discriminated union you narrow on:

```ts
const result = User.safeParse(input);
if (!result.success) {
  z.flattenError(result.error);
  // { formErrors: [], fieldErrors: { id: ['Invalid UUID'], name: ['Too small: ...'] } }
  z.treeifyError(result.error);   // nested { errors, properties } for deep objects
  z.prettifyError(result.error);  // a human-readable string for logs and CLIs
} else {
  result.data.role;               // 'admin' | 'member'
}
```

In Zod 4, `z.flattenError` suits flat forms, `z.treeifyError` suits nested ones,
and the old `error.format()` / `error.flatten()` methods are deprecated.

### Coercion and transforms

Query strings, form fields and env vars are always strings. Coercion converts
before validating; transforms reshape after:

```ts
const Query = z.object({
  page: z.coerce.number().int().min(1).default(1),
  tags: z.string().transform((s) => s.split(',').filter(Boolean)).optional(),
});
type QueryIn = z.input<typeof Query>;    // what you accept
type QueryOut = z.output<typeof Query>;  // what you get: page is number, tags string[]

Query.parse({ page: '3', tags: 'a,b' }); // { page: 3, tags: ['a', 'b'] }
```

Once transforms are involved, input and output types differ; `z.infer` is the
output. One trap: `z.coerce.boolean()` is `Boolean(value)`, so the string
`'false'` becomes `true`. Use `z.stringbool()` for `'true'`/`'false'`/`'1'`/`'0'`.

## Valibot, and Standard Schema

Valibot does the same job with standalone functions instead of methods, so a
bundler can tree-shake what you do not use. It matters in the browser, where
Zod's full build is noticeably heavier (Zod also ships a smaller `zod/mini`).

```ts
import * as v from 'valibot';

const User = v.object({
  id: v.pipe(v.string(), v.uuid()),
  email: v.pipe(v.string(), v.email()),
  name: v.pipe(v.string(), v.minLength(1)),
});
type User = v.InferOutput<typeof User>;

const user = v.parse(User, input);      // throws ValiError
const result = v.safeParse(User, input);
```

| | Zod 4 | Valibot 1 |
|---|---|---|
| Style | chained methods | piped functions |
| Type | `z.infer<typeof S>` | `v.InferOutput<typeof S>` |
| Throwing parse | `S.parse(x)` | `v.parse(S, x)` |
| Safe parse | `S.safeParse(x)` | `v.safeParse(S, x)` |
| Bundle | larger (or `zod/mini`) | small, tree-shakable |

Both implement **Standard Schema**, a tiny shared interface (a `~standard`
property with a `validate` function). Libraries such as tRPC, TanStack Form,
Hono validators and React Hook Form resolvers accept any Standard Schema, so
you are not locked in. You can write library-agnostic helpers against it too:

```ts
import type { StandardSchemaV1 } from '@standard-schema/spec';

async function validate<S extends StandardSchemaV1>(
  schema: S,
  input: unknown,
): Promise<StandardSchemaV1.InferOutput<S>> {
  const result = await schema['~standard'].validate(input);
  if (result.issues) throw new Error(result.issues.map((i) => i.message).join('; '));
  return result.value;
}
```

## Validating both directions

**On the server, validate every request body, query and param.** The client
is not yours; anyone can `curl` your endpoint. Reject with 400 and a field map
(see [rest-api-design.md](rest-api-design.md) and
[typescript-error-handling.md](typescript-error-handling.md) for the response
shape):

```ts
const CreateOrder = z.strictObject({
  productId: z.uuid(),
  quantity: z.number().int().min(1).max(100),
});

function handleCreate(body: unknown) {
  const parsed = CreateOrder.safeParse(body);
  if (!parsed.success) {
    return { status: 400, body: { errors: z.flattenError(parsed.error).fieldErrors } };
  }
  return { status: 201, body: parsed.data };   // typed from here on
}
```

**On the client, validate responses** when the API is not under your control,
or when a mismatch would corrupt state. It turns "the backend changed" from a
mysterious rendering bug into one clear error at the fetch call, which is what
[ts/49](../../typescript/49-typed-fetch-wrapper/) wraps up. Some teams skip it
for their own API when both sides share schemas; that is a reasonable trade,
provided you can say why.

## Environment variables

`process.env` is `Record<string, string | undefined>`. Parse it once at startup
and export the typed result, so a missing secret fails the deploy rather than
the first request that needs it ([env-config-secrets.md](env-config-secrets.md)
covers the operational side):

```ts
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(32),
  ENABLE_SIGNUPS: z.stringbool().default(false),
});

const parsed = Env.safeParse(process.env);
if (!parsed.success) {
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}
export const env = parsed.data;   // env.PORT: number, env.ENABLE_SIGNUPS: boolean
```

## Sharing schemas between client and server

In a monorepo, put schemas in a shared package (`packages/contracts`) that
both apps import. The server parses requests with them, the client parses
responses and drives form validation with the same rules, and a renamed field
becomes a compile error on both sides ([ts/34](../../typescript/34-api-boundary/),
[ts/43](../../typescript/43-schema-infer/)). Keep the shared package free of
server-only imports, or you will bundle your database driver into the browser.
Remember that a shared schema is not a security boundary: the server must still
parse, because the client's copy is advisory.

## Branded types: nominal typing on a structural language

TypeScript is **structural**: two types with the same shape are interchangeable.
`UserId` and `OrderId` declared as `string` are the same type, so passing one
where the other belongs compiles. A **brand** adds a phantom property that
exists only at the type level, making the types incompatible:

```ts
type Brand<T, B extends string> = T & { readonly __brand: B };
type Email = Brand<string, 'Email'>;

// Smart constructor: the only sanctioned way to make an Email
function toEmail(raw: string): Email | null {
  const s = raw.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s) ? (s as Email) : null;
}

declare function sendWelcome(to: Email): void;

const email = toEmail('A@B.com');
if (email) sendWelcome(email);
// @ts-expect-error: a plain string has not been checked
sendWelcome('a@b.com');
```

The `as` inside the smart constructor is the one cast you allow, in one place,
guarded by a check. Everything downstream can trust that an `Email` was
validated. Zod does the same with `.brand()`:

```ts
const UserId = z.uuid().brand<'UserId'>();
type UserId = z.infer<typeof UserId>;
const OrderId = z.uuid().brand<'OrderId'>();
type OrderId = z.infer<typeof OrderId>;

declare function loadOrder(id: OrderId): void;
const uid = UserId.parse(input);
// @ts-expect-error: a UserId is not an OrderId, although both are strings
loadOrder(uid);
```

Brands cost nothing at runtime; the value is still a plain string. See
[ts/29](../../typescript/29-branded-types/) and
[ts/52](../../typescript/52-branded-units/) for the pattern applied to IDs and
units.

## What you should be able to answer

- Why does `const user = await res.json() as User` not make your code type-safe?
- What is the difference between validating and parsing, and why does
  "parse, don't validate" matter?
- How do you derive a TypeScript type from a Zod schema, and why is that better
  than writing both?
- Why is `z.coerce.boolean()` wrong for an env var, and what do you use instead?
- If the client already validates a form with a shared schema, why must the
  server validate again?
- TypeScript is structural; how do you stop someone passing a `UserId` where an
  `OrderId` is expected?
