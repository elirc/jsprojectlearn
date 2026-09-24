# What the browser does with a URL

"What happens when you type a URL and press enter?" is asked because it has no
bottom — an interviewer can follow your answer as deep as your understanding
goes. This guide gives you a structure and enough depth at each layer to be
useful when a page is slow.

## The stages

1. **URL parsed** — scheme, host, port, path, query, fragment. The fragment
   (`#section`) is never sent to the server.
2. **DNS** — hostname to IP. Cached in the browser, the OS, and the resolver, so
   usually free; on a cold lookup it is a real round trip.
3. **TCP handshake** — one round trip to establish the connection.
4. **TLS handshake** — one or two more, for certificate validation and key
   agreement. TLS 1.3 cut this down; session resumption avoids it entirely on
   repeat visits.
5. **HTTP request sent**, server responds with HTML.
6. **Parse** — HTML becomes the DOM, CSS becomes the CSSOM.
7. **Render** — style, layout, paint, composite.
8. **Scripts run** and mutate the DOM, and the browser redoes whatever changed.

Steps 2–4 are *connection cost*: roughly 3–4 round trips before a single byte of
your HTML arrives. On a 100ms connection that is 400ms you cannot optimise with
code — only with fewer origins, connection reuse, and edge servers closer to the
user.

## Parsing and the critical path

The parser builds the DOM as bytes arrive. Two things interrupt it:

- **`<script>` with no attribute** blocks parsing: the browser must fetch and
  execute it before continuing, because the script might `document.write`.
- **CSS blocks rendering** (not parsing). The browser will not paint until it has
  the CSSOM, to avoid a flash of unstyled content.

```html
<script src="app.js"></script>          <!-- blocks the parser -->
<script src="app.js" defer></script>    <!-- parallel fetch, runs after parse, in order -->
<script src="app.js" async></script>    <!-- parallel fetch, runs on arrival, order not guaranteed -->
<script type="module" src="app.js"></script>  <!-- deferred by default -->
```

Use `defer` (or a module) for app code. `async` is for independent things like
analytics, where order does not matter.

## The rendering pipeline

**Style** → **Layout** → **Paint** → **Composite**

Which stage your change triggers determines its cost:

- Changing `width`, `top`, or adding an element → **layout** (reflow), then
  paint, then composite. Most expensive.
- Changing `background-color` → **paint** and composite.
- Changing `transform` or `opacity` → **composite** only. Cheapest, and it can
  run on the GPU off the main thread.

That is why smooth animation uses `transform` and `opacity` rather than `left`
and `width`.

### Layout thrashing

The browser batches style writes. Reading a geometry property forces it to flush
and compute layout immediately:

```js
// Thrashing: read, write, read, write — forced layout every iteration
for (const el of items) {
  el.style.height = el.offsetHeight * 2 + 'px';
}

// Batched: all reads, then all writes
const heights = items.map((el) => el.offsetHeight);
items.forEach((el, i) => { el.style.height = heights[i] * 2 + 'px'; });
```

Geometry properties that force layout: `offsetTop/Height`, `clientWidth`,
`scrollTop`, `getBoundingClientRect()`, `getComputedStyle()`.

## The main thread

JavaScript, layout, paint and event handling all share one thread. A task over
~50ms is a **long task**: during it, the page cannot respond to clicks or paint
a frame. At 60fps you have 16.7ms per frame, and the browser needs some of that.

The fixes, in order: do less work, do it in smaller chunks (yield between
them), do it in a Web Worker, or do it on the server.

`requestAnimationFrame` schedules a callback just before the next paint, which
is the right place for visual updates — and it pauses in background tabs,
unlike `setInterval`.

## Core Web Vitals

Worth knowing by name — they are how performance gets discussed in real teams:

- **LCP** (Largest Contentful Paint) — when the main content appears. Under
  2.5s. Usually dominated by server response time and render-blocking resources.
- **INP** (Interaction to Next Paint) — responsiveness to input. Under 200ms.
  Long tasks are the enemy.
- **CLS** (Cumulative Layout Shift) — how much content jumps around. Under 0.1.
  Caused by images without dimensions, injected banners, and late-loading fonts.

## Caching layers

A request may be answered without ever reaching your server:

1. **Memory cache** — this page load
2. **Disk cache** — governed by `Cache-Control` / `ETag`
3. **Service worker** — programmable, if the app registered one
4. **CDN / proxy** — shared cache near the user
5. **Your server**

This is why "I deployed but users see the old version" has several possible
answers, and why hashed filenames plus a short-cached HTML shell is the standard
pattern.

## Debugging a slow page

Open devtools and work in this order:

1. **Network tab.** Is the HTML slow to arrive (server problem) or is everything
   after it slow (frontend problem)? Look at the waterfall for serialised
   requests that could be parallel.
2. **Coverage tab.** How much of the CSS and JavaScript you shipped is actually
   used?
3. **Performance tab.** Record an interaction. Long tasks appear as red-flagged
   blocks; the flame chart says what is inside them.
4. **Lighthouse.** A decent checklist, not a verdict.

The one rule: **measure before optimising.** Most guesses are wrong, and an
unnecessary optimisation is complexity you keep paying for.

## Cheap wins, in rough order of value

- Compress responses (brotli/gzip)
- Serve images in a modern format, sized correctly, with `width`/`height` set
- `defer` your scripts
- `font-display: swap` and preload the font you actually use
- Cache static assets with a content hash and a long max-age
- Split the bundle by route
- Put static assets on a CDN

## The 60-second answer

> DNS, TCP, TLS — three or four round trips before any bytes, which is why
> connection reuse and edge caching matter. Then the HTML arrives and the parser
> builds the DOM, pausing for any blocking script. CSS builds the CSSOM and
> blocks first paint. Then style, layout, paint, composite. JavaScript shares
> the main thread with all of that, so a long task blocks both input and
> rendering. When a page is slow I check whether it is the server or the client
> first — the network waterfall tells me that in about ten seconds.
