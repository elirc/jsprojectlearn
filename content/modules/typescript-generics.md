# Generics in practice

Generics are where mid-level TypeScript interviews stop being about syntax and
start being about judgement. You will be asked to write a typed helper, and the
follow-up is usually "why is that type parameter there?" This guide covers the
generics you actually write in application code, and the ones you should delete.

## What a type parameter is for

A type parameter **relates two or more positions** in a signature. It says "the
type that comes in here is the type that comes out there".

```ts
function first<T>(items: T[]): T | undefined {
  return items[0];
}

const n = first([1, 2, 3]);        // number | undefined
const s = first(['a', 'b']);       // string | undefined
```

`T` appears in the parameter and the return type, so the caller's type flows
through. Without it you would pick `unknown` (useless to the caller) or `any`
(unsafe). The [generics intro project](../../typescript/16-generics-intro/)
starts here.

The test for every type parameter: **does it appear in at least two places?** If
it appears once, it relates nothing.

```ts
// Pointless: T is used once, so it adds nothing over `unknown`
function logValue<T>(value: T): void {
  console.log(value);
}

// Same behaviour, simpler signature
function logValue2(value: unknown): void {
  console.log(value);
}
```

This is the most common generics mistake in code review, and the TypeScript
handbook states the rule outright: if a type parameter only appears in one
location, reconsider whether you need it.

## Constraints

A bare `T` could be anything, so you can do almost nothing with it. `extends`
narrows what callers may pass and, in return, lets you use what the constraint
guarantees:

```ts
function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

type Order = { id: string; total: number };
const orders: Order[] = [{ id: 'o1', total: 10 }];
const lookup = byId(orders);          // Map<string, Order>, not Map<string, { id: string }>
lookup.get('o1')?.total;

byId([{ name: 'no id' }]);            // Error: 'id' is missing
```

The point of the constraint over a plain `{ id: string }[]` parameter is that
the **full** type comes back out. Had you written `items: { id: string }[]`, the
map would lose `total`. See [generic constraints](../../typescript/17-generic-constraints/).

## `keyof` and indexed access

Combining a type parameter with `keyof` lets you type property access by name:

```ts
function pluck<T, K extends keyof T>(items: T[], key: K): T[K][] {
  return items.map((item) => item[key]);
}

type Product = { sku: string; price: number; tags: string[] };
declare const products: Product[];

const prices = pluck(products, 'price');   // number[]
const tags = pluck(products, 'tags');      // string[][]
pluck(products, 'colour');                 // Error: not a key of Product
```

`K extends keyof T` restricts the key to real property names, and `T[K]` is the
type at that key. Two type parameters, each used more than once, each earning
its place. The same trick types a `sortBy`, a `groupBy` or a form's
`setField(name, value)` so the value must match the field. More in the
[keyof lookup project](../../typescript/18-keyof-lookup/).

## Defaults

A type parameter can have a default, used when the caller does not specify one
and inference has nothing to go on:

```ts
type ApiResponse<TData, TError = { message: string }> =
  | { ok: true; data: TData }
  | { ok: false; error: TError };

type UserResponse = ApiResponse<{ id: string }>;               // default error type
type UploadResponse = ApiResponse<{ url: string }, { code: number }>;
```

Defaults go last, like default function arguments. They are most useful on
types (`Result<T, E = Error>`); on functions, inference usually supplies the
type anyway.

## A typed fetch wrapper

Here is the generic every web codebase ends up with, and the version that lies:

```ts
// Looks typed, is not: T is whatever the caller claims
async function getJsonUnsafe<T>(url: string): Promise<T> {
  const res = await fetch(url);
  return res.json() as Promise<T>;
}
```

`T` appears only in the return type, and nothing checks it. `getJsonUnsafe<User>('/api/orders')`
compiles happily. That is a cast with extra steps, sometimes called a "return
type only generic", and it is the second most common generics mistake.

The honest version takes something that produces the type at runtime, a parser,
so `T` is inferred from real evidence:

```ts
type Parser<T> = (data: unknown) => T;

class HttpError extends Error {
  constructor(public status: number, url: string) {
    super(`${status} from ${url}`);
  }
}

async function getJson<T>(url: string, parse: Parser<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new HttpError(res.status, url);
  return parse(await res.json());
}

type User = { id: string; name: string };
const parseUser: Parser<User> = (data) => {
  if (typeof data === 'object' && data !== null && 'id' in data && 'name' in data &&
      typeof data.id === 'string' && typeof data.name === 'string') {
    return { id: data.id, name: data.name };
  }
  throw new Error('Not a user');
};

async function load() {
  const user = await getJson('/api/users/1', parseUser);   // User, inferred
  return user.name;
}
```

Now `T` relates the parser to the result. In real code the parser is a schema's
`.parse` method (Zod, Valibot), which is exactly a `(data: unknown) => T`. The
[typed fetch wrapper project](../../typescript/49-typed-fetch-wrapper/) builds
the full version with errors and query strings; [runtime
validation](typescript-runtime-validation.md) covers the schema side.

## A typed cache or repository

Generics on a class relate every method to the same `T`:

```ts
interface Entity { id: string }

class InMemoryRepo<T extends Entity> {
  private rows = new Map<string, T>();

  save(row: T): T {
    this.rows.set(row.id, row);
    return row;
  }
  get(id: string): T | undefined {
    return this.rows.get(id);
  }
  update(id: string, patch: Partial<Omit<T, 'id'>>): T | undefined {
    const current = this.rows.get(id);
    if (!current) return undefined;
    const next = { ...current, ...patch };
    this.rows.set(id, next);
    return next;
  }
}

type Customer = { id: string; email: string; vip: boolean };
const customers = new InMemoryRepo<Customer>();
customers.update('c1', { vip: true });
customers.update('c1', { id: 'c2' });        // Error: id is not patchable
```

`Partial<Omit<T, 'id'>>` is derived from `T`, so the patch type tracks the
entity. (The [utility and mapped types guide](typescript-utility-mapped-types.md)
explains how those work.) The [generic LRU project](../../typescript/41-generic-lru/)
applies the same idea to a bounded cache.

## `const` type parameters (5.0+)

By default, inference widens literals: `['admin', 'editor']` is inferred as
`string[]`. Putting `const` before a type parameter asks for the narrowest type,
as if the caller had written `as const`:

```ts
function defineRoles<const T extends readonly string[]>(roles: T): T {
  return roles;
}

const roles = defineRoles(['admin', 'editor']);   // readonly ["admin", "editor"]
type Role = (typeof roles)[number];               // "admin" | "editor"
```

Write the constraint as `readonly string[]`: it accepts both mutable arrays and
`as const` values, whereas a mutable `string[]` constraint rejects a readonly
tuple (and, before 5.3, made inference fall back to `string[]`). Use `const` type parameters for configuration helpers
(route tables, permission lists, event names) where the literal values are the
point. See [as const](../../typescript/31-as-const/).

## `NoInfer` (5.4+)

Sometimes a type parameter appears in several positions, but only one of them
should decide it. `NoInfer<T>` marks a position as "check against `T`, but do
not use this to infer `T`":

```ts
function createMachine<S extends string>(config: { states: S[]; initial: NoInfer<S> }) {
  return config;
}

createMachine({ states: ['idle', 'loading', 'done'], initial: 'idle' });
createMachine({ states: ['idle', 'loading'], initial: 'finished' }); // Error: not one of the states
```

Without `NoInfer`, TypeScript infers `S` from both positions, `'finished'` joins
the union, and the typo compiles. The same applies to a `defaultValue` that must
be one of `options`, or a `fallbackLocale` that must be one of `locales`.

## Mistakes to recognise

| Smell | Why it is wrong | Fix |
|---|---|---|
| `T` used once | relates nothing | use `unknown` or the concrete type |
| `T` only in the return type | an unchecked cast the caller controls | take a parser, or return `unknown` |
| `function f<T extends string>(x: T)` where `string` would do | adds noise, no relationship | drop the parameter unless you return `T` |
| `<T = any>` defaults | silently turns off checking | default to `unknown` |
| explicit `f<User>(...)` everywhere | inference is not getting evidence | restructure so `T` is inferred from an argument |
| generics on a one-off function | premature abstraction | type it concretely; generalise on the second use |

## What you should be able to answer

- When does a type parameter earn its place, and what is wrong with one that
  appears only once?
- Why is `function getJson<T>(url: string): Promise<T>` not type-safe, and how
  would you fix it?
- What does `T extends { id: string }` give you over a parameter typed
  `{ id: string }[]`?
- How would you type a `pluck(items, key)` function?
- What do `const` type parameters and `NoInfer` each solve?
