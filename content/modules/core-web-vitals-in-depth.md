# Core Web Vitals in depth

"How would you improve this page's performance?" has become "which Core Web
Vital is failing, and why?" Knowing the three names and thresholds is the
screening answer. A mid-level answer breaks each metric into its parts, names
the usual cause of each part, and says how you'd confirm it with data. That's
what this guide covers; [the browser rendering guide](browser-rendering-and-network.md)
has the pipeline underneath.

## The three metrics and their thresholds

| Metric | Measures | Good | Poor |
|---|---|---|---|
| LCP, Largest Contentful Paint | Loading: when the main content is rendered | ≤ 2.5 s | > 4.0 s |
| INP, Interaction to Next Paint | Responsiveness: delay from input to the next frame | ≤ 200 ms | > 500 ms |
| CLS, Cumulative Layout Shift | Visual stability: unexpected movement | ≤ 0.1 | > 0.25 |

A page "passes" when the **75th percentile** of real visits is good for all
three, assessed separately for mobile and desktop. INP replaced First Input
Delay in March 2024; FID only measured the delay before the first handler ran,
so pages with slow handlers passed it easily.

## LCP: what counts, and the four sub-parts

The LCP candidate is the largest element in the viewport among: `<img>`,
`<image>` inside SVG, a `<video>`'s poster or first frame, an element with a
CSS `background-image` loaded via `url()`, and block-level elements containing
text. The browser reports new candidates as larger ones render and stops at the
first user input (tap, click or key press; not scrolling).

Every LCP time splits into four parts, and each has a different fix:

| Sub-part | Ends when | Typical cause of a large value | Fix |
|---|---|---|---|
| Time to First Byte | First byte of HTML arrives | Slow server, no CDN, redirects | Cache HTML at the edge, speed up queries, remove redirect chains |
| Resource load delay | LCP resource starts downloading | Image discovered late: CSS background, injected by JS, `loading="lazy"` | Put it in the HTML as `<img>`, `fetchpriority="high"`, preload |
| Resource load duration | LCP resource finishes downloading | Oversized image, slow CDN | Right-size with `srcset`, AVIF/WebP, image CDN |
| Element render delay | Element is painted | Render-blocking CSS/JS, client-side rendering, font blocking text | Inline critical CSS, `defer` scripts, SSR, `font-display` |

For a text LCP element, the resource phases are zero and the time is TTFB plus
render delay. Google's field data shows that on most slow sites, TTFB and load
delay dominate, not the image download itself, so "compress the hero image" is
often the wrong first move.

```html
<!-- An LCP image that the preload scanner finds immediately -->
<img src="/hero-1200.avif" srcset="/hero-800.avif 800w, /hero-1200.avif 1200w"
     sizes="100vw" width="1200" height="600" fetchpriority="high" alt="…">
```

## INP: every interaction, three phases

INP observes clicks, taps and key presses throughout the visit (not scrolling
or hovering) and reports roughly the worst one: the single worst for most
pages, ignoring one outlier for every 50 interactions on very busy pages. Each
interaction's latency has three phases:

| Phase | What happens | Usual cause | Fix |
|---|---|---|---|
| Input delay | Event waits for the main thread | Another long task is running: hydration, third-party script, timer | Break up long tasks, defer non-critical JS |
| Processing duration | Your event handlers run | Heavy handler: filtering thousands of rows, synchronous state updates | Do less; yield; move work to a worker |
| Presentation delay | Browser renders the next frame | Huge DOM, expensive layout, forced reflow | Smaller DOM, virtualisation, `content-visibility` |

The key technique is **yielding**: do the work needed for immediate visual
feedback, then let the browser paint before continuing.

```js
button.addEventListener('click', async () => {
  showSpinner();                 // visible change first
  await scheduler.yield();       // let the browser paint the next frame
  applyExpensiveFilter();        // then the heavy work
});
```

`scheduler.yield()` is not yet in every browser, so feature-detect it and fall
back to `await new Promise((r) => setTimeout(r, 0))`, which also yields but
sends the rest of your work to the back of the task queue. In React, wrapping
non-urgent updates in `startTransition` lets React render them interruptibly,
and `useDeferredValue` keeps an input responsive while a slow list catches up.

## CLS: session windows and expected shifts

A layout shift is scored as impact fraction (how much of the viewport moved)
times distance fraction (how far it moved). CLS groups shifts into **session
windows**: shifts less than one second apart, capped at five seconds per
window. The page's CLS is the largest window, not the lifetime total, so a
long-lived SPA isn't punished simply for being open for hours.

Shifts within 500 ms of a discrete user input (click, tap, key press) are
excluded as expected. Animations using `transform` don't count as shifts,
because they don't move other content.

| Cause | Fix |
|---|---|
| Images and iframes without dimensions | `width`/`height` attributes, or CSS `aspect-ratio` |
| Ads, embeds and banners inserted above content | Reserve space with `min-height`; insert below the viewport; overlay |
| Web fonts swapping in with different metrics | `size-adjust` and metric overrides on the fallback `@font-face`; `font-display: optional` |
| Content loaded after render (reviews, recommendations) | Skeletons of the final size |
| Animating `top`, `height` or `margin` | Animate `transform` instead |

## Metrics that support the vitals

Some metrics aren't Core Web Vitals but explain them:

- **TTFB** (good ≤ 0.8 s) is part of LCP; fix it first if it's large.
- **FCP** (first contentful paint, good ≤ 1.8 s) shows when anything appears;
  a big gap between FCP and LCP points to late discovery or client rendering.
- **TBT** (Total Blocking Time) is Lighthouse's lab stand-in for INP: the sum of
  the parts of long tasks over 50 ms during load. A page load has no
  interactions, so lab tools can't measure INP directly.
- **Long Animation Frames (LoAF)** attribute slow frames to scripts in the
  field, which is how you find which script caused a poor INP.

## Single-page apps and the back/forward cache

Core Web Vitals are measured per page load. In an SPA, client-side route
changes don't produce new LCP entries, and INP and CLS accumulate across all
the "pages" in one document. Chrome is developing soft-navigation measurement,
but for now your own RUM should tag metrics with the route the user was on when
they happened.

Back/forward cache restores are counted as separate page visits with
near-instant loads, which improves your p75. Pages lose bfcache eligibility if
they use `unload` handlers, among other things. Remove them; use
`pagehide` or `visibilitychange` instead.

## A diagnosis routine

1. **Start with field data**: which metric fails, on which device class, on
   which templates. CrUX in PageSpeed Insights, or your own RUM
   ([measuring performance](measuring-performance-rum-vs-lab.md)).
2. **Break it down**: LCP sub-parts, INP phases, or the CLS source elements.
   The `web-vitals` attribution build reports these per visit.
3. **Reproduce in the lab**: DevTools Performance panel with CPU and network
   throttling matching your p75 device, not your laptop.
4. **Fix the largest part first**, then confirm in the field, which takes days
   for your RUM and about four weeks for CrUX.

## What you should be able to answer

- What are the thresholds for LCP, INP and CLS, and why the 75th percentile?
- Name the four sub-parts of LCP and a fix for each.
- What three phases make up an interaction's latency, and how does yielding
  help?
- How does CLS use session windows, and which shifts are excluded?
- Why can't Lighthouse report INP, and what does it show instead?
- Why do Core Web Vitals behave differently in a single-page app?
