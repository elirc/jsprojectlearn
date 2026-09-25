# Async iteration and web streams

Sooner or later you will fetch data that does not arrive all at once: an API
with fifty pages, a log file larger than memory, an AI endpoint that streams
tokens. Async iterators and web streams are the tools for that, and
interviewers use them to tell developers who can reason about data over time
from those who only ever `await res.json()`.

## Iterables, then async iterables

A synchronous iterable is anything with a `[Symbol.iterator]()` method that
returns an object with `next()`. `for...of`, spread and destructuring all use
it. An **async iterable** is the same idea with `[Symbol.asyncIterator]()`,
and its `next()` returns a *promise* of `{ value, done }`.

You almost never write that protocol by hand. An `async function*` builds it
for you: inside, you can `await` and `yield`; outside, the caller consumes it
with `for await...of`.

| | Sync | Async |
|--|------|-------|
| Protocol method | `Symbol.iterator` | `Symbol.asyncIterator` |
| `next()` returns | `{ value, done }` | `Promise<{ value, done }>` |
| Generator syntax | `function*` | `async function*` |
| Loop | `for...of` | `for await...of` |

The key property is that async generators are **lazy and pull-based**. Nothing
runs until the consumer asks for the next value, and the generator pauses at
each `yield` until it is asked again.

## Paginated APIs as generators

The classic use is hiding pagination. The caller wants "all the orders"; the
server hands them out a page at a time. A generator lets you write the paging
loop once and give callers a flat sequence:

```js
async function* allItems() {
  let page = 1;
  try {
    while (page) {
      const { items, next } = await fetchPage(page);
      yield* items;
      page = next;
    }
  } finally {
    console.log('cleanup');
  }
}

for await (const item of allItems()) {
  console.log(item);
  if (item === 'c') break;
}
```

Against a fake three-page API (`a b`, `c d`, `e`) that logs each request, this
prints:

```text
GET page 1
a
b
GET page 2
c
cleanup
```

Two things to notice. Page 3 is never requested: laziness means you only pay
for what you consume. And `yield*` delegates to the page's array, so each item
is yielded individually. The pattern is exactly what the
[paginated API project](../../44-paginated-api/) asks you to build.

## Early exit: `break` calls `return()`

When a `for await` loop exits early (through `break`, `return` or a thrown
error), the loop calls the iterator's `return()` method. For a generator that
means it resumes at the paused `yield` as if a `return` statement were there,
so any `finally` blocks run. That is why `cleanup` appeared above.

This is your hook for releasing resources: closing a database cursor,
cancelling a request, releasing a stream lock. Put the cleanup in `finally`,
not after the loop inside the generator, because code after the loop never
runs on an early exit.

If you drive an iterator manually with `next()`, nobody calls `return()` for
you. Either call `await it.return()` yourself or stick to `for await`. To
cancel a generator that is stuck *inside* an `await` (a slow fetch, say),
`return()` is not enough: it only takes effect at the next `yield`. Pass an
`AbortSignal` in and hand it to `fetch`; see
[cancellation with AbortController](js-cancellation-abortcontroller.md).

## Collecting: `Array.fromAsync`

When you do want everything, `Array.fromAsync` (in Node 22+ and all
current browsers) is the async counterpart of `Array.from`. It accepts an
optional mapper:

```js
const all = await Array.fromAsync(allItems(), (x) => x.toUpperCase());
// [ 'A', 'B', 'C', 'D', 'E' ]
```

It awaits each value **in sequence**, not in parallel. It is not a
replacement for `Promise.all` on an array of independent promises; for that,
see [promise patterns](js-promise-patterns.md).

## Web streams: the three classes

Async iterators are a language feature. **Web streams** are a platform API
(WHATWG Streams) for flowing chunks of data with built-in backpressure. They
are what `fetch` gives you as `response.body`, and they exist identically in
browsers, Node 18+, Deno, Bun and edge runtimes.

| Class | Role | Key methods |
|-------|------|-------------|
| `ReadableStream` | A source of chunks | `getReader()`, `pipeThrough()`, `pipeTo()`, `tee()`, async iteration |
| `WritableStream` | A destination | `getWriter()`, `write()`, `close()` |
| `TransformStream` | A `{ writable, readable }` pair that changes chunks in between | `transform()`, `flush()` |

`pipeThrough(transform)` connects a readable to a transform's writable side and
returns its readable side, so calls chain. `pipeTo(writable)` ends the chain and
returns a promise that settles when the data has all been written (or failed).
Both accept `{ signal }` to abort the pipe.

## Backpressure: `pull` and `highWaterMark`

Backpressure means a fast producer slows down for a slow consumer instead of
buffering everything in memory. With web streams you get it by producing in
`pull()` rather than `start()`: the stream calls `pull` only when its internal
queue is below the `highWaterMark`.

```js
let n = 0;
const numbers = new ReadableStream(
  {
    pull(controller) {
      n += 1;
      console.log(`pull ${n}`);
      if (n > 3) controller.close();
      else controller.enqueue(n);
    },
  },
  { highWaterMark: 1 },
);

const doubled = numbers.pipeThrough(
  new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk * 2);
    },
  }),
);

for await (const value of doubled) console.log('got', value);
```

```text
pull 1
pull 2
got 2
pull 3
got 4
pull 4
got 6
```

The source runs a chunk or so ahead of the consumer to keep its small queue
full, and no further. If you had enqueued a million items in `start()`, they
would all sit in memory whether anybody read them or not. On the writable side,
`writer.desiredSize` tells you how much room is left, and `await writer.ready`
waits until there is some.

## Reading a fetch body incrementally

`response.body` is a `ReadableStream` of `Uint8Array` bytes. Two traps await
anyone who decodes it by hand:

1. **Chunk boundaries fall anywhere**, including in the middle of a line, a JSON
   value or a multi-byte UTF-8 character like `ü`.
2. Calling `new TextDecoder().decode(chunk)` on each chunk separately turns a
   split character into `�`.

`TextDecoderStream` handles the second problem (it keeps partial characters
between chunks). You handle the first with a line splitter that keeps the
unfinished tail in a buffer. This is the standard shape for NDJSON (one JSON
object per line), server logs and many streaming APIs:

```js
function splitLines() {
  let buffer = '';
  return new TransformStream({
    transform(chunk, controller) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop(); // last piece may be incomplete
      for (const line of lines) if (line.trim()) controller.enqueue(line);
    },
    flush(controller) {
      if (buffer.trim()) controller.enqueue(buffer);
    },
  });
}

const parseJson = () =>
  new TransformStream({
    transform(line, controller) {
      controller.enqueue(JSON.parse(line));
    },
  });

const response = await fetch('/api/export.ndjson');
const records = response.body
  .pipeThrough(new TextDecoderStream())
  .pipeThrough(splitLines())
  .pipeThrough(parseJson());

for await (const record of records) console.log(record);
```

Fed three records in chunks cut at byte 18 (mid-`ü`) and byte 35 (mid-key), it
prints `{ id: 1, city: 'Zürich' }`, `{ id: 2, city: 'Oslo' }` and
`{ id: 3, city: 'Kraków' }` intact. Forget `flush()` and the last record
disappears whenever the body does not end with a newline. The
[streaming log parser project](../../85-streaming-log-parser/) is this exact
problem at a larger scale.

Async iteration of a `ReadableStream` works in Node, Chrome and Firefox; if you
support older Safari, check first or use the reader directly:

```js
const reader = stream.getReader();
try {
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    handle(value);
  }
} finally {
  reader.releaseLock();
}
```

A stream is **locked** to one reader at a time. Calling `getReader()` twice, or
iterating a body you already passed to `response.json()`, throws.

## `tee()`: two consumers, one source

`tee()` splits a readable into two branches that each get every chunk. It is
how you cache a response while also rendering it, or log a stream while
parsing it:

```js
const [forLog, forCount] = source.tee();
const [logged, count] = await Promise.all([
  Array.fromAsync(forLog),
  Array.fromAsync(forCount).then((a) => a.length),
]);
// [ 'x', 'y' ] 2
```

The catch: the source runs at the pace of the *faster* branch, and chunks the
slower branch has not read yet are buffered for it. Tee a large download and
read only one branch, and the other branch quietly holds the whole file in
memory. Always consume both branches, or cancel the one you do not need.

## Generators or streams?

| Reach for | When |
|-----------|------|
| `async function*` | Your own data in your own code: paging, polling, batching database reads |
| Web streams | Bytes and platform APIs: `fetch` bodies, compression (`CompressionStream`), piping to a file or a response |
| Both | Convert with `ReadableStream.from(asyncIterable)` and `for await` over a stream |

`ReadableStream.from()` (Node 20.6+, current browsers) turns any async iterable
into a stream, which is handy when a framework wants a stream as a response
body but your data comes from a generator. Node also has its own older
`stream` module with `Readable` and `pipeline`; that belongs with the
[Node runtime guide](node-runtime-and-npm.md), and the two convert with
`Readable.toWeb()` and `Readable.fromWeb()`.

## What you should be able to answer

- What does `for await...of` call when you `break` out of it, and where should an async generator put its cleanup code?
- How would you expose a cursor-paginated API as a flat sequence of items, and why does it fetch only the pages you consume?
- Why can decoding each chunk of `response.body` separately corrupt text, and how do you split NDJSON correctly across chunk boundaries?
- How do `pull()` and `highWaterMark` give a `ReadableStream` backpressure, and what goes wrong if you enqueue everything in `start()`?
- What does `tee()` do, and how can it cause unbounded memory use?
- When would you use `Array.fromAsync` instead of `Promise.all`, and how do they differ?
