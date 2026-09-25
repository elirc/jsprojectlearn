# Retries, timeouts and backoff

Every call across a network can fail, hang or succeed without you finding out.
A naive `for` loop around `fetch` turns a brief outage into a self-inflicted
denial of service and a flaky checkout into a double charge. "How would you
make this call resilient?" is a standard mid-level question, and the answer
interviewers want has five parts: what to retry, how long to wait, how long to
give each try, how to make retries safe, and when to stop trying altogether.

## Decide what is safe to retry

Retrying is only correct when doing the thing twice is harmless and a second
attempt might succeed. That gives two filters.

**Is the operation idempotent?** GET, HEAD, PUT and DELETE are idempotent by
definition; POST and PATCH are not (see
[HTTP fundamentals](http-fundamentals.md)). A POST that timed out may already
have created the order, so retrying it blindly can create two. Only retry a
non-idempotent request if it carries an idempotency key (below).

**Is the failure transient?**

| Outcome | Retry? | Why |
|---|---|---|
| Network error (connection reset, DNS blip) | yes | nothing reached the server, or you cannot tell |
| Per-attempt timeout | yes, if idempotent | the server may be slow, or may have done the work |
| 408 Request Timeout | yes | the server gave up waiting for you |
| 429 Too Many Requests | yes, after `Retry-After` | you are being rate limited |
| 500, 502, 503, 504 | yes | server or gateway trouble, often short-lived |
| 400, 401, 403, 404, 409, 422 | **no** | your request is wrong; the same request will fail the same way |
| Your own bug (malformed URL, body that will not serialise) | no | retrying a bug just delays the stack trace |

One awkward detail: `fetch` rejects with a `TypeError` both for network failures
and for an invalid URL, so validate inputs before you enter a retry loop.

A 401 is sometimes "retryable" in a different sense: refresh the token and try
once. That is an auth flow, not a backoff loop.

## Exponential backoff with full jitter

If every client retries immediately, a server that stumbled under load gets hit
again at once, by everyone. Back off: wait longer after each failure. The
standard formula is exponential with a cap, `base * 2 ** attempt`, so 200 ms,
400 ms, 800 ms, 1.6 s and so on up to the cap.

Exponential alone still has a problem. A thousand clients that failed at the
same moment all retry at the same moment, and again, in synchronised waves (the
**thundering herd**). **Jitter** spreads them out. "Full jitter" picks a
uniformly random delay between zero and the exponential value:

```js
function backoffDelay(attempt, base = 200, cap = 10_000) {
  return Math.random() * Math.min(cap, base * 2 ** attempt); // full jitter
}
```

It looks odd that a retry might wait almost nothing, but across many clients it
produces the smoothest load and the fewest total calls. It is AWS's documented
default and what most retry libraries implement.

## Respect `Retry-After`

When a server sends 429 or 503 with `Retry-After`, it is telling you exactly
when to come back. Use it instead of your own backoff. It comes in two forms,
seconds or an HTTP date:

```js
function retryAfterMs(res) {
  const h = res.headers.get('retry-after');
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return secs * 1000;
  const date = Date.parse(h);                    // HTTP-date form
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}
```

Cap it at something sensible for your use case. If a user is waiting and the
server says "come back in ten minutes", fail fast and say so rather than
spinning.

## Per-attempt timeout vs overall deadline

`fetch` has no default timeout. Without one, a hung server hangs your caller
indefinitely. You want **two** limits:

- A **per-attempt timeout** so one stuck connection does not eat the whole
  budget. It is what turns a hang into a retryable failure.
- An **overall deadline** across all attempts and waits, because the caller
  only cares about total time. Four attempts of 5 seconds plus backoff is not
  acceptable behind a button.

`AbortSignal.timeout` and `AbortSignal.any` express both directly (see
[Cancellation with AbortController](js-cancellation-abortcontroller.md)). Put
it all together:

```js
import { setTimeout as sleep } from 'node:timers/promises';

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const IDEMPOTENT = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

async function fetchWithRetry(url, init = {}, {
  retries = 4, perAttemptMs = 2_000, deadlineMs = 10_000, signal,
} = {}) {
  const method = (init.method ?? 'GET').toUpperCase();
  const safeToRetry = IDEMPOTENT.has(method) || new Headers(init.headers).has('Idempotency-Key');
  if (!safeToRetry) retries = 0;
  const overall = AbortSignal.any([AbortSignal.timeout(deadlineMs), ...(signal ? [signal] : [])]);
  for (let attempt = 0; ; attempt++) {
    const attemptSignal = AbortSignal.any([overall, AbortSignal.timeout(perAttemptMs)]);
    let res, err;
    try {
      res = await fetch(url, { ...init, signal: attemptSignal });
    } catch (e) {
      if (overall.aborted) throw overall.reason;   // deadline or caller cancel: stop
      err = e;                                     // network error or per-attempt timeout
    }
    if (res && !RETRYABLE_STATUS.has(res.status)) return res; // success, or a 4xx to report
    if (attempt >= retries) {
      if (res) return res;
      throw err;
    }
    const wait = (res && retryAfterMs(res)) ?? backoffDelay(attempt);
    await res?.body?.cancel();                     // free the connection
    await sleep(wait, undefined, { signal: overall });
  }
}
```

Run against a local Node 24 server that answers 503, then 429 with
`Retry-After: 1`, then hangs, then succeeds (with a 300 ms per-attempt timeout
and a log line added before the sleep), it printed:

```txt
attempt 1 failed (503), waiting 83 ms
attempt 2 failed (429), waiting 1000 ms
attempt 3 failed (TimeoutError), waiting 114 ms
final 200 ok after 4 requests
```

A 400 came back after a single request, a POST with no idempotency key was
tried exactly once, and a hanging endpoint with a 400 ms deadline rejected with
`TimeoutError` instead of waiting out the retries. Your jitter numbers will
differ. Note the details: `res.body.cancel()` releases the connection of a
response you are discarding, and the sleep takes the overall signal so a
cancel during a wait stops immediately.

In a real codebase, prefer a small tested library (or your HTTP client's retry
option) over this function, but you should be able to write it and explain each
line. The [Retry with timeout](../../43-retry-timeout/) project walks you
through building it.

## Idempotency keys make POST retryable

To retry "create payment" safely, the client generates a unique key once per
logical operation and sends it on every attempt:

```http
POST /payments HTTP/1.1
Idempotency-Key: 5f1c8a1e-3b7d-4a53-9a7e-2f0b6c9d1e44
Content-Type: application/json

{"amount": 4999, "currency": "GBP"}
```

The server stores the key with the result. A repeat with the same key returns
the stored response instead of charging again. Two rules make it work:

- Generate the key **once, before the first attempt** (`crypto.randomUUID()`),
  not inside the retry loop. A new key per attempt defeats the point.
- The server must record the key and the side effect **atomically**, usually
  a unique constraint in the same database transaction. Otherwise two
  concurrent retries can both pass the "have I seen this key?" check.

Stripe's API popularised this, and an IETF draft standardises the
`Idempotency-Key` header. See [Third-party integrations](third-party-integrations.md)
for the provider side.

## Circuit breakers, briefly

Retries help with blips. When a dependency is properly down, every caller
retrying four times multiplies load on something already failing and makes
your own requests slow while they wait. A **circuit breaker** tracks recent
failures per dependency:

| State | Behaviour |
|---|---|
| Closed | calls go through; failures are counted |
| Open | after too many failures, calls fail **immediately** without trying, for a cool-down period |
| Half-open | after the cool-down, let a few trial calls through; success closes it, failure reopens it |

Failing fast lets you show a fallback ("recommendations unavailable") instead of
a spinner. In Node, libraries such as `opossum` implement it; in .NET, Polly's
resilience pipelines (via `Microsoft.Extensions.Http.Resilience`) combine
retry, timeout and breaker in one place.

## Retry budgets: stop retries amplifying outages

Retries multiply. If a web tier retries 3 times and the service it calls also
retries 3 times against the database, one user request can become 16 database
calls during an outage. Two defences:

- **Retry at one layer only**, usually the one closest to the user or the
  edge, and let inner layers fail fast.
- **A retry budget**: allow retries only while they are a small fraction of
  total traffic (say 10% over the last minute). Once the budget is spent, fail
  without retrying. Under normal conditions nothing changes; during an outage,
  load stays close to 1x instead of 4x.

## What you should be able to answer

- Which HTTP failures would you retry, which would you never retry, and why
  does the method matter?
- Why add jitter to exponential backoff, and what does "full jitter" mean?
- What is the difference between a per-attempt timeout and an overall
  deadline, and why do you need both?
- How does an idempotency key make a POST safe to retry, and where must the
  key be generated?
- What does a circuit breaker do in each of its three states?
- How can well-meaning retries turn a small outage into a big one, and what
  limits that?
