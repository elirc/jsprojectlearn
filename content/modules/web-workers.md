# Web workers without the folklore

JavaScript in a page runs on one main thread, and that thread also handles
clicks, typing and rendering. Workers are how you move heavy computation off
it. Interviewers ask about them to see whether you understand what `async`
does *not* fix, and whether you know the costs of the fix.

## Why: long tasks and INP

`async`/`await` interleaves *waiting*. It does nothing for *computing*. Parsing
a 40 MB CSV, resizing an image or diffing two large documents inside an
`async` function still occupies the main thread from start to finish, and
while it runs the page cannot respond to input.

The browser calls any main-thread task over 50 ms a **long task**. The Core Web
Vital that punishes them is **INP** (Interaction to Next Paint), which replaced
FID in 2024: it measures how long the page takes to paint after a click, tap or
key press, and "good" is 200 ms or less. One 400 ms parse that happens to
coincide with a click fails INP on its own. For how the event loop schedules
tasks and rendering, see [the event loop in depth](js-event-loop-in-depth.md);
for the rendering side, see
[browser rendering and the network](browser-rendering-and-network.md).

A worker is a separate thread with its own event loop and its own global scope.
Work there cannot block the main thread, because the main thread is not running
it.

## The three kinds of worker

| Kind | Created with | Shared between | Typical job |
|------|--------------|----------------|-------------|
| Dedicated | `new Worker(url)` | One page | CPU work for that page: parsing, crypto, image processing |
| Shared | `new SharedWorker(url)` | All same-origin tabs | One WebSocket or cache shared across tabs |
| Service | `navigator.serviceWorker.register(url)` | The whole origin, even with no tab open | Network proxy: offline caching, push notifications |

A **service worker** is a different tool that happens to share the name. It
sits between your pages and the network, intercepting `fetch` events, and the
browser starts and stops it at will. Use it for offline support and caching
strategies, not for computation. **Shared workers** are niche and mobile
support has been patchy, so check your targets before relying on one. The rest
of this guide is about dedicated workers.

A worker has no DOM: no `document`, no `window`, and it cannot touch elements.
It does have `fetch`, `setTimeout`, `WebSocket`, IndexedDB, `crypto` and
`OffscreenCanvas`.

## Module workers

Create workers as ES modules so they can use `import` like the rest of your
code:

```js
// main.js
const worker = new Worker(new URL('./parse.worker.js', import.meta.url), {
  type: 'module',
});
```

The `new URL('./x.js', import.meta.url)` form matters. It resolves the path
relative to *this* module rather than the page, and Vite and webpack recognise
it and bundle the worker file as a separate chunk. A bare string path usually
breaks once the app is built. Module workers are supported in all current
browsers. See [ES modules in depth](es-modules-in-depth.md) for
`import.meta.url`.

## `postMessage` and structured clone

The main thread and a worker share no memory by default. They communicate with
`postMessage(data)` and a `message` event, and `data` is copied with the
**structured clone algorithm**. `structuredClone()` runs the same algorithm, so
you can check what survives without a worker:

```js
class Money {
  constructor(c) { this.cents = c; }
  format() { return `£${(this.cents / 100).toFixed(2)}`; }
}
const copy = structuredClone({
  when: new Date(0), tags: new Set(['a']), price: new Money(1999),
  big: 10n, re: /x/g, err: new RangeError('bad'),
});
copy.when instanceof Date;    // true
copy.tags instanceof Set;     // true
copy.err instanceof RangeError; // true
copy.price;                   // { cents: 1999 } (a plain object)
copy.price instanceof Money;  // false
typeof copy.price.format;     // 'undefined'

structuredClone({ onDone() {} });
// DataCloneError: onDone() {} could not be cloned.
```

| Survives | Does not |
|----------|----------|
| Primitives including `BigInt`; plain objects and arrays | Functions (throws `DataCloneError`) |
| `Date`, `RegExp`, `Map`, `Set`, `Error` types | Class prototypes (instances arrive as plain objects) |
| `ArrayBuffer`, typed arrays, `Blob`, `File` | DOM nodes (throws) |
| Cycles and shared references | Getters and setters (only the current value is copied) |

So send **data, not behaviour**. If the worker needs a `Money`, send
`{ cents }` and rebuild the instance on the other side.

## Transferables: move instead of copy

Copying is not free, and the copy is made on the *sending* thread. Posting a
100 MB `ArrayBuffer` clones 100 MB on the main thread, which is the very thing
you were trying to avoid. Pass it in the transfer list and ownership moves in
effectively constant time:

```js
worker.postMessage({ type: 'parse', payload: buffer }, [buffer]);
buffer.byteLength; // 0: the buffer is now detached on this side
```

The same with `structuredClone(buf, { transfer: [buf] })` on an 8 MB buffer
leaves the original at `byteLength` 0 and the copy at 8,000,000. Transferable
types include `ArrayBuffer`, `MessagePort`, `ImageBitmap`, `OffscreenCanvas`
and, in most browsers, the web stream classes. `SharedArrayBuffer` goes further and shares memory
between threads, but it requires cross-origin isolation headers (COOP and COEP)
and `Atomics`; you rarely need it for CRUD work.

## A promise-based request/response wrapper

Raw `postMessage` is fire-and-forget. If you send three requests, the replies
come back as three anonymous `message` events. The standard fix is to tag each
request with an id and keep a map of pending promises:

```js
// worker.js
const handlers = {
  sum: (nums) => nums.reduce((a, b) => a + b, 0),
};
self.onmessage = async ({ data: { id, type, payload } }) => {
  try {
    const result = await handlers[type](payload);
    self.postMessage({ id, ok: true, result });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message });
  }
};
```

```js
// main.js
function createClient(worker) {
  let nextId = 0;
  const pending = new Map();
  worker.onmessage = ({ data: { id, ok, result, error } }) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    ok ? p.resolve(result) : p.reject(new Error(error));
  };
  return {
    call(type, payload, transfer = []) {
      const id = nextId++;
      const { promise, resolve, reject } = Promise.withResolvers();
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, type, payload }, transfer);
      return promise;
    },
  };
}

const client = createClient(worker);
await Promise.all([client.call('sum', [1, 2, 3]), client.call('sum', [10, 20])]);
// [6, 30]
```

Replies can arrive in any order and still reach the right caller. Errors are
caught in the worker and sent back as data, so the caller gets an ordinary
rejected promise. Libraries such as Comlink generate this layer for you with a
proxy; knowing how to write it is what the interviewer is after.

## Worker pools

One worker runs one task at a time. For many independent jobs (thumbnailing
fifty uploads, say) use a **pool**: a fixed number of workers, a queue of
tasks, and a dispatcher that hands the next task to whichever worker is idle.

- Size it to the hardware: `navigator.hardwareConcurrency - 1` leaves a core
  for the main thread. Spawning a worker per task costs startup time and memory
  for each one.
- Bound the queue, or a burst of work becomes a burst of memory.
- If results must come back in submission order, store each result at its
  task's index rather than pushing in completion order.

This is the same shape as [concurrency limiting](js-concurrency-limiting.md),
with threads instead of requests. The
[worker pool project](../../84-worker-pool/) builds one with Node's
`worker_threads`.

## Termination and errors

- `worker.terminate()` stops the worker immediately, mid-task, with no cleanup.
  Any promises still in your pending map will never settle, so reject them all
  when you terminate. Terminate workers you no longer need; each one holds
  memory.
- An uncaught exception inside the worker fires an `error` event on the
  `Worker` object in the main thread. Call `event.preventDefault()` to stop it
  being logged as uncaught. The worker keeps running.
- A message that cannot be deserialised fires `messageerror`, not `error`.
- To cancel one task without killing the worker, send a `{ type: 'cancel', id }`
  message and have the worker check a flag between chunks of work. It cannot
  interrupt a synchronous loop that never yields.

## When not to use a worker

- **The work is I/O.** A `fetch` already runs off the main thread; putting it in
  a worker adds a hop and gains nothing.
- **The work is small.** Posting a message and cloning data costs something. A
  5 ms task is cheaper done inline.
- **The data is huge and not transferable.** Cloning a deep 50 MB object graph
  on the main thread can cost as much as the work you offloaded.
- **The work needs the DOM.** Layout and measurement cannot move to a worker.
- **Breaking it up is enough.** Splitting a loop into chunks and yielding with
  `await scheduler.yield()` (Chromium and Firefox; feature-detect it) or
  `setTimeout` lets input through without the complexity of a second thread.

## Node: `worker_threads`, in one paragraph

Node has the same idea in the `worker_threads` module: `new Worker(file)`,
`postMessage`, structured clone, transfer lists and `terminate()` all behave
much as they do in the browser, with `parentPort` in place of `self`. You reach
for it in exactly the same situation, CPU-bound work blocking an event loop
that should be serving requests, and the same "not for I/O" rule applies. The
[Node runtime guide](node-runtime-and-npm.md) covers the event loop it protects.

## What you should be able to answer

- Why does wrapping a slow CPU-bound function in `async` not stop it freezing the page, and which Core Web Vital suffers?
- What is the difference between a dedicated worker, a shared worker and a service worker?
- What survives `postMessage` between threads, and what happens to a class instance or a function?
- What is a transferable, and why does it matter for a 100 MB `ArrayBuffer`?
- How would you turn `postMessage` into a promise-based `call()` API that copes with out-of-order replies and errors?
- When would you decide a worker is not worth it, and what would you do instead?
