# Concurrency limiting

"We need to call the API for each of these 20,000 rows" is a normal Tuesday
task, and both obvious answers are wrong: a `for` loop with `await` takes hours,
and `Promise.all(rows.map(...))` falls over. The middle ground (a bounded
number of operations in flight at once) is a classic mid-level interview
exercise, often phrased as "implement `p-limit`" or "write a promise pool".

## Concurrency is not parallelism

**Concurrency** means several operations are *in progress* at once.
**Parallelism** means several things *execute* at the same instant on
different CPU cores. Single-threaded JavaScript gives you plenty of the first
and none of the second: while 50 HTTP requests wait on the network, your one
thread handles whichever response arrives next.

That is why concurrency limiting in JavaScript is about **I/O**: requests,
database queries, file reads. It does nothing for CPU-bound work, which still
runs one piece at a time on the main thread. For that, use
[Web Workers](web-workers.md) or worker threads (see the
[worker pool project](../../84-worker-pool/)).

## Why `Promise.all` over 20,000 items fails

```js
await Promise.all(rows.map((row) => fetch(`/api/items/${row.id}`)));
```

`map` starts every request immediately. `Promise.all` only waits; it does not
schedule anything. So you have 20,000 requests in flight at once, and:

- the **remote API** rate limits you (429s) or falls over, and you have in
  effect attacked a partner's service;
- your **process** runs out of sockets or file descriptors, or memory for
  20,000 pending responses;
- a **database** pool of 10 connections queues 19,990 queries, and they start
  timing out;
- the first rejection makes `Promise.all` reject, while the other 19,999
  requests **keep running** with nobody listening.

The fix is to decide a number, say 5 or 10, and never have more than that in
flight.

## Chunking vs a worker pool

The quick fix is chunking: process in batches, waiting for each batch to
finish.

```js
for (let i = 0; i < items.length; i += 4) {
  await Promise.all(items.slice(i, i + 4).map(work));
}
```

It works, but each batch is as slow as its slowest item. While one slow request
drags on, the other three slots sit idle.

A **pool** keeps every slot busy: start N "lanes", and each lane pulls the next
item as soon as it finishes the previous one.

```js
async function pool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function lane() {
    while (next < items.length) {
      const i = next++;                 // safe: no await between read and increment
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
  return results;
}
```

With eight items taking `[50, 10, 10, 10, 50, 10, 10, 10]` ms and a limit of
four, chunking needs about 100 ms (two batches, each held up by a 50 ms item)
and the pool about 60 ms. Measured in Node 24 on Windows, with its coarse timer
resolution, it was 143 ms against 97 ms. Results stay in input order because
each lane writes to `results[i]`.

Note the comment on `next++`. Because of run-to-completion (see
[The event loop, in depth](js-event-loop-in-depth.md)), nothing can run between
reading `next` and incrementing it, so two lanes never take the same item. No
lock needed.

## Writing a small limiter

A pool works when you have the whole list up front. When calls arrive over time
from different places (route handlers, event listeners), you want a limiter
that wraps each call instead, which is what the `p-limit` package does:

```js
function limit(concurrency) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= concurrency || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.try(fn).then(resolve, reject).finally(() => {
      active--;
      next();
    });
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}

const run = limit(5);
const results = await Promise.all(ids.map((id) => run(() => fetchItem(id))));
```

Over 200 ids, a counter inside `fetchItem` never saw more than 5 running at
once. The key design points to mention:

- The caller passes a **function**, not a promise. A promise has already
  started; only a function lets the limiter decide *when* it starts.
- `Promise.try` means a function that throws synchronously still rejects its
  own promise instead of wedging a slot.
- `finally` frees the slot on success **and** failure. Forget the failure path
  and after five errors the limiter deadlocks.
- `queue.shift()` is O(n). Fine for thousands of items; for very large queues
  use a proper queue.

The [Promise pool project](../../42-promise-pool/) has you build and test both
the pool and the limiter.

## Per-key serialisation

Sometimes the limit is not "5 in total" but "**1 at a time per id**": two
withdrawals from the same account, two saves of the same document. Run them
concurrently and you get a lost update:

```js
async function withdraw(id, amount) {
  const current = balances[id];
  await db.roundTrip();                      // anything async here
  if (current < amount) throw new Error('insufficient funds');
  balances[id] = current - amount;
}
```

Two concurrent withdrawals of 70 from 100 both read 100, both pass the check,
and the balance ends at 30 with 140 paid out. Chain operations per key so each
waits for the previous one:

```js
const tails = new Map();

function serialise(key, fn) {
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);            // run after the previous one, even if it failed
  const tail = run.catch(() => {});         // keep the chain alive after a failure
  tails.set(key, tail);
  tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
  return run;
}
```

Serialised, the second withdrawal sees 30 and correctly fails with
`insufficient funds`, and the map empties itself afterwards so it does not
grow for ever. Different keys still run concurrently.

Be honest about the limits in an interview: this is an **in-process** mutex. It
does nothing across two server instances. For data in a database, the real fix
is in the database: a conditional `UPDATE ... WHERE balance >= 70`, a row
version, or a transaction (see
[SQL fundamentals](sql-fundamentals.md)).

## Rate limits are not concurrency limits

| | Concurrency limit | Rate limit |
|---|---|---|
| Caps | how many are **in flight** at once | how many **start** per time window |
| Example | "max 5 open requests" | "max 100 requests per minute" |
| Symptom when exceeded | exhausted sockets, pool timeouts | 429 with `Retry-After` |

A concurrency limit of 5 against an API that answers in 20 ms is still 250
requests per second, which will blow through "100 per minute". When an API
documents a rate limit, you need a rate limiter (a token bucket is the usual
choice, as in the [Rate limiter project](../../76-rate-limiter/)), often
combined with a concurrency limit, and retries that honour `Retry-After` (see
[Retries, timeouts and backoff](js-retries-timeouts-backoff.md)).

## Error policy: fail fast or collect

Decide up front what one failure means for the batch.

- **Fail fast**: one failure aborts the whole job. The pool above does this,
  because `Promise.all` rejects on the first error. The catch: the other lanes
  keep running, so stop them too. Pass an `AbortSignal` into `worker` and
  abort it on the first error, and check it before taking the next item.
- **Collect**: process everything, then report. Catch inside the worker and
  store `{ ok: false, error }` per item, the same shape as
  `Promise.allSettled`. This suits imports and notifications, where 19,990
  successes should not be thrown away because of 10 bad rows. Retry transient
  failures inside the worker rather than rerunning the whole batch.

Either way, log *which* items failed. "Import failed" with no id is useless at
3am.

## Async iteration, and the `Array.fromAsync` caveat

When the items themselves arrive asynchronously (pages from an API, lines from
a file), `for await...of` processes them one at a time, which is often exactly
the backpressure you want. `Array.fromAsync` collects an async iterable into an
array:

```js
const all = await Array.fromAsync(pages()); // pages() is an async generator
```

It is **sequential**: it awaits each value before asking for the next. It is not
a concurrent `Promise.all`. And passing it an array of already-started promises
has a trap. Checked in Node 24:

```js
await Array.fromAsync([wait(100, 'slow'), wait(10, 'fast fail', true)]);
```

The second promise rejects while `Array.fromAsync` is still awaiting the first,
so no handler is attached yet. The process crashes with an unhandled rejection
even though the call is inside `try`/`catch`. Use `Promise.all` for promises
you already have; keep `Array.fromAsync` for genuine async iterables. More on
async iteration in [Async iteration and streams](js-async-iteration-streams.md),
and in the [Paginated API](../../44-paginated-api/) and
[Streaming log parser](../../85-streaming-log-parser/) projects.

## What you should be able to answer

- What is the difference between concurrency and parallelism in JavaScript?
- What goes wrong with `Promise.all(items.map(fetch))` over 20,000 items?
- Why is a worker pool faster than processing in fixed-size chunks?
- Implement a `limit(n)` function; why does it take functions rather than
  promises, and what happens if you forget to free the slot on failure?
- How would you make sure two updates to the same record never run at the same
  time, and why is an in-process lock not enough across servers?
- How is a rate limit different from a concurrency limit?
