# HTTP from the wire up

Every web application you will ever build is a program that receives HTTP
requests and returns HTTP responses. This is the highest-value non-code topic
on the whole path: it comes up in frontend interviews, backend interviews and
fullstack interviews, and unlike framework trivia it does not go out of date.

## What a request actually is

Plain text over a TCP connection (encrypted, if HTTPS):

```
POST /api/orders HTTP/1.1
Host: api.example.com
Content-Type: application/json
Authorization: Bearer eyJhbGci...
Content-Length: 41

{"productId":"abc","quantity":2}
```

Four parts: a **method**, a **path**, **headers**, and an optional **body**.
The response is the same shape with a status code instead of a method:

```
HTTP/1.1 201 Created
Content-Type: application/json
Location: /api/orders/7f3a

{"id":"7f3a","productId":"abc","quantity":2}
```

That is the whole protocol. Everything else — cookies, CORS, caching, auth — is
convention layered on those four parts.

## Methods, and the two properties that matter

| Method | Safe? | Idempotent? | Means |
|--------|-------|-------------|-------|
| GET | yes | yes | Read. Must not change anything. |
| HEAD | yes | yes | Like GET, headers only. |
| POST | no | **no** | Create, or "do something". |
| PUT | no | yes | Replace this resource entirely. |
| PATCH | no | usually no | Partially update this resource. |
| DELETE | no | yes | Remove it. |

**Safe** means no side effects. **Idempotent** means doing it five times leaves
the same end state as doing it once.

These are not academic. They decide real behaviour:

- Browsers, crawlers and link prefetchers will follow GETs on their own. A
  `GET /delete?id=5` endpoint *will* eventually be triggered by something that
  was just looking around.
- Retries are only safe on idempotent methods. This is why a flaky connection
  during checkout can create two orders — and why **idempotency keys** exist:
  the client generates a unique id, sends it with the POST, and the server
  stores it with the result so a retry replays the same answer instead of
  charging the card again.
- DELETE twice is fine. The second one returning 404 is not a bug; whether you
  return 404 or 204 is a decision you should make once and document.

## Status codes, in the amount of detail you are actually asked for

The families:

- **2xx — it worked.** 200 OK, 201 Created (send a `Location` header), 204 No
  Content (nothing to return, common for DELETE and PUT).
- **3xx — go somewhere else.** 301 permanent, 302/307 temporary, **304 Not
  Modified** (the caching one — see below).
- **4xx — you, the client, got it wrong.** Retrying identically will not help.
- **5xx — we, the server, got it wrong.** Retrying might help.

The 4xx ones you will be asked to distinguish:

| Code | Use it when |
|------|-------------|
| **400** Bad Request | The request is malformed or fails validation |
| **401** Unauthorized | We do not know who you are. *Authentication* failed. Send `WWW-Authenticate`. |
| **403** Forbidden | We know who you are and you may not do this. *Authorization* failed. |
| **404** Not Found | No such resource. Also used deliberately instead of 403 to avoid confirming a resource exists. |
| **409** Conflict | Clashes with current state — duplicate unique field, or a concurrent-edit collision |
| **422** Unprocessable | Well-formed but semantically invalid. Optional; 400 is fine if you prefer. |
| **429** Too Many Requests | Rate limited. **Always** include `Retry-After`. |

The 401 vs 403 distinction is asked constantly and is easy to get right:
**401 = who are you, 403 = not for you.**

Two anti-patterns worth naming because you will meet them:

- Returning `200 OK` with a `success: false` body. Every generic HTTP client,
  proxy, cache and monitoring tool now thinks your errors are successes.
- Returning `500` for validation failures. It puts client bugs in your error
  budget and wakes someone up at night.

## Headers you should know by name

**Request:**

- `Content-Type` — what I am sending. Forget `application/json` on a POST and
  the server's JSON parser skips your body, giving you a mysteriously empty
  `req.body`.
- `Accept` — what I would like back.
- `Authorization: Bearer <token>` — credentials. Never put a token in the URL:
  URLs end up in browser history, server logs, proxy logs and `Referer` headers.
- `Cookie` — sent automatically by the browser for matching origins. That
  automatic behaviour is exactly what makes CSRF possible.

**Response:**

- `Content-Type`, `Location` (for 201), `Set-Cookie`
- `Cache-Control`, `ETag` — see caching
- `Access-Control-Allow-Origin` — see CORS
- `Retry-After` — for 429 and 503

## Caching, which is mostly two headers

`Cache-Control` decides whether and how long a response can be reused:

```
Cache-Control: no-store
Cache-Control: no-cache
Cache-Control: max-age=31536000, immutable
Cache-Control: private, max-age=0, must-revalidate
```

The naming is genuinely backwards and it is a common interview question:
**`no-store` is the one that means "do not cache"**. `no-cache` means "store it,
but check with me before reusing it".

`ETag` is a fingerprint of the response:

```
GET /api/orders/7          ->  200 OK, ETag: "v3"

GET /api/orders/7
If-None-Match: "v3"        ->  304 Not Modified   (no body — cheap)
```

The same mechanism going the other way gives you **optimistic concurrency**:

```
PUT /api/orders/7
If-Match: "v3"             ->  412 Precondition Failed, if it changed since
```

That is how you stop two users silently overwriting each other's edits — the
"lost update" problem, which you will meet again in the SQL guide.

## CORS, and why you cannot fix it in the frontend

The **same-origin policy** stops a page on `evil.com` reading responses from
`yourbank.com`. Origin means scheme + host + port — `http://x.com` and
`https://x.com` are different origins, as are ports 3000 and 5000.

CORS is the server's way of opting out of that restriction:

```
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
```

Three things that will save you hours:

1. **The request usually reaches your server and runs.** The browser withholds
   the *response* from your JavaScript. So a "CORS error" on a POST may already
   have created the record.
2. **For anything non-simple, the browser sends an `OPTIONS` preflight first.**
   Non-simple means a method other than GET/HEAD/POST, a custom header, or a
   `Content-Type` of `application/json` — which is every API you will write. If
   your server 404s on OPTIONS, you get a CORS error with no useful message.
3. **`Allow-Origin: *` together with `Allow-Credentials: true` is invalid** and
   the browser rejects it. Credentials require naming the exact origin.

You cannot fix CORS in the client. Setting `mode: 'no-cors'` on a fetch does not
do what its name suggests — it gives you an opaque response you cannot read.
Fix it on the server, or proxy through your own origin in development.

## Cookies, in three attributes

```
Set-Cookie: session=abc; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800
```

- **HttpOnly** — JavaScript cannot read it. This is your XSS defence for
  session tokens.
- **Secure** — only sent over HTTPS.
- **SameSite** — `Lax` (sent on top-level navigations, not on cross-site POSTs
  or subresource requests) or `Strict` (never cross-site, which breaks "click
  the link in your email and be logged in"). This is your main CSRF defence.

A session cookie should have all three.

## HTTP/1.1 vs HTTP/2, briefly

HTTP/2 multiplexes many requests over a single connection and compresses
headers. The practical consequence: the old optimisations — concatenating all
your JavaScript into one bundle, sharding assets across `static1.` and
`static2.` domains — were working around the six-connections-per-host limit in
HTTP/1.1 and now matter much less. Many small cacheable files can beat one big
one.

## What actually happens when you type a URL

The classic open-ended interview question. A structured answer:

1. **DNS** resolves the hostname to an IP (cached at several layers).
2. **TCP** handshake to that IP on port 443.
3. **TLS** handshake: certificate validated, keys agreed.
4. **HTTP request** sent; server responds with HTML.
5. Browser **parses HTML into the DOM**, discovering subresources as it goes. A
   blocking script pauses parsing; a deferred one does not.
6. CSS is parsed into the **CSSOM**; the two combine into the render tree.
7. **Layout** computes geometry, **paint** produces pixels, **composite**
   assembles layers.
8. JavaScript runs, mutates the DOM, and the browser redoes the relevant parts.

You are not expected to recite it. You are expected to know it well enough to
say *where* a slow page is losing its time.

## What HTTPS does and does not do

TLS gives you confidentiality and integrity **in transit**, plus proof of the
server's identity. It does nothing about:

- what you store in plain text
- what you write to logs
- SQL injection, XSS, or a missing authorization check

"We use HTTPS" is one control, not a security posture.

## Drill yourself on

- GET vs POST vs PUT vs PATCH; safe vs idempotent, with a real consequence
- 401 vs 403, and when you would deliberately return 404 instead
- What a preflight is, and what actually fixes a CORS error
- `no-store` vs `no-cache`
- What an ETag gives you, in both directions
