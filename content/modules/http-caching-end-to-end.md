# HTTP caching end to end

"How would you cache this?" is a favourite follow-up in both frontend and
backend interviews, and the weak answer lists headers. The strong answer
follows one request through the browser, the CDN and your server, and says
which header each layer reads. This guide does that walk; the overview of
cache layers and invalidation is in [caching strategies](caching-strategies.md).

## The layers a GET passes through

```text
fetch / navigation
  -> service worker (if registered: your code decides)
  -> browser HTTP cache (private)
  -> CDN / reverse proxy (shared)
  -> your server: output cache, then the handler
```

Each cache asks the same three questions, defined in RFC 9111:

1. **May I store this?** `no-store` says no. A shared cache also refuses
   responses marked `private`, and responses to requests carrying
   `Authorization` unless you add `public`, `s-maxage` or `must-revalidate`.
2. **Is my copy fresh?** Fresh if its age is below its freshness lifetime,
   taken from `s-maxage` (shared caches only), then `max-age`, then `Expires`,
   then a heuristic.
3. **If stale, can I revalidate instead of refetching?** Only if the response
   carried a validator: `ETag` or `Last-Modified`.

The heuristic is the trap. A response with `Last-Modified` and no
`Cache-Control` may be treated as fresh for about 10% of its age: a file last
modified 30 days ago can be reused for three days without asking. That is how an
`index.html` without explicit headers ends up stale after a deploy. **Always
send `Cache-Control` explicitly**, even if it is just `no-cache`.

## Response directives, precisely

| Directive | Browser cache | Shared cache |
|---|---|---|
| `max-age=N` | Fresh for N seconds | Fresh for N seconds unless `s-maxage` is set |
| `s-maxage=N` | Ignored | Fresh for N seconds; overrides `max-age` |
| `no-cache` | Store, but revalidate before every reuse | Same |
| `no-store` | Do not store | Do not store |
| `private` | Store | Do not store |
| `public` | Store | Store, even if the request had `Authorization` |
| `must-revalidate` | Once stale, never serve without revalidating | Same |
| `immutable` | Do not revalidate while fresh, even on reload | Mostly ignored |
| `stale-while-revalidate=N` | Serve stale up to N s while refreshing in the background | Same, where supported |
| `stale-if-error=N` | Rarely honoured | Serve stale up to N s if the origin errors |

Combining them is where the value lies:

```http
Cache-Control: public, max-age=60, s-maxage=600, stale-while-revalidate=30, stale-if-error=86400
```

The browser keeps it for a minute; the CDN keeps it for ten, serves a stale
copy for 30 seconds while fetching a new one, and keeps serving the old copy
for a day if your origin goes down. The short browser lifetime matters because
**you can purge a CDN but you cannot purge a browser**. Anything a browser has
cached as fresh stays fresh until it expires.

Many CDNs also read targeted headers that only they see, so you can set a long
CDN lifetime without leaking it to browsers or intermediate proxies:
`CDN-Cache-Control` (RFC 9213) or a vendor header such as
`Cloudflare-CDN-Cache-Control`.

## Validators and conditional requests

When a cached copy is stale, the cache sends a conditional request:

```http
GET /api/products/42
If-None-Match: "a1b2"
If-Modified-Since: Tue, 22 Sep 2026 10:00:00 GMT

HTTP/1.1 304 Not Modified
ETag: "a1b2"
Cache-Control: max-age=60
```

The 304 has no body, and its headers refresh the stored copy's freshness.
`If-None-Match` wins when both are present. Details that separate a mid-level
answer from a junior one:

- **Strong vs weak ETags.** `"a1b2"` means byte-identical; `W/"a1b2"` means
  semantically equivalent. `If-None-Match` uses weak comparison, so weak tags
  are fine for 304s; `If-Match` for concurrency requires strong ones. nginx
  downgrades strong ETags to weak when it compresses on the fly.
- **`Last-Modified` has one-second resolution.** Two edits in the same second
  look identical. Prefer ETags for data that changes fast.
- **A 304 saves bandwidth, not the round trip or your database query**, unless
  you compute the ETag cheaply (a row version column) before loading the whole
  object graph.

A surprise worth knowing: send `If-None-Match` yourself from `fetch` (browser
or Node 24) and the spec adds `Cache-Control: no-cache` and `Pragma: no-cache`
to the request. Express's freshness check treats a request `no-cache` as
"always send the full response", so you get a 200 instead of a 304. Tested:
the same request via `node:http`, or with `cache-control: max-age=0` set
explicitly, gets its 304.

## Vary and cache keys

A cache keys on method plus URL. `Vary` adds request headers to the key:

```http
Vary: Accept-Encoding, Accept-Language
```

Every distinct combination is a separate entry, so choose carefully.
`Vary: User-Agent` produces thousands of variants and effectively disables the
CDN; `Vary: Cookie` does the same for logged-in traffic; `Vary: *` means
"never reuse". If a response differs per user, do not vary on the cookie: mark
it `private` and keep it out of shared caches entirely. If it differs by
origin because you reflect CORS headers, you need `Vary: Origin` (see
[CORS explained](cors-explained.md)).

Query strings are part of the key too: `?utm_source=x` is a new entry unless
your CDN ignores marketing parameters.

## Fingerprinted assets vs index.html

Vite, the .NET static-asset pipeline and every other modern bundler put a
content hash in filenames. That gives you two policies:

| File | Header | Why |
|---|---|---|
| `/assets/app.3f9a1c.js` | `public, max-age=31536000, immutable` | New content means a new URL; the old URL never changes |
| `/index.html`, SPA routes | `no-cache` | Always revalidate, so a deploy is visible on the next load |
| `/api/...` per user | `private, no-cache` or `no-store` | Personal data never in a shared cache |

Deploy order matters. Upload the new assets first, then switch `index.html`.
And **keep the previous build's assets for a while**: a user with the old
`index.html` open will lazy-load `settings.8b1e.js` an hour later, and if you
deleted it they get a `ChunkLoadError` (Vite reports a failed dynamic import).
Many teams also catch that error and reload the page once.

## Purging a CDN

Purging removes copies from the CDN's edges. You have three granularities:

- **By URL** — precise, but you must know every URL, including query-string
  variants.
- **By tag / surrogate key** — the origin labels responses
  (`Surrogate-Key: product-42 category-7`, or `Cache-Tag` on Cloudflare) and you
  purge everything tagged `product-42` when that product changes.
- **Everything** — a stampede of cache misses onto your origin at the worst
  moment.

Fingerprinted assets never need purging, and no purge reaches a browser.

## Walking one request through

A logged-out visitor opens `/products/42` on a React SPA backed by an API.

1. **Browser, `index.html`**: cached with `no-cache`, so it sends
   `If-None-Match`. The CDN has a fresh copy (`s-maxage=60`) and answers 304
   without touching your server.
2. **Browser, `app.3f9a1c.js`**: fresh and `immutable`, served from disk with
   no request at all. DevTools shows "(disk cache)".
3. **`GET /api/products/42`**: the browser has nothing. The CDN copy is 70
   seconds old against `s-maxage=60, stale-while-revalidate=30`, so the CDN
   returns the stale body immediately with an `Age: 70` header and fetches a
   fresh one in the background.
4. **Origin**: the output cache has the response, keyed by route, and returns
   it without running the handler or touching the database.
5. **Admin edits product 42**: the handler evicts the output-cache tag and
   calls the CDN's purge-by-tag API. The next visitor gets fresh data; a
   visitor who fetched it 20 seconds ago keeps their browser copy until its
   `max-age` expires.

Debug each hop with `curl -I`, the `Age` header, and the CDN's status header
(`Cache-Status`, RFC 9211, or a vendor one such as `cf-cache-status`).

## Server-side: ASP.NET Core and Express

In ASP.NET Core, three different features are easily confused:

- **`[ResponseCache]` / response caching middleware** sets `Cache-Control` and
  stores responses the way an HTTP cache would. Clients can bypass it with
  `Cache-Control: no-cache`, and it will not store responses to authenticated
  requests.
- **Output caching** (`AddOutputCache`, `.CacheOutput()`) is a server cache
  controlled by your policies, with tag eviction and stampede locking. It does
  not set any `Cache-Control` header for browsers or CDNs: you still have to.
- **`MapStaticAssets`** (.NET 9+) fingerprints files at build time, serves
  pre-compressed variants, and sends strong ETags plus long-lived headers for
  fingerprinted URLs.

The details of the first two are in [caching in ASP.NET Core](dotnet-caching.md).

In Express 5, `res.send` and `res.json` add a weak ETag and answer conditional
requests with 304 automatically. For static files, set the two policies above:

```js
import express from 'express';
import path from 'node:path';

const app = express();

app.use('/assets', express.static('dist/assets', {
  maxAge: '1y', immutable: true, fallthrough: false, // missing asset: 404, not index.html
}));

app.get('/{*splat}', (req, res) =>
  res.set('Cache-Control', 'no-cache').sendFile(path.resolve('dist/index.html')));
```

`fallthrough: false` matters: without it, a request for a deleted chunk falls
through to the SPA catch-all and gets `index.html` with a 200, which the
browser then tries to execute as JavaScript. The `'/{*splat}'` syntax is
Express 5's path-to-regexp v8; the old `'*'` throws.

## What you should be able to answer

- What is the difference between `max-age` and `s-maxage`, and why would you set a short browser lifetime but a long CDN lifetime?
- A response has `Last-Modified` but no `Cache-Control`. How long can a browser reuse it, and why is that dangerous for `index.html`?
- Walk through what happens when a cached copy is stale and has an ETag. What does a 304 save and what does it not save?
- Why is `Vary: Cookie` usually a mistake, and what would you do instead?
- After a deploy, users see `ChunkLoadError`. What caused it and how do you prevent it?
- How do ASP.NET Core output caching and response caching differ in who controls them and whether they set headers?
