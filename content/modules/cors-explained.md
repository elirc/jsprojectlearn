# CORS, properly

Almost every developer has pasted `app.use(cors())` to make an error go away.
Interviewers ask about CORS because it reveals whether you understand the
browser security model: what the same-origin policy protects, why a preflight
happens, why credentials change the rules, and why none of it protects your
server. This guide goes past the summary in [HTTP from the wire up](http-fundamentals.md).

## What the same-origin policy actually protects

An **origin** is scheme + host + port. `https://app.example.com` and
`https://api.example.com` are different origins; so are `:5173` and `:5000` on
localhost. Paths do not matter.

The same-origin policy does not stop a page *sending* requests elsewhere. Forms,
`<img>`, `<script>` and `fetch` all send cross-origin requests freely, with
cookies. What it stops is **JavaScript reading the response**. That is the
threat: a page on `evil.example` calling `fetch('https://bank.example/api/me',
{ credentials: 'include' })` would receive your account data if the browser let
it read the result.

CORS is the server's way of relaxing that rule: "these origins may read my
responses". It never makes anything stricter.

Do not confuse origin with **site** (scheme + registrable domain), which is what
`SameSite` cookies use. `app.example.com` and `api.example.com` are cross-origin
but **same-site**, so a `SameSite=Lax` session cookie still travels between
them. That is why hosting your SPA and API on sibling subdomains is so much
easier than on unrelated domains.

## Simple requests vs preflighted requests

A request is **simple** (no preflight) only if all of these hold:

- Method is `GET`, `HEAD` or `POST`.
- Only CORS-safelisted request headers: `Accept`, `Accept-Language`,
  `Content-Language`, `Content-Type`, and a simple `Range`.
- `Content-Type`, if present, is `application/x-www-form-urlencoded`,
  `multipart/form-data` or `text/plain`.

Anything else is preflighted: a `PUT` or `DELETE`, an `Authorization` header, a
custom `X-Request-Id`, or `Content-Type: application/json`. So effectively
every call from a SPA to a JSON API is preflighted.

The preflight is an `OPTIONS` request the browser sends first, with no body and
**no credentials**:

```http
OPTIONS /api/orders/7 HTTP/1.1
Origin: https://app.example.com
Access-Control-Request-Method: PUT
Access-Control-Request-Headers: authorization, content-type

HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET, PUT, DELETE
Access-Control-Allow-Headers: authorization, content-type
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 3600
Vary: Origin
```

The preflight must answer with a 2xx. Because it carries no cookies or token,
an authentication middleware that runs before CORS and returns 401 to every
unauthenticated request will break every preflight. Only if the preflight
passes does the browser send the real `PUT`.

## Every Access-Control header

| Header | Sent on | Meaning |
|---|---|---|
| `Access-Control-Allow-Origin` | Preflight and actual response | The one origin allowed to read (or `*`) |
| `Access-Control-Allow-Credentials` | Both | `true` lets cookies/auth be sent and the response be read |
| `Access-Control-Allow-Methods` | Preflight | Methods permitted for the actual request |
| `Access-Control-Allow-Headers` | Preflight | Request headers permitted |
| `Access-Control-Max-Age` | Preflight | Seconds the browser may cache this preflight result |
| `Access-Control-Expose-Headers` | Actual response | Response headers JavaScript may read |
| `Origin` | Request | Sent by the browser; your code does not set it |
| `Access-Control-Request-Method` / `-Headers` | Preflight request | What the real request will use |

**Expose-Headers** is the one people miss. By default a cross-origin script
can read only the safelisted response headers: `Cache-Control`,
`Content-Language`, `Content-Length`, `Content-Type`, `Expires`,
`Last-Modified`, `Pragma`. `res.headers.get('Location')` after a 201, `ETag`
for optimistic concurrency, `Retry-After` on a 429 and `X-Total-Count` for
pagination all return `null` until you expose them.

**Max-Age** is capped by the browser: Chromium at 2 hours, Firefox at 24.
Without it the preflight is cached for 5 seconds, so a chatty SPA doubles its
request count.

## Credentials, and why `*` fails

With `fetch(url, { credentials: 'include' })` (or `withCredentials` in Axios),
the browser demands:

- `Access-Control-Allow-Origin` is the exact requesting origin, never `*`.
- `Access-Control-Allow-Credentials: true`.
- In `Allow-Headers`, `Allow-Methods` and `Expose-Headers`, `*` is treated as a
  literal header name, not a wildcard.

The reason is the threat model above: `*` plus credentials would let every
website on the internet read logged-in users' data. And for cookies to be sent
cross-*site* at all, they need `SameSite=None; Secure`, and browsers that block
third-party cookies may drop them anyway. Same-site subdomains or a
same-origin reverse proxy avoid that whole class of problem.

## Reflecting Origin safely

Because credentials forbid `*`, servers commonly echo the request's `Origin`.
Echoing it unconditionally is a real vulnerability: any site can now read
authenticated responses. Always check an allowlist, and get the comparison
right:

```js
const allowed = new Set(['https://app.example.com', 'https://admin.example.com']);

// Bad: /example\.com$/ matches https://evilexample.com
// Bad: origin.startsWith('https://app.example.com') matches https://app.example.com.evil.io
const isAllowed = (origin) => allowed.has(origin);
```

Never allowlist the string `null`: sandboxed iframes and `file://` pages send
`Origin: null`, and attackers can produce it on demand.

When the response depends on the request's `Origin`, send **`Vary: Origin`**.
Otherwise a CDN caches the response with `Allow-Origin: https://app.example.com`
and serves it to `https://admin.example.com`, which then fails with a CORS error
nobody can reproduce locally.

## CORS is not a security control for your server

CORS is enforced by browsers, on behalf of users, against other websites. It
does nothing about:

- **`curl`, Postman, scripts and servers.** They ignore CORS entirely. Your API
  must authenticate and authorise every request as if CORS did not exist.
- **CSRF.** A simple cross-site `POST` (a form, or `text/plain` fetch) reaches
  your server and runs with the user's cookies; CORS only hides the response.
  Defend with `SameSite` cookies, anti-forgery tokens or `Origin` checks (see
  [web security basics](web-security-basics.md)).
- **Side effects of blocked requests.** Tested in Express 5 with the `cors`
  package: a request from a non-allowed origin still runs the handler and gets a
  200; the package only omits the `Allow-Origin` header. For a simple request,
  "CORS error" in the console can mean the record was already created.

The one way CORS hurts security is misconfiguration: reflecting any origin with
credentials, or trusting `null`. It can weaken the same-origin policy; it can
never strengthen your API. See [OWASP API Top 10](owasp-api-top-10.md) for
security misconfiguration more broadly.

## Configuring it: Express and ASP.NET Core

Express 5 with the `cors` package:

```js
import express from 'express';
import cors from 'cors';

const app = express();
const allowed = new Set(['https://app.example.com']);

app.use(cors({
  origin: (origin, cb) => cb(null, !origin || allowed.has(origin)),
  credentials: true,
  exposedHeaders: ['Location', 'ETag', 'Retry-After'],
  maxAge: 3600,
}));
```

`origin` is `undefined` for non-browser requests and same-origin GETs, which is why
the callback lets it through: blocking it would not stop `curl`, only your own
health checks. Registering `cors()` with `app.use` before your routes and auth
answers preflights with 204 automatically. The old `app.options('*', cors())`
throws in Express 5 because path-to-regexp v8 requires named wildcards
(`'/{*splat}'`). With a function or list, the package adds `Vary: Origin` to
responses for origins it allows but, tested, adds nothing when it rejects one.
If a CDN caches these responses, set `Vary: Origin` yourself on every response.

ASP.NET Core:

```cs
builder.Services.AddCors(o => o.AddPolicy("spa", p => p
    .WithOrigins("https://app.example.com")          // no trailing slash
    .WithMethods("GET", "POST", "PUT", "DELETE")
    .WithHeaders("Authorization", "Content-Type")
    .WithExposedHeaders("Location", "ETag", "Retry-After")
    .AllowCredentials()
    .SetPreflightMaxAge(TimeSpan.FromHours(1))));

var app = builder.Build();
app.UseRouting();              // only if you call it explicitly
app.UseCors("spa");            // after routing, before auth
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
```

Ordering is the classic bug. The documented order is after `UseRouting` and
before `UseAuthentication`/`UseAuthorization`; move it later and a 401 from the
auth layer goes out without CORS headers, so the browser reports a CORS error
instead of the real status. The same applies to custom auth middleware that
rejects the token-less `OPTIONS` preflight. Combining
`AllowAnyOrigin()` with `AllowCredentials()` throws when the policy is built,
which is the framework enforcing the rule above. You can also apply policies
per endpoint with `.RequireCors("spa")` or `[EnableCors("spa")]`. The
[CORS and static files project](../../csharp/24-cors-and-static-files/) has a
runnable version.

## Dev proxies and debugging

In development, avoid CORS altogether by making the API same-origin. Vite's
`server.proxy` forwards `/api` from `localhost:5173` to your API, so the
browser sees one origin. The same pattern works in production: serve the SPA
and API behind one reverse proxy and CORS disappears.

When a CORS error appears, check in this order:

1. The Network tab: was there an `OPTIONS` request, and what status did it get?
2. Did the real response come back as a 500 or 502? Error pages generated by a
   proxy or a crashed handler usually lack CORS headers, so the browser reports
   a CORS error and hides the real failure.
3. Does `Allow-Origin` match exactly, including scheme and port?
4. With credentials: is it `*`, and is `Allow-Credentials: true` present?

`mode: 'no-cors'` never fixes any of this: it produces an opaque response with
status 0 that your code cannot read.

## What you should be able to answer

- What exactly does the same-origin policy block, and what does it still allow?
- Which requests trigger a preflight, and why does an auth middleware placed before CORS break them?
- Why can you not use `Access-Control-Allow-Origin: *` with credentials, and how do you reflect the origin safely?
- Your frontend reads `null` from `res.headers.get('Location')` after a 201. Why?
- Why is CORS not a defence against CSRF or against someone calling your API with `curl`?
- Why do you need `Vary: Origin` when the allowed origin is dynamic?
