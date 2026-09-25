# Promise patterns you will actually use

`async`/`await` is syntax over promises, and every awkward bug in async code
(a silently swallowed error, a request fired three times, a page that loads in
2 seconds instead of 400 ms) comes down to not knowing what the promise
underneath is doing. Interviewers test this with the combinators, chaining
rules and "how would you avoid fetching this twice?".

## States and settling

A promise is in exactly one of three states:

| State | Meaning |
|---|---|
| **pending** | not finished yet |
| **fulfilled** | finished with a value |
| **rejected** | finished with a reason (an error, by convention) |

Fulfilled and rejected together are called **settled**. A promise settles at
most once; later calls to `resolve` or `reject` are ignored. "Resolved" is not
the same as "fulfilled": resolving a promise *with another promise* locks it to
follow that promise, which may still reject.

Callbacks you attach with `.then` always run asynchronously, as microtasks, even
if the promise is already settled. See
[The event loop, in depth](js-event-loop-in-depth.md) for why that matters.

## What `.then` returns

Every `.then`, `.catch` and `.finally` returns a **new** promise. What that new
promise does depends on what your callback does:

| Your callback... | The returned promise... |
|---|---|
| returns a plain value | fulfils with that value |
| returns a promise | follows it (fulfils or rejects with it) |
| returns nothing | fulfils with `undefined` |
| throws | rejects with the thrown error |

```js
const r = await Promise.resolve(1)
  .then((x) => x + 1)
  .then((x) => Promise.resolve(x * 10))  // flattened, not nested
  .then((x) => { console.log('got', x); })
  .then((x) => x);
console.log('final', r);
```

This prints `got 20` then `final undefined`. The block-bodied arrow forgot to
`return`, which is the most common chaining bug.

`.catch` is just `.then(undefined, onRejected)`, and recovering in it turns the
chain back into a success path:

```js
const s = await Promise.reject(new Error('boom'))
  .then(() => 'skipped')
  .catch((e) => `recovered from ${e.message}`)
  .then((v) => v.toUpperCase());
// 'RECOVERED FROM BOOM'
```

If you want the error to keep propagating after logging it, rethrow inside
`.catch`. `.finally` receives no argument and passes the original outcome
through unchanged, unless it throws.

## The four combinators

All four take an iterable of promises (or values) and return one promise.

| Combinator | Fulfils when | Rejects when | Empty input |
|---|---|---|---|
| `Promise.all` | **all** fulfil, with an array of values in input order | the **first** rejection | fulfils with `[]` |
| `Promise.allSettled` | all settle, with `{ status, value \| reason }` objects | never | fulfils with `[]` |
| `Promise.any` | the **first** fulfilment | all reject, with an `AggregateError` | rejects with an `AggregateError` |
| `Promise.race` | the first to settle, if it fulfilled | the first to settle, if it rejected | stays pending forever |

When to reach for each:

- **`all`**: you need every result and one failure makes the whole thing
  useless (load a user *and* their permissions).
- **`allSettled`**: independent work where partial success is fine (send 50
  notifications, report which failed).
- **`any`**: redundant sources, first success wins (try two mirrors).
- **`race`**: "whichever happens first", classically a timeout. For fetch, prefer
  `AbortSignal.timeout`, which actually cancels the request; see
  [Cancellation with AbortController](js-cancellation-abortcontroller.md).

The crucial detail about `all` and `race`: **the losers keep running**. When
`Promise.all` rejects because one request failed, the others are still in
flight and their results are thrown away. Promises are not cancellable; if you
need that, pass an `AbortSignal`.

`AggregateError` is what `any` rejects with. It is an `Error` with an `errors`
array holding each rejection reason, in input order:

```js
try {
  await Promise.any([fail('x'), fail('y')]);
} catch (e) {
  console.log(e.constructor.name, e.errors.map((x) => x.message));
  // AggregateError [ 'x', 'y' ]
}
```

## `Promise.withResolvers` and `Promise.try`

Both are in every current browser and in Node 24.

**`Promise.withResolvers()`** returns `{ promise, resolve, reject }`. It replaces
the old pattern of hoisting `let resolve` out of the executor, and is useful
when the code that settles the promise lives somewhere else, such as an event
listener or a queue:

```js
function once(target, event) {
  const { promise, resolve } = Promise.withResolvers();
  target.addEventListener(event, resolve, { once: true });
  return promise;
}
```

**`Promise.try(fn, ...args)`** calls `fn` straight away and always gives you a
promise, whether `fn` returns a value, returns a promise, or **throws
synchronously**. That last case is the point: a function that is "usually
async" but throws on bad input before it gets to any `await` would otherwise
escape your `.catch`:

```js
function mightThrow(x) { if (x < 0) throw new Error('negative'); return x * 2; }

Promise.try(mightThrow, -1).catch((e) => console.log('caught', e.message));
Promise.try(mightThrow, 4).then((v) => console.log('value', v));
```

An `async` function gives you the same guarantee for its own body, since a
throw inside it becomes a rejection. `Promise.try` is for wrapping code you do
not control.

## Promisifying callbacks

Older Node APIs and many libraries use error-first callbacks. Wrap them once:

```js
function readFileAsync(path) {
  return new Promise((resolve, reject) => {
    readFile(path, 'utf8', (err, data) => (err ? reject(err) : resolve(data)));
  });
}
```

In Node, `util.promisify(readFile)` does the same for any error-first function,
and most core modules already ship promise versions (`node:fs/promises`,
`node:timers/promises`). Two rules for hand-written wrappers: settle exactly
once, and make sure every code path settles. A wrapper that forgets to call
`reject` on one branch hangs its caller for ever.

## Sharing an in-flight promise

Three components mount at once and each asks for the same user. Without care,
that is three identical requests. Store the **promise**, not the result, so
callers who arrive while the request is in flight share it:

```js
const inFlight = new Map();

function getUser(id) {
  let p = inFlight.get(id);
  if (!p) {
    p = fetchUser(id).catch((err) => {
      inFlight.delete(id);   // evict failures so the next caller retries
      throw err;
    });
    inFlight.set(id, p);
  }
  return p;
}
```

Run with three concurrent `getUser('1')` calls, `fetchUser` is called once and
all three get the same object. The eviction matters: without it, one network
blip caches a rejected promise and every future caller fails instantly until the
page reloads. Rethrowing inside `.catch` keeps the rejection visible to the
callers who were waiting.

Decide what "done" means. Keep the entry and this is a permanent cache; delete
it in a `.finally` and it is pure request deduplication. A real cache also needs
expiry and a size limit, which is why in React you would normally let TanStack
Query do this; see [Server and client state](server-and-client-state.md).

## Sequential vs parallel

```js
// sequential: ~200 ms
const user = await getUser(id);
const orders = await getOrders(id);

// parallel: ~100 ms
const [user, orders] = await Promise.all([getUser(id), getOrders(id)]);
```

Measured with two 100 ms waits in Node 24: 200 ms sequential, 100 ms parallel.
Start independent work together; await in sequence only when the second call
needs the first result. Parallel has a limit, though: firing 10,000 requests at
once with `Promise.all` is its own bug. That is covered in
[Concurrency limiting](js-concurrency-limiting.md).

## Practise it

- [Build your own promise](../../57-my-promise/): implement `then`, chaining and
  the combinators yourself. Nothing else makes the table above stick as well.
- [Promise pool](../../42-promise-pool/) and
  [Paginated API](../../44-paginated-api/) put sequential and parallel to work.
- [Fetch race in React](../../react/19-fetch-race/) shows what happens when an
  older promise settles after a newer one.

## What you should be able to answer

- What does `.then` return, and what happens if your callback returns a value,
  returns a promise, or throws?
- Compare `Promise.all`, `allSettled`, `any` and `race`: when does each settle,
  and what happens to the other promises when one rejects?
- What is an `AggregateError`, and which combinator produces it?
- What problem do `Promise.withResolvers` and `Promise.try` each solve?
- How would you stop three components fetching the same resource three times,
  and what goes wrong if you cache a rejected promise?
- When are sequential `await`s correct, and when are they a performance bug?
