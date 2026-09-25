# The event loop, in depth

"What does this print?" with a `setTimeout`, a promise and an `await` is one of
the most common JavaScript interview questions at every level. The trick is not
to memorise orderings but to hold one small model in your head: a single call
stack, a queue of tasks, a queue of microtasks that always drains first. With
that model you can also explain frozen UIs, starved timers and why you should
chunk long work.

## One thread, one call stack

Your JavaScript runs on one thread. Each function call pushes a frame onto the
**call stack**; returning pops it. While the stack is not empty, nothing else in
your program runs: no click handler, no timer callback, no promise callback.

That is **run-to-completion**: once a piece of JavaScript starts, it runs until
the stack is empty. Nothing can interrupt it half-way through a function. This
is why you never need a lock around `count++` in single-threaded JavaScript, and
also why one slow function freezes everything.

Asynchronous APIs (`setTimeout`, `fetch`, file reads) are not JavaScript
running "in the background". The host (the browser or Node) does the waiting
elsewhere and, when the result is ready, queues a callback. The event loop only
picks up that callback once the stack is empty.

## Tasks and microtasks

There are two kinds of queued work you need to distinguish:

| | Tasks (macrotasks) | Microtasks |
|---|---|---|
| Queued by | `setTimeout`, `setInterval`, I/O callbacks, UI events, `MessageChannel` | promise reactions (`.then`, code after `await`), `queueMicrotask`, `MutationObserver` |
| How many per turn | **one** | **all of them**, including ones queued while draining |
| When | when the loop picks the next task | immediately after the current task (or callback) empties the stack |

The loop, simplified:

1. Take one task from a task queue and run it to completion.
2. Drain the microtask queue completely, including microtasks added during the drain.
3. In a browser, maybe render (see below).
4. Repeat.

The whole script itself is the first task. So:

```js
console.log('1 sync start');
setTimeout(() => console.log('2 timeout'), 0);
Promise.resolve().then(() => console.log('3 microtask'));
queueMicrotask(() => console.log('4 queueMicrotask'));
console.log('5 sync end');
```

prints `1 sync start`, `5 sync end`, `3 microtask`, `4 queueMicrotask`,
`2 timeout`. Synchronous code first, then every microtask in queue order, then
the next task. `setTimeout(fn, 0)` means "no sooner than the next task", never
"now".

## Walkthrough: `await` is a microtask boundary

```js
async function a() {
  console.log('a start');
  await null;
  console.log('a after await');
}
console.log('script start');
setTimeout(() => console.log('timeout'), 0);
a();
Promise.resolve()
  .then(() => console.log('then 1'))
  .then(() => console.log('then 2'));
console.log('script end');
```

Output in Node 24:

```txt
script start
a start
script end
a after await
then 1
then 2
timeout
```

Reason it through out loud, which is what the interviewer wants:

- An `async` function runs **synchronously until its first `await`**. So
  `a start` prints straight after `script start`.
- `await null` suspends `a` and queues its continuation as a microtask.
- `then 1` is queued as a microtask; `then 2` is not queued yet, because it
  waits on the promise that `then 1` returns.
- `script end` finishes the first task. The microtask queue now holds `a`'s
  continuation, then `then 1`. Running `then 1` queues `then 2`, which runs in
  the same drain.
- Only then does the timer task get a turn.

A second classic, testing that microtasks queued during a drain join the back
of the queue:

```js
const p = Promise.resolve();
p.then(() => { console.log('A'); Promise.resolve().then(() => console.log('C')); })
 .then(() => console.log('D'));
p.then(() => console.log('B'));
```

This prints `A B C D`. Both handlers on `p` were queued up front (`A`, `B`).
Running `A` queues `C` and resolves the promise that `D` is waiting on, which
queues `D` after `C`.

Do not build logic on the exact interleaving of microtasks from different
promise chains. Know it for interviews; in real code, if order matters, chain it
or `await` it.

## Rendering in the browser, briefly

A browser *may* render between tasks, typically once per display frame (about
every 16.7 ms at 60 Hz). Rendering never happens while the stack is busy or
while microtasks are draining. Two consequences:

- If you set `el.textContent = 'Loading...'`, then do 2 seconds of synchronous
  work, the user never sees "Loading...". The render step never got a turn.
- `requestAnimationFrame` callbacks run just before the next paint, which is
  why they are the right place for visual updates.

The full pipeline (style, layout, paint, composite) is covered in
[Browser rendering and the network](browser-rendering-and-network.md).

## Node's loop, briefly

Node uses libuv, which splits the loop into **phases**: timers
(`setTimeout`/`setInterval`), pending callbacks, poll (I/O), check
(`setImmediate`), and close callbacks. Microtasks drain between each callback,
as in the browser.

Node adds `process.nextTick`, which has its own queue that runs **before**
promise microtasks when Node drains its queues:

```js
// order.cjs
setTimeout(() => console.log('timeout'), 0);
setImmediate(() => console.log('immediate'));
Promise.resolve().then(() => console.log('promise'));
process.nextTick(() => console.log('nextTick'));
console.log('sync');
```

`node order.cjs` prints `sync`, `nextTick`, `promise`, `timeout`,
`immediate`. Two honest caveats that make a strong answer:

- Run the same code as an ES module (`order.mjs`) and you get `sync`, `promise`,
  `nextTick`. Module evaluation is itself driven by promises, so the promise
  queue is already being drained when your code finishes.
- `timeout` vs `immediate` from the main module is **not guaranteed**; it
  depends on how long the loop took to start. Inside an I/O callback,
  `setImmediate` always wins, because the check phase comes straight after
  poll.

Prefer `queueMicrotask` or `setImmediate` in new code; `nextTick` is mostly for
library authors who must fire an event before any other async work. Deeper Node
runtime detail lives in [Node runtime and npm](node-runtime-and-npm.md).

## Starving the loop

Two ways to stop everything else running.

**A long synchronous task.** A timer cannot fire while the stack is busy:

```js
const start = Date.now();
setTimeout(() => console.log(`timer fired after ${Date.now() - start} ms`), 10);
while (Date.now() - start < 200) {} // busy for 200 ms
console.log('loop done');
```

This prints `loop done` and then something like `timer fired after 212 ms`. The
delay you pass is a minimum. In a server, the same busy loop blocks *every*
request in the process; in a browser, it blocks input and painting.

**An endless microtask chain.** Because the microtask queue drains completely
before the next task, a microtask that keeps queueing microtasks starves
timers, I/O and rendering:

```js
setTimeout(() => console.log('timeout never runs'), 0);
let n = 0;
function spin() { if (++n < 1e6) queueMicrotask(spin); else console.log('microtasks done', n); }
spin();
```

The timeout only runs after all million microtasks. Make that recursion
unbounded and the timeout never runs at all. This is why a recursive `async`
function that never truly waits on I/O can freeze a page just like a `while`
loop.

## Chunking long work, and `scheduler.yield()`

The fix for a long task is to split it and give the loop a turn between chunks.
A microtask does *not* give it a turn; you need a new task.

```js
function yieldToLoop() {
  if (globalThis.scheduler?.yield) return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function processAll(items, handle) {
  let deadline = performance.now() + 50;
  for (const item of items) {
    handle(item);
    if (performance.now() > deadline) {
      await yieldToLoop();              // let clicks, rendering and timers run
      deadline = performance.now() + 50;
    }
  }
}
```

Running this over three million items in Node with a 20 ms `setInterval`
alongside, the interval kept firing throughout. Without the yield it would not
fire once until the loop finished.

`scheduler.yield()` is the modern browser API for this. Unlike
`setTimeout(0)`, the continuation is scheduled ahead of other queued tasks, so
your work resumes promptly instead of going to the back of the queue, and it
avoids the 4 ms clamp browsers apply to nested timers. It is not in every
browser yet and not in Node, so feature-detect as above. The 50 ms budget
matches the "long task" threshold that Interaction to Next Paint (INP) punishes.

When the work is genuinely CPU-heavy (parsing a huge file, image processing),
chunking only spreads the cost. Move it off the main thread instead: see
[Web Workers](web-workers.md), or the [worker pool project](../../84-worker-pool/).

## Practise it

- [Build your own promise](../../57-my-promise/) forces you to schedule `then`
  callbacks as microtasks yourself.
- [Async event emitter](../../56-async-emitter/) makes you decide whether
  listeners run synchronously or on a later tick.
- [Promise patterns](js-promise-patterns.md) and
  [async/await pitfalls](js-async-await-pitfalls.md) build on this model.

## What you should be able to answer

- What is the difference between a task and a microtask, and in what order does
  the loop process them?
- Walk through what a snippet mixing `setTimeout(0)`, `Promise.then` and
  `await` prints, and why.
- Why does code after `await` run later even if the awaited value is not a
  promise?
- In Node, how do `process.nextTick`, promise callbacks and `setImmediate`
  differ in when they run?
- How can a program with no `while` loop still freeze the UI, and how would you
  fix a 2-second synchronous task on the main thread?
- What does `scheduler.yield()` give you that `setTimeout(fn, 0)` does not?
