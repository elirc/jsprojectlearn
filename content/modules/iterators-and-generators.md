# Iterators and generators

`for...of`, spread, destructuring, `Array.from`, `new Map(entries)` and
`Promise.all` all run on one small protocol. Interviewers ask "what makes an
object iterable?" and "what is a generator for?" to see whether you understand
the machinery under everyday syntax — and whether you can use it for lazy,
paginated or streaming data without loading everything into memory. This guide
covers the synchronous side; async iteration is in
[async iteration and streams](js-async-iteration-streams.md).

## The iteration protocol

Two small interfaces:

- An **iterable** has a method under the key `Symbol.iterator` that returns an
  iterator.
- An **iterator** has a `next()` method returning `{ value, done }`.

```js
const it = ['pen', 'ink'][Symbol.iterator]();
console.log(it.next()); // { value: 'pen', done: false }
console.log(it.next()); // { value: 'ink', done: false }
console.log(it.next()); // { value: undefined, done: true }
```

Everything that consumes iterables — `for...of`, `...spread`, array
destructuring, `Array.from`, `new Set(x)`, `new Map(x)`, `Object.fromEntries`,
`Promise.all` — just calls `next()` until `done` is true.

| Built-in | Iterable? | Yields |
|----------|-----------|--------|
| Array | yes | elements (holes as `undefined`) |
| String | yes | code points, not UTF-16 units |
| Map | yes | `[key, value]` pairs |
| Set | yes | values |
| `arguments`, `NodeList` | yes | elements |
| Plain object | **no** | use `Object.entries(obj)` |

That last row explains `TypeError: obj is not iterable` when you write
`for (const x of { a: 1 })`.

## Making your own objects iterable

You rarely write `next()` by hand. A **generator method** under
`Symbol.iterator` is the idiomatic way:

```js
class Page {
  constructor(items, total) {
    this.items = items;
    this.total = total;
  }
  *[Symbol.iterator]() {
    yield* this.items; // delegate to the array's iterator
  }
}

const page = new Page([{ id: 1 }, { id: 2 }], 40);
for (const row of page) console.log(row.id); // 1, then 2
const [first] = page;
console.log(first, [...page].length); // { id: 1 } 2
```

Each `for...of` calls `[Symbol.iterator]()` again and gets a fresh iterator, so
the object can be looped over many times.

## Generators: functions that pause

A `function*` returns a generator object without running its body. Each
`next()` runs until the next `yield`, hands out that value, and pauses with all
local variables intact.

```js
function* ids() {
  console.log('start');
  yield 1;
  yield 2;
  return 'done';
}

const gen = ids();
console.log('created');
console.log(gen.next()); // logs "start", then { value: 1, done: false }
console.log([...gen]);   // [ 2 ]: the return value is not included
```

Three facts interviewers check:

1. **Nothing runs until the first `next()`** — creating the generator is free.
2. **A generator object is single-use.** Once drained it stays done; a second
   spread gives `[]`. Return an array, or return a fresh generator from a
   function, if callers need to iterate twice.
3. **The `return` value is invisible to `for...of` and spread**; only `yield`ed
   values are produced.

Generators can also receive values: `const x = yield 1` gets whatever the
caller passes to the next `next(value)`. That two-way channel is what libraries
such as redux-saga were built on; in everyday code you mostly use generators
for producing sequences.

## Laziness: working with data you do not want in memory

Because generators produce values on demand, you can describe infinite or huge
sequences and only pay for what you consume.

```js
function* naturals() {
  let n = 1;
  while (true) yield n++;
}

function* take(iterable, count) {
  if (count <= 0) return;
  for (const x of iterable) {
    yield x;
    if (--count === 0) return;
  }
}

console.log([...take(naturals(), 3)]); // [ 1, 2, 3 ]
```

In a CRUD app, the real uses are:

- **Batching**: yield chunks of 500 rows for bulk inserts or API calls.
- **Walking trees**: a recursive generator with `yield*` flattens a comment
  thread or category tree without building intermediate arrays (see
  [../../37-tree-utils/](../../37-tree-utils/)).
- **Parsing**: yield one record at a time from a large CSV or log file (see
  [../../85-streaming-log-parser/](../../85-streaming-log-parser/)).

```js
function* chunks(rows, size) {
  for (let i = 0; i < rows.length; i += size) yield rows.slice(i, i + size);
}

function* walk(node, depth = 0) {
  yield { id: node.id, depth };
  for (const child of node.children ?? []) yield* walk(child, depth + 1);
}

console.log([...chunks([1, 2, 3, 4, 5], 2)]); // [ [ 1, 2 ], [ 3, 4 ], [ 5 ] ]
const thread = { id: 'a', children: [{ id: 'b', children: [{ id: 'c' }] }, { id: 'd' }] };
console.log([...walk(thread)].map((n) => `${n.id}${n.depth}`).join(' ')); // a0 b1 c2 d1
```

## Iterator helpers (Node 24)

ES2025 added lazy `map`, `filter`, `take`, `drop`, `flatMap`, `reduce`,
`toArray`, `forEach`, `some`, `every` and `find` directly on iterators, plus
`Iterator.from()` to wrap any iterable. Unlike array methods, they do not build
intermediate arrays, and they work on infinite sequences:

```js
function* naturals() {
  let n = 1;
  while (true) yield n++;
}

const oddSquares = naturals().filter((n) => n % 2).map((n) => n * n).take(3);
console.log(oddSquares.toArray()); // [ 1, 9, 25 ]

const prices = new Map([['tea', 250], ['cake', 199]]);
console.log(prices.entries().map(([k, p]) => `${k}: ${p / 100}`).toArray()); // [ 'tea: 2.5', 'cake: 1.99' ]
```

Map and Set iterators get these methods too, which removes a lot of
`[...map.entries()].map(...)` noise. For support details across runtimes see
[modern JavaScript features](modern-js-features.md).

## Cleanup: `return()` and `finally`

When a consumer stops early — `break`, `return` or an exception inside
`for...of`, or destructuring that only takes the first item — the engine calls
the iterator's `return()` method. For a generator, that resumes it as if a
`return` happened at the paused `yield`, so its `finally` block runs:

```js
function* rows() {
  console.log('open cursor');
  try {
    yield 1;
    yield 2;
    yield 3;
  } finally {
    console.log('close cursor');
  }
}

for (const r of rows()) {
  if (r === 2) break;
  console.log(r);
}
// open cursor, 1, close cursor
```

That is what makes generators safe wrappers around resources such as database
cursors or file handles: the consumer can stop at any time and cleanup still
happens. If you write a hand-rolled iterator around a resource, implement
`return()` yourself.

## Generators or arrays?

| Use an array when | Use a generator when |
|-------------------|----------------------|
| the data is small and already in memory | the data is large, infinite or expensive to produce |
| callers need `length`, indexing or multiple passes | callers usually consume once, in order |
| you want to sort or group it | you want to stop early without doing the rest |
| it crosses an API boundary (JSON) | it stays inside one process |

Most CRUD code should return arrays. Reach for generators when memory, early
exit or streaming actually matter, and convert at the edge with `Array.from` or
`.toArray()`.

## What you should be able to answer

- What makes an object iterable, and why can you not `for...of` over a plain
  object?
- What happens when you call a generator function, and when does its body
  start running?
- Why does spreading the same generator object twice give an empty array the
  second time?
- How do you make a class usable with `for...of` and spread?
- What does breaking out of a `for...of` loop do to a generator, and why does
  that matter for cursors or files?
- How do iterator helpers differ from array methods, and when would you use
  them?
