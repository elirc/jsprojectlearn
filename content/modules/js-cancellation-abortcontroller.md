# Cancellation with AbortController

A search box that shows results for the previous keystroke, a React component
that sets state after it unmounted, a request that hangs for two minutes
because nobody set a timeout: all three are cancellation bugs. JavaScript has
one standard answer, `AbortController`, and it works the same in browsers and
Node 24. Interviewers ask about it because it separates people who have shipped
real async UIs from people who have only called `fetch` in a tutorial.

## The two objects

An **`AbortController`** is the button; its **`AbortSignal`** is the wire you
hand to whoever should listen.

```js
const controller = new AbortController();
const { signal } = controller;

fetch('/api/search?q=shoes', { signal });

controller.abort(); // the fetch rejects straight away
```

The split is deliberate. Code that *starts* work keeps the controller and
decides when to cancel. Code that *does* the work only gets the signal, which
can be observed but not triggered. A signal can only abort once; after that,
`signal.aborted` is `true` for ever and `signal.reason` holds why.

## Cancelling fetch, and what the error looks like

When a signal aborts, `fetch` rejects with the signal's **reason**. What that
is depends on how it was aborted:

| How it was aborted | `err.name` | Type |
|---|---|---|
| `controller.abort()` with no argument | `AbortError` | `DOMException` |
| `AbortSignal.timeout(ms)` fired | `TimeoutError` | `DOMException` |
| `controller.abort(myReason)` | whatever you passed | your value |

Checked in Node 24, `AbortSignal.timeout(10)` on a request to an unreachable
address rejects with `TimeoutError: The operation was aborted due to timeout`,
and a bare `abort()` gives `AbortError: This operation was aborted`.

The distinction matters in the catch block. A user-initiated cancel is usually
not an error at all; a timeout is:

```js
async function load(signal) {
  try {
    const res = await fetch('/api/report', { signal });
    return await res.json();
  } catch (err) {
    if (err.name === 'AbortError') return null;   // we cancelled: stay quiet
    if (err.name === 'TimeoutError') throw new Error('Server took too long', { cause: err });
    throw err;
  }
}
```

Check `err.name`, not `instanceof DOMException`, because a custom reason may be
any value. Do not show an error toast for an `AbortError`; it just means the
user moved on.

The signal also covers reading the body. Aborting while `res.json()` is still
streaming the response rejects that call too.

## `AbortSignal.timeout` and `AbortSignal.any`

Two static helpers remove most hand-written plumbing.

**`AbortSignal.timeout(ms)`** returns a signal that aborts itself after `ms`
with a `TimeoutError`. It replaces the old `setTimeout(() => c.abort(), ms)`
dance, and you do not need to clear it:

```js
const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
```

**`AbortSignal.any([...signals])`** returns a signal that aborts when the
*first* of its inputs aborts, taking that input's reason. This is how you
combine "the user clicked cancel" with "and give up after 5 seconds":

```js
const user = new AbortController();
const signal = AbortSignal.any([user.signal, AbortSignal.timeout(5000)]);

fetch(url, { signal });
cancelButton.onclick = () => user.abort();
```

If the user aborts first, `signal.reason.name` is `AbortError`; if the timer
wins, it is `TimeoutError`. The same pattern combines a request-scoped signal on
a server with a per-call timeout. `AbortSignal.abort(reason)` gives you an
already-aborted signal, which is handy in tests.

## Cancelling your own async functions

`fetch` knows what to do with a signal; your own functions do not until you
teach them. The convention, used by Node's own APIs (`node:timers/promises`,
`fs.readFile`, `events.once`), is an options object with a `signal` property.
Two techniques:

1. **Check between units of work** with `signal.throwIfAborted()`, which throws
   `signal.reason` if the signal has already aborted.
2. **Pass the signal down** to anything you await that accepts one.

For something that waits on a callback, listen for the `abort` event, and
remove the listener once you have finished:

```js
function sleep(ms, { signal } = {}) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function importRows(rows, { signal } = {}) {
  let done = 0;
  for (const row of rows) {
    signal?.throwIfAborted();          // check between units of work
    await sleep(20, { signal });       // pass it down to anything that accepts one
    done++;
  }
  return done;
}

const controller = new AbortController();
setTimeout(() => controller.abort(new Error('user cancelled')), 50);
try {
  await importRows([1, 2, 3, 4, 5], { signal: controller.signal });
} catch (err) {
  console.log('stopped:', err.message); // stopped: user cancelled
}
```

Why remove the listener? A long-lived signal (one per server request, or one
for a whole page) might be passed to thousands of operations. Each
`addEventListener` that is never removed keeps its closure (and everything the
closure references) alive until the signal itself is garbage-collected, and
when the signal finally aborts, every stale listener runs. Node 24 prints its
usual `MaxListenersExceededWarning` for a plain `EventTarget`, but not for an
`AbortSignal` (a thousand listeners produced no warning when we tried), so this
leak is silent. `{ once: true }` only removes a listener if the abort
actually happens, so the success path must clean up too.

Cancellation in JavaScript is **cooperative**. Aborting does not stop code
mid-statement; it stops code that checks. A tight synchronous loop that never
calls `throwIfAborted()` runs to the end regardless. See
[The event loop, in depth](js-event-loop-in-depth.md) for why nothing can
interrupt it.

## React effect cleanup

The canonical React use: cancel the previous request when the input changes or
the component unmounts.

```jsx
useEffect(() => {
  const controller = new AbortController();
  fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
    .then((res) => res.json())
    .then(setResults)
    .catch((err) => {
      if (err.name !== 'AbortError') setError(err);
    });
  return () => controller.abort();
}, [query]);
```

This fixes two bugs at once. Out-of-order responses: typing "sh" then "shoes"
can no longer show results for "sh" if that request happens to finish last. And
state updates after unmount. It also cancels the doubled request that
Strict Mode's mount, unmount, mount cycle fires in development. Practise it in
[Fetch race](../../react/19-fetch-race/),
[Effect cleanup](../../react/18-effect-cleanup/) and
[Search as you type](../../54-search-as-you-type/).

In production React code you would usually let TanStack Query or your router's
loader handle this; both pass you a `signal` to forward to `fetch`.

## Cancelling does not undo anything on the server

This is the point a strong answer always makes. Aborting a fetch stops **your
client** waiting and closes the connection. It does not roll back what the
server already did. Tested in Node 24 with a local server that takes 300 ms to
handle a POST and a client that aborts at 100 ms:

```txt
server: got request
client: TimeoutError
server: order created anyway
```

The client reports failure; the order exists. Consequences:

- A timed-out POST is in an **unknown state**, not a failed one. Retrying it
  blindly can create a duplicate. That is what idempotency keys are for; see
  [Retries, timeouts and backoff](js-retries-timeouts-backoff.md).
- On the server, you can listen for the client disconnecting and stop expensive
  work early. In ASP.NET Core that is `HttpContext.RequestAborted`, a
  `CancellationToken` you pass all the way down to EF Core; see
  [C# async deep dive](csharp-async-deep-dive.md). Node frameworks expose the
  same idea through the request's `close` event, which you can turn into an
  `AbortSignal`.
- Cancelling is for *wasted work and stale results*, not for correctness. Do
  not rely on an abort to prevent a write.

## Practise it

- [Retry with timeout](../../43-retry-timeout/): add a signal that cancels both
  the in-flight attempt and the wait before the next one.
- [Async event emitter](../../56-async-emitter/): support `signal` in a
  `once()` helper and remove listeners correctly.

## What you should be able to answer

- Why are `AbortController` and `AbortSignal` separate objects?
- How do you tell a user cancel from a timeout in a `catch` block, and why
  should they be handled differently?
- How would you combine a user cancel button with a 5-second timeout?
- How do you make your own async function cancellable, and why must you remove
  the `abort` listener on the success path?
- How does `AbortController` fix race conditions in a React effect?
- If a POST times out on the client, did the server do the work? What do you do
  about it?
