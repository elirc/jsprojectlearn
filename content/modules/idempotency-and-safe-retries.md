# Idempotency and safe retries

Networks fail in the worst possible place: after the server did the work but
before the client heard about it. Interviewers use this to test whether you
think about distributed systems at all. You should be able to say which
requests are safe to retry, how an idempotency key works in detail, and why
naive retries can take down a service that was only slightly unwell.

## Safe, idempotent, and what a timeout tells you

RFC 9110 defines two properties:

- **Safe**: the client does not ask for any state change. `GET`, `HEAD`,
  `OPTIONS`, `TRACE`.
- **Idempotent**: sending it N times has the same intended effect as once.
  All safe methods, plus `PUT` and `DELETE`.

`POST` and `PATCH` are neither by default, though a specific PATCH (set
`status` to `"paid"`) can be.

Idempotent is about **server state, not the response**: a second `DELETE` may
return 404 instead of 204.

Now the key fact. When a request times out or the connection resets, **the
client cannot know whether the server acted**. The request may have been lost
on the way in, processed and the response lost on the way out, or still be
running. For an idempotent request that uncertainty is harmless: send it again.
For `POST /payments` it means either risking a double charge or giving up on a
payment that may have succeeded. Idempotency keys resolve that dilemma.

## Idempotency-Key, designed properly

The client generates a unique key (a UUID) **once per logical operation**, and
sends the same key on every retry of that operation:

```http
POST /payments
Idempotency-Key: 5f0c1a8e-2d7b-4b8a-9d61-0c4f5c2e7a11
Content-Type: application/json

{"orderId":"ord_91","amountPence":4999}
```

The server's decisions, following Stripe's behaviour and the IETF
`Idempotency-Key` header draft:

| Situation | Response |
|---|---|
| Key missing on an endpoint that requires one | 400 |
| New key | Claim it, do the work, store the response |
| Key seen, same request, completed | Replay the stored status and body |
| Key seen, same request, still running | 409, with `Retry-After` |
| Key seen, **different** request body | 422: the client has a bug |
| Key older than the TTL | Treated as new |

The design points an interviewer will probe:

- **Scope keys per client.** Store `(clientId, key)`, not `key`. Otherwise one
  tenant can replay, or block, another tenant's requests by guessing keys.
- **Fingerprint the request.** Hash method, path and body, and compare on
  reuse. Without it, a client that reuses a key for a different payment gets
  the first payment's response and thinks the second succeeded. Hash the raw
  bytes if you can; re-serialised JSON can differ in key order.
- **Claim before working.** Insert the key as `in-flight` atomically (a unique
  constraint or Redis `SET NX`) before doing the work. Checking and then
  inserting afterwards lets two concurrent retries both run.
- **Store the response, not just "seen".** A retry must receive the same
  answer, including the id of the payment that was created.
- **Expire keys.** 24 hours is typical. The TTL must exceed the client's total
  retry window, or a late retry becomes a duplicate.
- **Record the effect and the key in one transaction.** If the payment row
  commits but storing the key fails, a retry charges again. Put both in the
  same database transaction.

Failures need a policy too: replaying a stored 4xx is correct; releasing the
key after a 5xx lets the client retry, which is only safe if the work rolled
back. Another argument for the single transaction.

## An Express idempotency middleware

A runnable sketch for Express 5 on Node 24, with an in-memory `Map` standing
in for Redis or a table:

```js
import { createHash } from 'node:crypto';

const TTL_MS = 24 * 60 * 60 * 1000;
const store = new Map(); // production: Redis SET NX, or a table with a unique key

export function idempotency(req, res, next) {
  const key = req.get('Idempotency-Key');
  if (!key) return res.status(400).json({ title: 'Idempotency-Key header is required' });

  const scope = `${req.user?.id ?? 'anon'}:${key}`;
  const fingerprint = createHash('sha256')
    .update(`${req.method} ${req.originalUrl} ${JSON.stringify(req.body ?? null)}`)
    .digest('hex');

  const existing = store.get(scope);
  if (existing && existing.expiresAt > Date.now()) {
    if (existing.fingerprint !== fingerprint)
      return res.status(422).json({ title: 'Idempotency-Key reused with a different request' });
    if (existing.state === 'in-flight')
      return res.status(409).set('Retry-After', '1').json({ title: 'Original request in progress' });
    return res.status(existing.status).set('Idempotent-Replayed', 'true').json(existing.body);
  }

  store.set(scope, { state: 'in-flight', fingerprint, expiresAt: Date.now() + TTL_MS });

  const json = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 500) store.delete(scope);
    else store.set(scope, { state: 'done', fingerprint, status: res.statusCode, body,
                            expiresAt: Date.now() + TTL_MS });
    return json(body);
  };
  res.on('close', () => { if (store.get(scope)?.state === 'in-flight') store.delete(scope); });
  next();
}

// app.post('/payments', idempotency, createPayment);
```

Tested: of two concurrent identical POSTs one gets 201, the other 409; a later
retry gets the stored 201 with `Idempotent-Replayed: true`; a different body
gets 422; the handler ran once. The `Map` check-then-set is atomic only within
one Node process; across instances, let the database or Redis do the claiming.

## Which failures to retry

| Failure | Retry? |
|---|---|
| Connection refused, DNS failure | Yes: nothing reached the server |
| Connection reset, timeout | Only if idempotent or keyed: it may have run |
| 408, 429, 503 | Yes, after `Retry-After` if present |
| 502, 504 | Idempotent or keyed only |
| 500 | Rarely: usually a bug that will fail again |
| 400, 401, 403, 404, 409, 422 | No. Fix the request (refresh the token first on 401) |

## Backoff with jitter, deadlines and budgets

Retrying immediately hits a struggling server when it is weakest. Exponential
backoff spaces attempts out (200 ms, 400 ms, 800 ms…), and **jitter**
randomises each delay so a thousand clients that failed together do not retry
together. "Full jitter", a random delay between zero and the exponential
ceiling, spreads load best.

Timeouts come in two layers: a **per-attempt** timeout so one hung connection
does not eat the whole budget, and an **overall deadline** after which you
stop. Node 24's `fetch` only gives up after undici's five-minute defaults, so you set
both:

```js
import { setTimeout as sleep } from 'node:timers/promises';

const IDEMPOTENT = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);
const RETRYABLE = new Set([408, 429, 502, 503, 504]);

function retryAfterMs(res) {
  const h = res?.headers.get('retry-after');
  if (!h) return 0;
  const secs = Number(h);
  return Number.isFinite(secs) ? secs * 1000 : Math.max(0, Date.parse(h) - Date.now());
}

export async function fetchWithRetry(url, init = {}, {
  retries = 4, baseMs = 200, capMs = 5_000, attemptMs = 3_000, deadlineMs = 15_000,
} = {}) {
  const headers = new Headers(init.headers);
  const method = (init.method ?? 'GET').toUpperCase();
  const safeToRepeat = IDEMPOTENT.has(method) || headers.has('Idempotency-Key');
  const deadline = AbortSignal.timeout(deadlineMs);
  const started = Date.now();

  for (let attempt = 0; ; attempt++) {
    const signals = [deadline, AbortSignal.timeout(attemptMs)];
    if (init.signal) signals.push(init.signal);
    let res, err;
    try {
      res = await fetch(url, { ...init, headers, signal: AbortSignal.any(signals) });
    } catch (e) {
      err = e;
    }
    if (deadline.aborted || init.signal?.aborted) throw err ?? deadline.reason;

    const retryable = err ? true : RETRYABLE.has(res.status);
    const delay = Math.max(Math.random() * Math.min(capMs, baseMs * 2 ** attempt), retryAfterMs(res));
    if (!retryable || !safeToRepeat || attempt >= retries || Date.now() - started + delay > deadlineMs) {
      if (err) throw err;
      return res;
    }
    await res?.body?.cancel();                       // free the connection
    await sleep(delay, undefined, { signal: deadline });
  }
}
```

Tested: two 503s then a 200 resolves with the 200; a 404 returns at once; a
refused connection throws after the retries. The [retry and timeout project](../../43-retry-timeout/) builds the
same idea from smaller pieces; in .NET, `AddStandardResilienceHandler` gives
you the equivalent (see [third-party integrations](third-party-integrations.md)).

**Retry storms** are the reason to be conservative. If a web tier retries 3
times, calling a service that retries 3 times, calling a database, one failing
query becomes 16 attempts, arriving exactly when the database is overloaded.
Retry at one layer only, usually the outermost caller. Add a **retry budget**
(retries may be at most, say, 10% of requests over the last minute; beyond
that, fail fast) and a circuit breaker. Honour 429s rather than hammering
through them (see [rate limiting and quotas](rate-limiting-and-quotas.md)).

## At-least-once delivery and dedupe on consumers

Queues and webhooks almost always deliver **at least once**: a consumer that
crashes after processing but before acknowledging gets the message again.
"Exactly once" in practice means at-least-once delivery plus idempotent
processing. Two techniques:

- **Dedupe table.** Record processed message ids with a unique constraint, in
  the same transaction as the work, and skip repeats.
- **Natural keys and upserts.** Make the operation idempotent by design.
  Instead of "insert a shipment", "ensure a shipment exists for order 91":

```sql
INSERT INTO shipments (order_id, carrier, created_at)
VALUES ($1, $2, now())
ON CONFLICT (order_id) DO NOTHING;   -- SQL Server: MERGE, or catch error 2627
```

A unique constraint on the natural key turns a duplicate into a no-op, even if
every other layer fails. Likewise prefer absolute updates (`SET status =
'shipped'`) to relative ones (`SET stock = stock - 1`), which double-count when
replayed. Queue mechanics are in [background jobs and queues](background-jobs-and-queues.md).

## What you should be able to answer

- A `POST /payments` times out. What do you know about whether the payment happened, and what should the client do?
- Walk through an idempotency-key implementation: storage, scope, fingerprinting, concurrent duplicates and TTL.
- Which HTTP failures would you retry, and which would you never retry?
- Why add jitter to exponential backoff, and what is a retry storm?
- How do you make a queue consumer safe under at-least-once delivery?
- Why is `SET stock = stock - 1` a problem for retries, and what would you do instead?
