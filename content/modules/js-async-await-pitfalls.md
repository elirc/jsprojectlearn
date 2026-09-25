# async/await pitfalls

`async`/`await` makes asynchronous code read like synchronous code, which is
exactly why its bugs are hard to spot: the code *looks* right. Mid-level
interviews lean on this with "what is wrong with this function?" questions, and
the same handful of mistakes cause most real production incidents in Node
services: lost errors, crashed processes, and endpoints that are slow for no
visible reason.

## The forgotten `await`

Calling an `async` function without `await` gives you a promise, not the value:

```js
const fetchUser = async () => ({ role: 'guest' });

if (fetchUser()) console.log('truthy: a promise is an object');
const user = fetchUser();
console.log(user.role); // undefined
```

The `if` is always true, because a promise is an object. `user.role` is
`undefined`, and nothing throws. In TypeScript you get some help (`user.role`
fails to compile), but the conditional compiles happily. That gap is what the
lint rules at the end of this guide close.

A forgotten `await` on a function whose return value you ignore is worse: any
error it throws is detached from your `try`/`catch`. See "floating promises"
below.

## Accidentally sequential

```js
const user = await getUser(id);
const orders = await getOrders(id);      // does not need `user`
const prefs = await getPreferences(id);  // nor this
```

Each call waits for the previous one to finish. Three 100 ms calls take 300 ms.
If they are independent, start them together:

```js
const [user, orders, prefs] = await Promise.all([
  getUser(id), getOrders(id), getPreferences(id),
]);
```

This is the most common performance bug in async code, and a quick win to
mention in a code review. The reverse mistake also exists: firing a
`Promise.all` over thousands of items, covered in
[Concurrency limiting](js-concurrency-limiting.md).

## `forEach` does not wait

```js
const save = (x) => new Promise((r) => setTimeout(() => { console.log('saved', x); r(); }, 10));

[1, 2, 3].forEach(async (x) => { await save(x); });
console.log('all saved?');
```

This prints `all saved?` *first*, then `saved 1`, `saved 2`, `saved 3`.
`forEach` calls your callback, receives a promise, and throws it away. It never
awaits anything, and a rejection inside the callback becomes an unhandled
rejection. `map`, `filter`, `some` and `reduce` have the same problem.

Pick the loop that says what you mean:

```js
// one at a time, in order
for (const x of items) await save(x);

// all at once, wait for all
await Promise.all(items.map((x) => save(x)));
```

`filter` with an async predicate is a special trap: every promise is truthy, so
nothing is filtered out. Resolve the booleans first with `Promise.all`, then
filter.

## `return` vs `return await` inside `try`

```js
const load = async () => { throw new Error('db down'); };

async function withoutAwait() {
  try { return load(); } catch { return 'fallback'; }
}
async function withAwait() {
  try { return await load(); } catch { return 'fallback'; }
}
```

`withAwait()` resolves to `'fallback'`. `withoutAwait()` rejects with
`db down`: the `try` block returned the promise *before* it rejected, so the
`catch` was never in play. The same applies to `finally` blocks that release a
resource. They run as soon as the promise is returned, not when the work
finishes.

The rule: **inside `try`/`catch`/`finally`, always `return await`**. Outside
one, `return promise` and `return await promise` behave the same, and the old
advice that `return await` is "redundant and slower" is out of date. Modern
engines optimise it and it gives you better async stack traces. The
typescript-eslint rule `return-await` with its default `in-try-catch` setting
enforces exactly this.

## Floating promises and unhandled rejections

A **floating promise** is one nobody awaits, returns or attaches a `.catch` to.
If it rejects, nobody hears about it:

```js
async function sendEmail() { throw new Error('SMTP refused'); }
sendEmail();                     // floating: nobody awaits or catches it
setTimeout(() => console.log('still running?'), 100);
```

In Node 24, this process **crashes** with the `SMTP refused` stack trace and
exit code 1. `still running?` never prints. Since Node 15 the default
`--unhandled-rejections` mode is `throw`: an unhandled rejection is raised as
an uncaught exception. In a web server that means one forgotten `.catch` on a
fire-and-forget call can take down every in-flight request. Browsers only log
it to the console, which is how these bugs survive until the code runs on a
server.

What to do:

- Await it, or return it, so the caller handles the error.
- If you genuinely want fire-and-forget, make it explicit:
  `void sendEmail().catch((err) => logger.error(err))`.
- Keep a `process.on('unhandledRejection', ...)` handler for logging, then exit
  and let your process manager restart you. Do not use it to keep running as if
  nothing happened; your state may be inconsistent.

Anything that really must happen reliably after a response (sending that email)
belongs in a job queue, not a floating promise. See
[Background jobs and queues](background-jobs-and-queues.md).

## Async constructors do not exist

A constructor cannot be `async` and cannot usefully `await`. Returning a
half-initialised object and a separate `init()` promise is a bug magnet: callers
forget to await `init()`. Use a static async factory and keep the constructor
private in spirit:

```js
class Db {
  #conn;
  constructor(conn) { this.#conn = conn; }
  static async connect(url) {
    const conn = await openConnection(url);
    return new Db(conn);
  }
}

const db = await Db.connect('postgres://...');
```

The object only exists once it is ready. In TypeScript you can mark the
constructor `private` so `new Db()` from outside fails to compile.

## `try`/`finally` for cleanup

`finally` runs whether the awaited work fulfils or rejects, so it is where
cleanup belongs: releasing a lock, closing a file handle, turning off a loading
spinner.

```js
async function work() {
  lock = true;
  try {
    await doTheWork();
    return 'ok';
  } finally {
    lock = false; // runs on success and on failure
  }
}
```

Two cautions. Do not `return` from a `finally` block: it overrides the thrown
error and silently swallows it. And a `finally` cannot cancel the work. If you
need to stop the work, not just clean up after it, you need an `AbortSignal`;
see [Cancellation with AbortController](js-cancellation-abortcontroller.md).

For resources, `await using` with `Symbol.asyncDispose` (explicit resource
management) is a tidier alternative that already works in Node 24; it is
covered in
[Modern JavaScript features](modern-js-features.md).

## Top-level `await` blocks importers

In an ES module you can `await` at the top level. It is handy in scripts, but
it has a cost people forget: **every module that imports this one waits for it**.

```js
// config.mjs
console.log('config: fetching');
await new Promise((r) => setTimeout(r, 300)); // imagine a network call
export const config = { ready: true };
console.log('config: done');
```

```js
// main.mjs
import { config } from './config.mjs';
console.log('main: body starts', Math.round(performance.now()), 'ms after process start');
```

Running `node main.mjs` prints both `config` lines first, then the main body
after roughly 300 ms plus start-up. A slow top-level `await` in a shared module
delays start-up of everything that depends on it, and a rejection there fails
the whole import graph. Use it in entry points and scripts; keep it out of
library modules. Module evaluation order is covered in
[ES modules in depth](es-modules-in-depth.md).

## Lint rules that catch these for you

You will not spot all of these by eye. With typescript-eslint's type-aware
rules turned on:

| Rule | Catches |
|---|---|
| `@typescript-eslint/no-floating-promises` | a promise that is not awaited, returned, `.catch`ed or explicitly `void`ed |
| `@typescript-eslint/no-misused-promises` | a promise in a condition (`if (fetchUser())`), or an async function passed where a void callback is expected (`forEach`, some event handlers) |
| `@typescript-eslint/return-await` | missing `await` on a return inside `try`/`catch` |
| `@typescript-eslint/require-await` | an `async` function with no `await` (often a sign of a mistake) |
| `no-await-in-loop` (core ESLint) | sequential awaits in a loop; turn it off per line where sequencing is deliberate |

Mentioning `no-floating-promises` in an interview signals that you have worked
on a codebase large enough to need it.

## Practise it

- [Retry with timeout](../../43-retry-timeout/) and
  [Paginated API](../../44-paginated-api/) make you choose deliberately between
  sequential and parallel awaits.
- [Async submit in React](../../react/44-async-submit/) covers pending state and
  cleanup when an awaited call fails.
- For how `await` schedules work, read
  [The event loop, in depth](js-event-loop-in-depth.md); for the combinators,
  [Promise patterns](js-promise-patterns.md).

## What you should be able to answer

- Why does `items.forEach(async ...)` not wait, and what would you write instead?
- When is `return await` necessary, and when does it make no difference?
- What happens in Node 24 when a promise rejects and nothing handles it, and how
  would you do fire-and-forget safely?
- Why can a constructor not be async, and what pattern replaces it?
- What is the hidden cost of top-level `await` in a shared module?
- Which lint rules would you enable to catch floating and misused promises?
