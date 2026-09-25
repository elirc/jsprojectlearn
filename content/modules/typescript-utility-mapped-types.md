# Utility types and mapped types

Every TypeScript codebase uses `Partial`, `Pick` and `Omit`, and most interviews
ask you to explain one of them or write it yourself. Knowing that they are
ordinary mapped types, a few lines each, is what lets you derive DTOs from
entities instead of copying fields, and spot the `Omit` bug that bites unions.

## The built-ins you will use

| Utility | Does | Typical use |
|---|---|---|
| `Partial<T>` | every property optional | PATCH bodies, update functions |
| `Required<T>` | every property required | config after defaults are applied |
| `Readonly<T>` | every property `readonly` (shallow) | state, frozen config |
| `Pick<T, K>` | keep only keys `K` | list-view projections |
| `Omit<T, K>` | drop keys `K` | create DTOs without server fields |
| `Record<K, V>` | object with keys `K`, values `V` | lookup tables, enum-like maps |
| `Exclude<U, X>` | remove members of union `U` assignable to `X` | `Exclude<Status, 'deleted'>` |
| `Extract<U, X>` | keep members of `U` assignable to `X` | pick union members by shape |
| `NonNullable<T>` | remove `null` and `undefined` | after a guard |
| `ReturnType<F>` | a function's return type | type from a factory you do not own |
| `Parameters<F>` | a function's parameters as a tuple | wrapping a library function |
| `Awaited<T>` | unwrap promises (recursively) | `Awaited<ReturnType<typeof load>>` |

Two distinctions trip people up. **`Pick`/`Omit` work on object keys;
`Extract`/`Exclude` work on union members.** And `Omit` is not checked:
`Omit<User, 'emial'>` compiles and removes nothing, while `Pick<User, 'emial'>`
is an error, because `Omit`'s key parameter is `K extends keyof any`, not
`keyof T`.

```ts
type Status = 'draft' | 'active' | 'deleted';
type Visible = Exclude<Status, 'deleted'>;                 // 'draft' | 'active'

type Event =
  | { type: 'click'; x: number; y: number }
  | { type: 'key'; key: string }
  | { type: 'scroll'; y: number };
type Positioned = Extract<Event, { y: number }>;           // click | scroll

async function loadDashboard() {
  return { orders: 3, revenue: 120 };
}
type Dashboard = Awaited<ReturnType<typeof loadDashboard>>; // { orders: number; revenue: number }
```

The [utility types project](../../typescript/24-utility-types/) exercises each
of these on a realistic domain.

## How they are defined

Open `lib.es5.d.ts` in your editor (go to definition on `Partial`) and you will
find the whole thing is a few lines. The core are **mapped types**, which loop
over a set of keys:

```ts
type MyPartial<T> = { [K in keyof T]?: T[K] };
type MyRequired<T> = { [K in keyof T]-?: T[K] };
type MyReadonly<T> = { readonly [K in keyof T]: T[K] };
type MyPick<T, K extends keyof T> = { [P in K]: T[P] };
type MyRecord<K extends keyof any, V> = { [P in K]: V };
type MyOmit<T, K extends keyof any> = MyPick<T, Exclude<keyof T, K>>;
```

Read `{ [K in keyof T]?: T[K] }` as: for every key `K` of `T`, produce an
optional property `K` whose type is whatever `T` had at `K`. `Exclude`,
`Extract` and `NonNullable` are conditional types instead; they are covered in
[conditional types](typescript-conditional-types.md).

Being able to write `MyPartial` and `MyPick` from memory is a fair interview
ask. `MyOmit` is the follow-up: it is `Pick` over the keys that are left.

## Modifiers: adding and removing `readonly` and `?`

Mapped types can add or remove the two property modifiers. `+` is the default
and usually omitted; `-` removes:

```ts
type Config = { readonly apiUrl: string; timeoutMs?: number };

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type Complete<T> = { [K in keyof T]-?: T[K] };

type EditableConfig = Mutable<Config>;   // { apiUrl: string; timeoutMs?: number }
type ResolvedConfig = Complete<Config>;  // { readonly apiUrl: string; timeoutMs: number }
```

`Mutable` is not built in, but you will see it in most codebases. Note that
`-?` also strips `undefined` from the property type when it was only there
because of the `?`.

`Readonly` and `Partial` are **shallow**: `Readonly<{ address: { city: string } }>`
still lets you write `obj.address.city = 'x'`. Deep versions are recursive
mapped types; the [deep utility types project](../../typescript/47-deep-utility-types/)
builds them and shows where they get expensive.

## Homomorphic mapped types

A mapped type of the form `{ [K in keyof T]: ... }` is **homomorphic**: it maps
over an existing type's keys, so TypeScript preserves each property's
`readonly` and `?` modifiers unless you change them. That is why
`Partial<Config>` keeps `apiUrl` as `readonly`.

Homomorphic mapped types have two other useful behaviours:

```ts
type Stringify<T> = { [K in keyof T]: string };

type Row = Stringify<{ id: number; paid: boolean }>;  // { id: string; paid: string }
type Cells = Stringify<[number, boolean]>;            // [string, string], still a tuple
type Maybe = Stringify<string | undefined>;           // string | undefined: primitives pass through
```

They map arrays and tuples element-wise, and they distribute over unions. A
mapped type over some other key set (`{ [K in 'a' | 'b']: ... }`, or `Pick`,
whose keys come from `K`) is not homomorphic in this sense, though `Pick` still
copies modifiers because `K` is constrained to `keyof T`.

## Key remapping with `as`

Since 4.1, a mapped type can rename or filter keys with an `as` clause. Combined
with template literal types, this generates APIs from a model:

```ts
type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K];
};

type Person = { name: string; age: number };
type PersonGetters = Getters<Person>;   // { getName: () => string; getAge: () => number }

type OnlyFunctions<T> = {
  [K in keyof T as T[K] extends (...args: never[]) => unknown ? K : never]: T[K];
};

type Service = { baseUrl: string; get(id: string): Promise<unknown>; list(): Promise<unknown[]> };
type ServiceMethods = OnlyFunctions<Service>;  // { get: ...; list: ... }
```

Remapping a key to `never` drops it, which is how you filter by value type.
`string & K` is there because `keyof T` can include `number` and `symbol` keys,
which `Capitalize` does not accept. See the [mapped types](../../typescript/25-mapped-types/)
and [template literals](../../typescript/26-template-literals/) projects.

## Deriving DTOs from one entity

The practical payoff: define the entity once and derive every shape the API
needs, so adding a field updates them all.

```ts
type Product = {
  id: string;
  name: string;
  priceCents: number;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

type ServerManaged = 'id' | 'createdAt' | 'updatedAt';

type CreateProductDto = Omit<Product, ServerManaged>;
type UpdateProductDto = Partial<CreateProductDto>;
type ProductListItem = Pick<Product, 'id' | 'name' | 'priceCents'>;
type ProductsById = Record<Product['id'], Product>;

const body: CreateProductDto = { name: 'Mug', priceCents: 900, description: null };
const patch: UpdateProductDto = { priceCents: 850 };
const bad: CreateProductDto = { ...body, id: 'p1' };   // Error: id is not in the create DTO
```

Be precise about what the last line proves. The literal names `id` explicitly,
so excess property checking catches it. Assign a variable that happens to carry
an `id` and it compiles, because TypeScript's object types are open. DTO types describe what you *accept*; you still strip or reject
extra fields at runtime with a schema. That is where
[runtime validation](typescript-runtime-validation.md) and
[REST API design](rest-api-design.md) take over.

A caution on going too far: `Omit<Partial<Pick<...>>>` chains four deep become
unreadable in hover tooltips. If a DTO is conceptually its own thing, write it
out. Derivation is for shapes that must stay in lockstep with the entity.

## `Omit` on unions: the pitfall

`Omit` is not distributive. Apply it to a union and it first computes
`keyof (A | B)`, which is only the keys **common** to every member, so the
member-specific fields vanish:

```ts
type Notification =
  | { kind: 'email'; id: string; address: string }
  | { kind: 'sms'; id: string; phone: string };

type Draft = Omit<Notification, 'id'>;
// { kind: 'email' | 'sms' }: address and phone are gone

const d: Draft = { kind: 'email', address: 'a@b.com' };  // Error: address does not exist

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type Draft2 = DistributiveOmit<Notification, 'id'>;
const ok: Draft2 = { kind: 'email', address: 'a@b.com' };
const stillChecked: Draft2 = { kind: 'sms', address: 'a@b.com' };  // Error: sms has phone, not address
```

`T extends unknown ? ... : never` looks like a no-op, but it makes the
conditional distribute: `Omit` runs on each member separately and the results
are re-joined into a union, discriminant intact. The same applies to `Pick` and
`Partial`-then-`Omit` chains over a union. Why that works is explained in
[conditional types](typescript-conditional-types.md). This bug is common in
form and API code built on [discriminated unions](typescript-discriminated-unions.md).

## What you should be able to answer

- Write `Partial`, `Pick` and `Omit` as mapped types.
- What is the difference between `Omit` and `Exclude`, and why does
  `Omit<User, 'typo'>` compile?
- How would you derive create and update DTOs from an entity type, and what do
  those types not protect you from?
- What does `-readonly` or `-?` do in a mapped type?
- How do you rename keys in a mapped type, and how do you filter them out?
- Why does `Omit` on a discriminated union lose fields, and how do you fix it?
