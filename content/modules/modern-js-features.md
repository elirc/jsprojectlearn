# Modern JavaScript, ES2020 to ES2026

JavaScript gains a handful of features every year, and a lot of tutorials
(and a lot of production code) stopped updating around 2019. Interviewers
notice when you write `arr.slice().sort()` instead of `toSorted()` or
`a && a.b && a.b.c` instead of `a?.b?.c`. This guide tours what arrived since,
tells you which parts matter in CRUD work, and which are still too new to lean
on.

Every example below was run on Node 24.

## Safer property access: `?.`, `??` and logical assignment

```js
const user = { profile: null, settings: { pageSize: 0 } };
user.profile?.name;               // undefined, not a TypeError
user.settings.pageSize || 20;     // 20: wrong, 0 was a real value
user.settings.pageSize ?? 20;     // 0: only null/undefined fall back

const opts = { retries: 0 };
opts.retries ||= 3;               // 3 (0 is falsy)
opts.timeout ??= 5000;            // set only if missing
// { retries: 3, timeout: 5000 }
```

`??` versus `||` is the question you will be asked: `||` falls back on any
falsy value (`0`, `''`, `false`), `??` only on `null` and `undefined`. For
defaults of numbers, strings and booleans, `??` is almost always what you
meant. Optional chaining also works on calls (`onDone?.()`) and indexes
(`rows?.[0]`).

## Numbers: separators, `BigInt`, `Float16Array`

`1_000_000` is just `1000000` written legibly. `BigInt` (`10n`, `2n ** 64n`)
gives exact integers beyond `Number.MAX_SAFE_INTEGER`; `9007199254740993`
silently prints as `9007199254740992`, which is why database `BIGINT` ids
should arrive as strings or `BigInt`s. `BigInt` cannot mix with `Number` in
arithmetic, and `JSON.stringify` throws on it. It is not for money: use integer
minor units (pence, cents) in ordinary numbers, as in the
[money cart project](../../32-money-cart/).

`Float16Array` (ES2025) is a half-precision typed array for graphics and
machine-learning data; `new Float16Array([1.1])[0]` is `1.099609375`. You will
rarely touch it.

## Arrays without mutation

| Old, mutates | New, returns a copy (ES2023) |
|--------------|------------------------------|
| `arr.sort(fn)` | `arr.toSorted(fn)` |
| `arr.reverse()` | `arr.toReversed()` |
| `arr.splice(i, n)` | `arr.toSpliced(i, n)` |
| `arr[i] = v` | `arr.with(i, v)` |

```js
const scores = [3, 1, 2];
scores.toSorted((a, b) => a - b); // [1, 2, 3]
scores;                           // [3, 1, 2]: untouched
scores.with(0, 9);                // [9, 1, 2]
```

These matter most in React, where sorting state in place is a classic bug: the
array identity does not change, so nothing re-renders, and you have mutated
state another component may be holding. Also new: `arr.at(-1)` for the last
element (ES2022), and `findLast`/`findLastIndex` (ES2023) to search from the
end.

## Grouping: `Object.groupBy` and `Map.groupBy`

The `reduce` you have written a hundred times is now one call (ES2024):

```js
const orders = [
  { status: 'paid', total: 10 },
  { status: 'open', total: 5 },
  { status: 'paid', total: 7 },
];
Object.groupBy(orders, (o) => o.status);
// [Object: null prototype] {
//   paid: [ {...total: 10}, {...total: 7} ],
//   open: [ {...total: 5} ] }
```

The result has a **null prototype**, so it has no `hasOwnProperty` method; use
`Object.hasOwn(groups, 'paid')` (ES2022), which is the modern replacement
anyway. `Map.groupBy` is the same but returns a `Map`, so keys can be objects or
numbers without being turned into strings.

## Sets with real set operations

ES2025 finally gave `Set` the methods everyone wrote helpers for:

```js
const a = new Set([1, 2, 3]);
const b = new Set([2, 3, 4]);
a.union(b);               // Set {1, 2, 3, 4}
a.intersection(b);        // Set {2, 3}
a.difference(b);          // Set {1}
a.symmetricDifference(b); // Set {1, 4}
a.isSubsetOf(new Set([1, 2, 3, 4])); // true
```

Typical use: which permissions does this role have that the user lacks
(`required.difference(granted)`), or which selected ids are still on the page.

## Iterator helpers

Iterators now have `map`, `filter`, `take`, `drop`, `flatMap`, `reduce`,
`some`, `every`, `find`, `forEach` and `toArray` (ES2025). They are **lazy**,
which arrays are not:

```js
function* naturals() { let n = 1; while (true) yield n++; }
naturals().filter((n) => n % 2 === 0).map((n) => n * n).take(3).toArray();
// [4, 16, 36]
```

An infinite generator would hang with array methods; here only six values are
ever produced. They work on anything iterable via `Iterator.from()`, and on
`map.values()` and `set.keys()` without first spreading into an array. Async
iterators do not have them yet; see
[async iteration and streams](js-async-iteration-streams.md).

## Promise additions

| Method | Settles when | Use it for |
|--------|--------------|------------|
| `Promise.allSettled` (2020) | All settle, never rejects | Batch jobs where you report each failure |
| `Promise.any` (2021) | First fulfils; `AggregateError` if all reject | Fastest mirror or fallback source |
| `Promise.withResolvers` (2024) | You call `resolve`/`reject` | Wrapping callback and event APIs |
| `Promise.try` (2025) | Runs a function, sync throws become rejections | Starting a chain from code that may throw synchronously |

`Promise.withResolvers()` returns `{ promise, resolve, reject }`, replacing the
`let resolve; new Promise(r => resolve = r)` dance. The detail is in
[promise patterns](js-promise-patterns.md).

## Errors, cloning and top-level `await`

`new Error('save failed', { cause: err })` (ES2022) chains a low-level error to a
high-level one without losing the original stack; loggers and Node's inspector
print the chain. Use it whenever you catch and rethrow.

`structuredClone(value)` deep-copies `Date`, `Map`, `Set`, typed arrays and
cycles, which `JSON.parse(JSON.stringify(x))` cannot. It is a web platform API
rather than part of ECMAScript, but every browser and Node 17+ has it. It
throws on functions and drops class prototypes (see
[web workers](web-workers.md)).

Top-level `await` (ES2022) works in ES modules; see
[ES modules in depth](es-modules-in-depth.md). `globalThis` (ES2020) is the
global object everywhere, replacing the `window`/`self`/`global` guesswork.

## Regular expressions: the `v` flag and `RegExp.escape`

The `v` flag (ES2024) upgrades `u` with set operations inside classes and
properties of strings: `/[\p{L}--[a-z]]/v` means "letters except ASCII
lowercase". More useful day to day is `RegExp.escape` (ES2025), which makes user
input safe to embed:

```js
RegExp.escape('1.5*(x)'); // '\\x31\\.5\\*\\(x\\)'
new RegExp(`^${RegExp.escape(query)}`, 'i');
```

The leading digit is escaped as `\x31` so the result is safe even after a
backreference. Without escaping, a search for `c++` throws a `SyntaxError` and a
search for `.` matches everything.

## Explicit resource management: `using`

`using` declares a value that is cleaned up automatically when its block exits,
however it exits, by calling its `[Symbol.dispose]()` method:

```js
{
  using conn = { [Symbol.dispose]() { console.log('closed'); } };
  console.log('using');
}
// using
// closed
```

`await using` does the same with `[Symbol.asyncDispose]()` for async cleanup,
and `DisposableStack` collects several resources. It replaces `try/finally`
blocks for database connections, file handles, locks and temporary
subscriptions. Node 24 and TypeScript 5.9 support it and some libraries are
adding `Symbol.dispose` to their handles, but Safari was the last browser to
ship it, so check your targets before using it in frontend code.

## Support at a glance

"Node 24" means it runs on Node 24.19 without flags.

| Feature | Edition | Node 24 |
|---------|---------|---------|
| `?.`, `??`, `BigInt`, `globalThis`, `Promise.allSettled` | ES2020 | Yes |
| Logical assignment (`&&=`, `??=` and the OR form), `1_000`, `Promise.any` | ES2021 | Yes |
| `at()`, `Object.hasOwn`, error `cause`, top-level `await` | ES2022 | Yes |
| `toSorted`/`toReversed`/`toSpliced`/`with`, `findLast` | ES2023 | Yes |
| `Object.groupBy`, `Map.groupBy`, `Promise.withResolvers`, `v` flag | ES2024 | Yes |
| Set methods, iterator helpers, `RegExp.escape`, `Promise.try`, `Float16Array`, JSON imports | ES2025 | Yes |
| `Error.isError` | ES2026 | Yes |
| `Math.sumPrecise`, `Uint8Array.fromBase64` | ES2026 | **No** (`undefined` on Node 24) |
| `using` / `await using`, `DisposableStack`, `Array.fromAsync` | Newest editions | Yes |
| `structuredClone` | Web platform, not ECMAScript | Yes (Node 17+) |
| Temporal | Shipping 2026 | Behind `--harmony-temporal` |

Being in an edition is not the same as being in your runtime: Node 24's V8
predates some ES2026 additions. Temporal has its own guide,
[Intl and Temporal](intl-and-temporal.md).

## What to actually use at work

- **Every day:** `?.`, `??`, `??=`, `at(-1)`, `Object.hasOwn`,
  `Promise.allSettled`, error `cause`, `structuredClone`, and the copying array
  methods, especially in React state.
- **Whenever it fits:** `Object.groupBy`, Set methods, `Promise.withResolvers`,
  `RegExp.escape`, iterator helpers on `Map` and `Set` values.
- **Server-side now, frontend after a support check:** `using` and `await using`.
- **Leave alone unless you need it:** `Float16Array`, the `v` flag's set
  syntax, `BigInt` outside large ids.

In TypeScript, set `lib` to include the features you use (for example
`"ES2024"` or `"ESNext"`) and `target` to what your oldest runtime supports; the
compiler down-levels syntax such as `?.` but does **not** polyfill methods like
`toSorted`. See [tsconfig explained](tsconfig-explained.md).

## What you should be able to answer

- What is the difference between `||` and `??`, and which bug does `??` prevent for a page size of `0`?
- Why prefer `toSorted()` or `with()` over `sort()` and index assignment in React state?
- What does `Object.groupBy` return, and why does calling `.hasOwnProperty` on the result fail?
- When would you use `Promise.allSettled` rather than `Promise.all`, and `Promise.any` rather than `Promise.race`?
- What problem does `using` solve, and what must an object have to be used with it?
- A feature is in ES2026: does that mean you can use it on Node 24? How would you check?
