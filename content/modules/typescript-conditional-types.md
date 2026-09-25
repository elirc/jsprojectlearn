# Conditional types and `infer`

You will rarely write a conditional type in application code, but you will read
them every day: in library `.d.ts` files, in error tooltips, and in the built-in
utilities. Interviewers ask about them to see whether you can read a type like
`T extends Promise<infer U> ? U : T` and say what it does, and whether you know
when writing one is a bad idea.

## The shape: a ternary for types

```ts
type IsString<T> = T extends string ? true : false;

type A = IsString<'hello'>;   // true
type B = IsString<42>;        // false
```

`T extends X ? Yes : No` asks "is `T` assignable to `X`?" and picks a branch.
`extends` here means assignability, the same test as `const x: X = t`, not class
inheritance. That is all a conditional type is. The power comes from three
things layered on top: **distribution** over unions, **`infer`** to capture part
of a type, and **recursion**. The [conditional types project](../../typescript/27-conditional-types/)
starts from here.

## Reading them in library code

Most conditional types you meet are someone else's. The built-ins are a good
place to practise reading:

```ts
// From lib.es5.d.ts (simplified formatting)
type MyExclude<T, U> = T extends U ? never : T;
type MyExtract<T, U> = T extends U ? T : never;
type MyNonNullable<T> = T & {};
type MyReturnType<T extends (...args: any) => any> = T extends (...args: any) => infer R ? R : any;
type MyParameters<T extends (...args: any) => any> = T extends (...args: infer P) => any ? P : never;
```

A reading technique that works on any of them: find the `extends`, say the
pattern on its right in words ("a function returning something, call it `R`"),
then read the two branches. `ReturnType` becomes "if `T` is a function returning
`R`, give me `R`". (`NonNullable` has been `T & {}` since 4.8, not a conditional,
because intersecting with `{}` removes `null` and `undefined`.)

When a tooltip is unreadable, hover the individual pieces, or create a
throwaway alias (`type Check = Parameters<typeof fn>`) and hover that. For the
wider skill of reading and writing declaration files, see
[declarations and migration](typescript-declarations-and-migration.md).

## Distribution over unions, and `[T]`

When the checked type is a **naked type parameter** and you pass a union, the
conditional runs once per member and the results are unioned:

```ts
type ToArray<T> = T extends unknown ? T[] : never;
type Dist = ToArray<string | number>;           // string[] | number[]

type ToArrayNonDist<T> = [T] extends [unknown] ? T[] : never;
type NonDist = ToArrayNonDist<string | number>; // (string | number)[]
```

Distribution is why `Exclude<'a' | 'b' | 'c', 'a'>` works: each member is tested
alone, and `'a'` maps to `never`, which disappears from a union.

Wrapping both sides in a tuple, `[T] extends [X]`, switches distribution off.
You need that when asking a question about the type **as a whole**:

```ts
type IsNever<T> = [T] extends [never] ? true : false;
type Naive<T> = T extends never ? true : false;

type Good = IsNever<never>;   // true
type Bad = Naive<never>;      // never: distributing over an empty union gives an empty union
```

`never` is the empty union, so a distributive conditional over it produces
`never` without evaluating either branch. That surprises everyone once. The
[`DistributiveOmit` fix](typescript-utility-mapped-types.md) uses distribution
deliberately, with `T extends unknown` as a "run this per member" switch.

## `infer`: pattern matching inside a type

`infer X` declares a type variable inside the `extends` pattern and binds it to
whatever sits in that position. It can go almost anywhere:

```ts
type ElementOf<T> = T extends readonly (infer E)[] ? E : never;
type Unwrap<T> = T extends Promise<infer V> ? V : T;
type FirstArg<F> = F extends (first: infer A, ...rest: never[]) => unknown ? A : never;
type Head<T> = T extends readonly [infer H, ...unknown[]] ? H : never;

type E1 = ElementOf<string[]>;                 // string
type E2 = Unwrap<Promise<number>>;             // number
type E3 = FirstArg<(id: string, n: number) => void>;  // string
type E4 = Head<[boolean, string]>;             // boolean
```

You can constrain an inferred type in place with `infer X extends Y` (4.7+),
which saves a nested conditional:

```ts
type NumericId<T> = T extends `${infer N extends number}` ? N : never;
type Id = NumericId<'42'>;     // 42 (a number literal)
type NotId = NumericId<'abc'>; // never
```

In real code you mostly use the built-in `Awaited`, `ReturnType` and
`Parameters` rather than writing these, but understanding the pattern is what
lets you read them.

## Template literal `infer`: typing route params

The most practical conditional type in web code turns a path string into a
params object. It combines template literal types, `infer` and recursion:

```ts
type RouteParams<Path extends string> =
  Path extends `${string}:${infer Param}/${infer Rest}`
    ? { [K in Param]: string } & RouteParams<`/${Rest}`>
    : Path extends `${string}:${infer Param}`
      ? { [K in Param]: string }
      : {};

type Flatten<T> = { [K in keyof T]: T[K] };

function buildPath<P extends string>(path: P, params: Flatten<RouteParams<P>>): string {
  return path.replace(/:(\w+)/g, (_, key: string) => encodeURIComponent((params as Record<string, string>)[key] ?? ''));
}

buildPath('/orders/:orderId/lines/:lineId', { orderId: 'o1', lineId: 'l2' });
buildPath('/orders/:orderId', { id: 'o1' });   // Error: 'id' is not 'orderId'
```

Read the first branch as: "if the path contains `:Param/` followed by more
path, produce `{ Param: string }` and recurse on the rest". `Flatten` is a
homomorphic mapped type that merges the intersection so the tooltip shows
`{ orderId: string; lineId: string }` rather than `A & B & {}`. The `as` inside
the implementation is the usual price: the body works on strings the type system
cannot follow. This is how typed routers such as React Router 7 and Hono derive
params; the [infer routes](../../typescript/28-infer-routes/) and
[route params](../../typescript/44-route-params/) projects build it step by step.

## Extracting event payloads

The other everyday use: pulling one member's payload out of a union of events,
so a subscriber gets the right type for the event name it passes.

```ts
type AppEvent =
  | { type: 'order.created'; orderId: string; total: number }
  | { type: 'order.cancelled'; orderId: string; reason: string }
  | { type: 'user.signedIn'; userId: string };

type EventType = AppEvent['type'];
type PayloadOf<T extends EventType> = Omit<Extract<AppEvent, { type: T }>, 'type'>;

function on<T extends EventType>(type: T, handler: (payload: PayloadOf<T>) => void): void {
  // register handler
}

on('order.cancelled', (p) => console.log(p.reason));   // p: { orderId; reason }
on('user.signedIn', (p) => console.log(p.total));      // Error: no 'total' on this payload
```

`Extract` is the conditional doing the work: it keeps the union member whose
`type` matches. Often a mapped **event map** (`{ 'order.created': {...}; ... }`)
is simpler still, since `Events[T]` needs no conditional at all. Prefer that
when you control the types; the [event payload maps](../../typescript/51-event-payload-maps/)
and [typed event emitter](../../typescript/20-typed-event-emitter/) projects
compare both.

## When not to write one

Conditional types are the easiest way to make a codebase hostile to the next
developer. Before writing one, check:

| Symptom | What it costs | Alternative |
|---|---|---|
| Error says "not assignable to `RouteParams<...>`" with ten lines of expansion | people cast instead of reading it | simpler types, or overloads |
| A generic function body full of `as` | the body is unchecked anyway | overloads with concrete signatures |
| Recursion over long strings or deep objects | slow editor, "type instantiation is excessively deep" | cap depth or generate types |
| Used by one call site | abstraction with no payoff | write the concrete type |
| A lookup that could be `Map[K]` | conditional where indexing would do | an interface or `Record` map |

A good rule: conditional types belong in **library-like code** (a router, a
typed API client, a form library) that many call sites use and few people edit.
In feature code, a union and a `switch` are clearer. [Function
overloads](../../typescript/22-overloads/) often express "input A gives output
B" more readably than `T extends A ? B : C`.

## Testing your types

A type-level function needs tests like any other function, because a mistake
silently widens to `any` or `{}` rather than failing. Two light options:

```ts
type Expect<T extends true> = T;
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;

type RouteParams<P extends string> = P extends `${string}:${infer K}` ? { [Q in K]: string } : {};

type Tests = [
  Expect<Equal<RouteParams<'/users/:id'>, { id: string }>>,
  Expect<Equal<RouteParams<'/about'>, {}>>,
];

const sample = { id: 'u1' } satisfies RouteParams<'/users/:id'>;
```

The `Equal` helper is the well-known strict equality trick; it distinguishes
`any` from `unknown`, which a plain mutual `extends` check does not. `satisfies`
checks a value against a type without widening it. For a real suite, the
`expect-type` library (`expectTypeOf(x).toEqualTypeOf<...>()`) runs inside
Vitest (`vitest --typecheck`), and `// @ts-expect-error` lines assert that bad
calls stay errors. The [type testing project](../../typescript/42-type-testing/)
sets this up.

## What you should be able to answer

- What does `T extends Promise<infer U> ? U : T` do, and how would you read
  `ReturnType` from `lib.es5.d.ts`?
- What is a distributive conditional type, and why does wrapping in `[T]` change
  the result?
- Why does `T extends never ? true : false` return `never` for `never`?
- How would you type `buildPath('/orders/:id', params)` so `params` must contain
  `id`?
- When would you choose overloads or a plain union over a conditional type?
- How do you test a type so a regression fails the build?
