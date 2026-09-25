# Maps, Sets and weak references

For years JavaScript developers used plain objects for every lookup table and
arrays for every "list of unique things". `Map` and `Set` are usually better,
and ES2025 gave `Set` real set operations. Interviewers ask "Map or object?",
"how do you de-duplicate?" and "when would you use a WeakMap?" to see whether you
pick data structures deliberately — and whether you know which one quietly
leaks memory in a long-running Node process.

## Map versus plain object

Both map keys to values. They are built for different jobs.

| | Plain object | `Map` |
|---|---|---|
| Key types | strings and symbols (others converted to strings) | any value, including objects |
| Inherited keys | yes, from `Object.prototype` (unless `Object.create(null)`) | none |
| Order | integer-like keys first, then insertion order | insertion order |
| Size | `Object.keys(o).length` | `m.size` |
| Iteration | `Object.entries(o)` | directly iterable |
| JSON | serialises directly | `JSON.stringify` gives `{}` |
| Frequent add/delete | slower in V8 | designed for it |
| Best for | records with known fields, JSON payloads, config | dictionaries, caches, lookups keyed by ids or objects |

```js
const byId = new Map();
byId.set(1, 'number key').set('1', 'string key');
console.log(byId.size, byId.get(1), byId.get('1')); // 2 number key string key

const obj = {};
obj[1] = 'number key';
obj['1'] = 'string key';
console.log(Object.keys(obj).length); // 1: both became the key '1'
```

That difference cuts both ways. A Map keeps `1` and `'1'` apart, so if you store
numeric ids and look them up with a string from a route parameter, you get
`undefined`. Parse at the boundary. And a plain object keyed by user-supplied
strings has prototype keys (`toString`, `__proto__`) waiting to collide; a Map
does not.

Two common slips: `map['key'] = value` creates an ordinary property that
`get` and `size` ignore, and `Object.keys(map)` is always `[]`. Use `set`,
`get`, `has`, `delete` and the Map's own iterators.

## Key equality: SameValueZero

Maps and Sets compare keys with **SameValueZero**: like `===`, except `NaN`
equals `NaN`. Objects are compared by identity, never by contents.

```js
const cache = new Map();
cache.set({ status: 'open' }, 'rows');
console.log(cache.get({ status: 'open' })); // undefined: a different object

const seen = new Set([NaN, NaN, 0, -0]);
console.log(seen.size); // 2
```

If you need content-based keys, derive a primitive: `JSON.stringify` of a
known-shape object with stable key order, or `` `${userId}:${date}` ``. See
[equality and coercion](equality-and-coercion.md) for the other equality
algorithms.

## Sets for uniqueness and membership

A Set holds unique values in insertion order. Its two everyday uses:

```js
const tags = ['sale', 'new', 'sale', 'eco'];
console.log([...new Set(tags)]); // [ 'sale', 'new', 'eco' ]

const allowed = new Set([3, 7, 9]);
const rows = [{ id: 3 }, { id: 4 }, { id: 9 }];
console.log(rows.filter((r) => allowed.has(r.id)).map((r) => r.id)); // [ 3, 9 ]
```

The membership case matters for performance. `array.includes` scans the array,
so filtering 50,000 rows against 10,000 allowed ids is 500 million comparisons;
building a Set once makes each lookup effectively constant time.

To de-duplicate **objects** by a field, key a Map by that field (the last
duplicate wins but keeps the first position), or track seen keys in a Set (the
first wins):

```js
const people = [{ email: 'a@x.io', n: 1 }, { email: 'b@x.io', n: 2 }, { email: 'a@x.io', n: 3 }];
const lastWins = [...new Map(people.map((p) => [p.email, p])).values()].map((p) => p.n);
const seenEmails = new Set();
const firstWins = people.filter((p) => !seenEmails.has(p.email) && seenEmails.add(p.email)).map((p) => p.n);
console.log(lastWins, firstWins); // [ 3, 2 ] [ 1, 2 ]
```

## Set operations (ES2025, Node 24)

Sets now have the operations you used to hand-write with `filter`:

```js
const required = new Set(['read', 'write', 'delete']);
const granted = new Set(['read', 'export']);

console.log([...required.difference(granted)]);          // [ 'write', 'delete' ]  missing
console.log([...required.intersection(granted)]);        // [ 'read' ]
console.log([...granted.difference(required)]);          // [ 'export' ]  extra
console.log(new Set(['read']).isSubsetOf(granted));      // true
console.log(required.isDisjointFrom(new Set(['admin']))); // true
```

| Method | Returns |
|--------|---------|
| `a.union(b)` | everything in either |
| `a.intersection(b)` | only what is in both |
| `a.difference(b)` | in `a` but not `b` |
| `a.symmetricDifference(b)` | in exactly one of them |
| `a.isSubsetOf(b)`, `isSupersetOf`, `isDisjointFrom` | booleans |

The argument must be "set-like" (it needs `size`, `has` and `keys`): a Set or a
Map works, a plain array throws a TypeError, so wrap it in `new Set(array)`.
These methods return new Sets and never mutate. More on recent additions in
[modern JavaScript features](modern-js-features.md).

## Grouping: `Object.groupBy` and `Map.groupBy`

```js
const orders = [{ status: 'paid' }, { status: 'open' }, { status: 'paid' }];
const byStatus = Object.groupBy(orders, (o) => o.status);
console.log(byStatus.paid.length, byStatus.refunded?.length ?? 0); // 2 0
console.log(Object.getPrototypeOf(byStatus));                       // null

const ada = { name: 'Ada' };
const tasks = [{ owner: ada }, { owner: ada }];
console.log(Map.groupBy(tasks, (t) => t.owner).get(ada).length); // 2
```

`Object.groupBy` returns a **null-prototype** object (no `hasOwnProperty`, no
collisions with a group called `constructor`) and only creates keys for groups
that exist. Use `Map.groupBy` when the key is an object or must keep its type.

## Serialising Maps and Sets

`JSON.stringify` only sees own enumerable properties, and Maps and Sets keep
their contents internally, so both serialise to `{}` — silently.

```js
const state = { prices: new Map([['tea', 250]]), tags: new Set(['eco']) };
console.log(JSON.stringify(state)); // {"prices":{},"tags":{}}

const text = JSON.stringify({ prices: [...state.prices], tags: [...state.tags] });
const back = JSON.parse(text);
console.log(new Map(back.prices).get('tea'), new Set(back.tags).has('eco')); // 250 true
```

Convert at the boundary: spread into arrays of entries (round-trips any key
type), or `Object.fromEntries(map)` when keys are strings and you want a
readable JSON object. `structuredClone` copies Maps and Sets correctly. See
[JSON edge cases](json-edge-cases.md).

## WeakMap and WeakSet

A `WeakMap` holds its keys **weakly**: if nothing else references the key
object, it can be garbage-collected and its entry disappears. Keys must be
objects (or non-registered symbols). Because entries can vanish at any time,
there is no `size`, no `clear` and no iteration — only `get`, `set`, `has`,
`delete`.

```js
const requestMeta = new WeakMap();
function startTimer(req) { requestMeta.set(req, { start: Date.now() }); }
function elapsed(req) { return Date.now() - requestMeta.get(req).start; }

const req = { url: '/orders' };
startTimer(req);
console.log(elapsed(req) >= 0, requestMeta.has(req), requestMeta.size); // true true undefined
try {
  requestMeta.set('user:1', {});
} catch (e) {
  console.log(e.name); // TypeError
}
```

Use a WeakMap to attach data to objects you do not own — requests, DOM nodes,
objects from a library — without modifying them and without keeping them alive.
A per-object memo cache (`computeStats(order)` cached by the `order` object) is
the other classic use. A `WeakSet` does the same for membership: "have I
already processed this object?"

The trap it avoids is a module-level `Map` keyed by request or user objects,
which grows for the life of the process. Ordinary caches keyed by strings need
a size limit or expiry instead — an LRU, as in
[../../41-lru-cache/](../../41-lru-cache/).

## WeakRef and FinalizationRegistry: handle with care

`WeakRef` holds a single object weakly (`ref.deref()` returns it or
`undefined`), and `FinalizationRegistry` runs a callback some time after an
object is collected. Garbage-collection timing is unspecified and differs
between engines and runs, so:

- use them only for **optional** caches of large, re-creatable objects;
- never for correctness, cleanup of external resources (close files and
  connections explicitly), or anything a test depends on.

Most application code never needs either. Saying so in an interview is a good
answer.

## What you should be able to answer

- When would you use a Map instead of a plain object, and when would you keep
  the object?
- Why does `new Set([{ id: 1 }, { id: 1 }]).size` equal 2, and how do you
  de-duplicate objects by id?
- What equality do Map keys use, and what happens with `1` versus `'1'`?
- Which ES2025 Set method gives you "permissions the user is missing"?
- Why does `JSON.stringify` turn a Map into `{}`, and how do you round-trip it?
- What problem does a WeakMap solve, and why can you not iterate it?
