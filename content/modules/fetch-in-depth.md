# `fetch` in depth

Every screen you build loads or saves data, and almost all of it goes through `fetch`.
Interviewers ask about it because the happy path hides several traps: a 500 response does
not reject, a body can only be read once, cookies are not always sent, and nothing times
out on its own. A mid-level developer wraps `fetch` once, correctly, and knows why each
line of the wrapper is there.

## What `fetch` resolves and rejects on

`fetch` returns a promise that resolves as soon as the response **headers** arrive, whatever
the status code. It rejects only when no HTTP response was received at all.

| Situation | Promise | What you see |
| --- | --- | --- |
| 200, 201, 204 | resolves | `res.ok === true` |
| 400, 404, 409, 500 | resolves | `res.ok === false`, `res.status` set |
| DNS failure, offline, connection refused | rejects | `TypeError` |
| Blocked by CORS | rejects | `TypeError`, with no detail readable from JS |
| Aborted with a signal | rejects | `DOMException` named `AbortError` (or `TimeoutError`) |

So this common code is wrong:

```js
try {
  const orders = await (await fetch('/api/orders')).json();
  render(orders);
} catch {
  showError(); // never runs for a 500; .json() may throw on an HTML error page instead
}
```

You must check `res.ok` (true for 200–299) yourself.

## Reading the body

A `Response` body is a stream, and it can be consumed exactly once:

```js
const res = await fetch('/api/orders/7');
const data = await res.json();
await res.text(); // TypeError: body has already been read
```

If you need it twice (log the raw text, then parse), read it as text once and
`JSON.parse` it, or call `res.clone()` before the first read. The readers are `json()`,
`text()`, `blob()`, `arrayBuffer()`, `formData()` and `bytes()`, plus `res.body` for the raw
`ReadableStream`, which lets you process a large download or a streamed AI response chunk
by chunk.

`204 No Content` has no body, so calling `res.json()` on it throws. A wrapper should check
the status or the `Content-Length` before parsing.

## Sending data

```js
// JSON
await fetch('/api/orders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ productId: 'abc', quantity: 2 }),
});

// A form, including files
await fetch('/api/avatars', { method: 'POST', body: new FormData(form) });

// Query strings, safely encoded
const url = new URL('/api/orders', location.origin);
url.searchParams.set('status', 'open');
url.searchParams.set('q', 'Café & Co');
await fetch(url);
```

Two rules:

- With `FormData`, **do not set `Content-Type`**. The browser adds
  `multipart/form-data; boundary=…`, and setting it yourself drops the boundary so the
  server cannot parse the body.
- With JSON, you **must** set it, or the body is sent as `text/plain` and most frameworks
  ignore it. Setting it also makes the request "non-simple", which triggers a CORS
  preflight on cross-origin calls.

## Cookies and credentials

The `credentials` option decides whether cookies and HTTP auth go with the request:

| Value | Same-origin request | Cross-origin request |
| --- | --- | --- |
| `same-origin` (default) | cookies sent | cookies not sent |
| `include` | cookies sent | cookies sent, if the server allows it |
| `omit` | never | never |

For a SPA on `app.example.com` calling `api.example.com` with a session cookie, you need
`credentials: 'include'`, and the API must answer with
`Access-Control-Allow-Credentials: true` and an exact `Access-Control-Allow-Origin`
(not `*`). The CORS side is covered in [HTTP fundamentals](http-fundamentals.md).

## Cancellation and timeouts

`fetch` never times out on its own; a hung server leaves your spinner spinning. Use
`AbortSignal`:

```js
// Give up after 8 seconds
const res = await fetch('/api/report', { signal: AbortSignal.timeout(8000) });

// Cancel when the user navigates away OR after 8 seconds, whichever comes first
const controller = new AbortController();
const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]);
fetch('/api/search?q=lap', { signal });
controller.abort(); // rejects with an AbortError
```

A timeout rejects with a `TimeoutError`, a manual abort with an `AbortError`, so the UI can
tell "too slow" from "the user moved on" and show nothing for the second.

Aborting is also how you fix the classic **fetch race**: type "lap", then "laptop", and the
slower first response arrives last and overwrites the right results. Abort the previous
request whenever a new one starts, or ignore responses that are not for the latest query.
[The fetch race project](../../react/19-fetch-race/) builds both fixes.

## Errors worth modelling

Make failures into values your UI can switch on:

```js
export class HttpError extends Error {
  constructor(status, problem) {
    super(problem?.title ?? `HTTP ${status}`);
    this.status = status;
    this.problem = problem; // RFC 9457 body, if the API sends one
  }
}

export async function api(path, { timeout = 10_000, ...init } = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: { Accept: 'application/json', ...init.headers },
    signal: init.signal ?? AbortSignal.timeout(timeout),
  });
  const isJson = res.headers.get('Content-Type')?.includes('json');
  const body = res.status === 204 ? null : isJson ? await res.json() : await res.text();
  if (!res.ok) throw new HttpError(res.status, isJson ? body : null);
  return body;
}
```

Well-designed APIs, including ASP.NET Core's `ProblemDetails`, return errors as
`application/problem+json` (RFC 9457) with `title`, `status`, `detail` and often an
`errors` map of field messages, which your form can show next to the right inputs. Map
statuses to behaviour, not just messages:

| Status | UI behaviour |
| --- | --- |
| 400 / 422 | show field errors from the body |
| 401 | refresh the session or send to login |
| 403 | "you do not have access", no retry |
| 404 | not-found state |
| 409 / 412 | conflict: someone else changed it; reload or merge |
| 429 / 503 | back off and retry, honouring `Retry-After` |
| network `TypeError` | offline or blocked; offer retry |

## Retries without making things worse

Only retry what is safe to repeat. `GET`, `PUT` and `DELETE` are idempotent; a `POST` that
creates an order is not, unless the API supports an `Idempotency-Key` header so a retried
request returns the first result instead of charging twice. Retry on network errors, 429,
502, 503 and 504, with exponential backoff and jitter, and never on 400-class errors other
than 408 and 429. The [retry with timeout project](../../43-retry-timeout/) implements the
loop by hand.

## Less common options that come up

- `keepalive: true` lets a small request (a total of about 64 KB of in-flight keepalive
  bodies) finish after the page unloads, for analytics and "save draft on exit".
  `navigator.sendBeacon` is the simpler fire-and-forget version.
- `cache: 'no-store'` or `'reload'` controls the browser's HTTP cache for that request;
  the server's `Cache-Control` still matters for everything else.
- `redirect: 'manual'` stops automatic redirect following, though cross-origin details
  stay hidden from the page.
- `fetch` still has no upload progress event, which is why upload screens often keep `XMLHttpRequest` and its `upload.onprogress` event.

In React apps you usually wrap this in a data library such as TanStack Query rather than
calling `fetch` in effects; see [server and client state](server-and-client-state.md) and
the [fetch status project](../../react/20-fetch-status/).

## What you should be able to answer

- Does `fetch` reject on a 404 or 500? What exactly makes it reject?
- Why can you not call `res.json()` and then `res.text()` on the same response?
- Why must you not set `Content-Type` when sending `FormData`, but must set it for JSON?
- How do you send cookies to an API on a different subdomain, and what must the server do?
- How do you add a timeout and cancellation to `fetch`, and how does aborting fix a search
  race condition?
- Which requests are safe to retry automatically, and how does an idempotency key help?
