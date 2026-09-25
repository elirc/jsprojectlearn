# Bundle budgets and code splitting

JavaScript is the most expensive byte on the web: it has to be downloaded,
parsed, compiled and run on the main thread, and on a mid-range phone that
takes several times longer than on your laptop. Bundles grow one reasonable
dependency at a time until the app is slow. Interviewers ask "our bundle is 2
MB, what do you do?" to see whether you measure, split and then stop it
growing again. [Package managers and builds](package-managers-and-builds.md)
explains what a bundler does; this guide is about keeping its output small.

## Why JavaScript size matters more than other bytes

| 300 KB of… | Main-thread cost after download |
|---|---|
| JPEG | Decode (often off the main thread), paint |
| CSS | Parse, then style and layout for matching elements |
| JavaScript | Parse, compile, execute, plus whatever the code does: render, hydrate, attach listeners |

Main-thread time delays both first render in client-rendered apps (LCP) and
every interaction until it finishes (INP). So budgets usually target
JavaScript first, measured as the **compressed** size of what a route loads,
with an eye on the uncompressed size, since that's what gets parsed.

## Step 1: measure what ships

Before changing anything, find out what's in the bundle.

- **Visualise it.** `rollup-plugin-visualizer` for Vite, or
  `source-map-explorer` on any build with source maps. Both draw a treemap of
  bytes per module after tree shaking and minification.
- **Check coverage.** DevTools' Coverage panel shows how much of each loaded
  script actually ran for the current page. 70% unused on the home page is a
  strong hint to split.
- **Check before installing.** Sites like Bundlephobia or pkg-size show a
  package's cost and whether it's tree-shakeable.

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';

export default defineConfig({
  plugins: [react(), visualizer({ filename: 'stats.html', gzipSize: true })],
});
```

The usual findings: a date library with all locales, a whole icon set, a
charting or rich-text library loaded on every page, lodash imported as one
object, and duplicate copies of one package at different versions.

## Step 2: remove before you split

Deleting code beats loading it later.

- **Use the platform.** `Intl.DateTimeFormat`, `Intl.NumberFormat`,
  `structuredClone`, `fetch`, `URLSearchParams` and `Array.prototype.toSorted`
  replace whole libraries.
- **Import precisely.** `import { debounce } from 'lodash-es'` shakes;
  `import _ from 'lodash'` doesn't. Icon libraries should be imported per icon.
- **Deduplicate.** `npm ls <package>` shows why two versions are installed;
  align the ranges or use `overrides`.
- **Target modern browsers.** Down-levelling to old syntax and adding polyfills
  bloats every user's bundle for the benefit of very few.
- **Check `sideEffects`.** Tree shaking relies on the package telling the
  bundler which files have side effects; mis-declared packages keep dead code.

## Step 3: split by route, then by interaction

A dynamic `import()` creates a split point: the bundler puts that module and
its unique dependencies into a separate chunk loaded on demand.

**By route** is the first and biggest win: the login page shouldn't download
the reports dashboard.

```tsx
import { lazy, Suspense } from 'react';

const Reports = lazy(() => import('./routes/Reports'));

<Route path="/reports" element={
  <Suspense fallback={<PageSpinner />}><Reports /></Suspense>
} />
```

**By interaction** comes next: things most users never open, such as a rich
text editor, a chart library on a secondary tab, an export-to-Excel feature, a
map, or a chat widget.

```ts
exportButton.addEventListener('click', async () => {
  const { exportToXlsx } = await import('./export-xlsx');
  exportToXlsx(rows);
});
```

Framework routers such as React Router's data routers or TanStack Router can
lazy-load both a route's component and its data loader, so the code and data
requests start together rather than one after the other.

## Splitting without making things slower

Code splitting trades bytes up front for latency later. Done badly, it moves
the delay rather than removing it.

- **Waterfalls.** A lazy route that renders, then fetches its data, then lazily
  loads a child component, serialises three round trips. Start data and code
  requests in parallel, at the route level.
- **Prefetch likely next steps.** Call the same `import()` on hover or focus of
  the link, or when the browser is idle, so the chunk is cached by the time
  it's needed. Vite adds `<link rel="modulepreload">` for a chunk's static
  dependencies automatically.
- **Don't over-split.** Hundreds of tiny chunks mean more requests and worse
  compression. Split on real boundaries: routes and heavy, optional features.
- **Handle chunk load failures.** After a deploy, old HTML may reference chunks
  that no longer exist. Catch the error in an error boundary and offer a
  reload, and keep old assets on the CDN for a grace period.

## Caching the chunks

Content-hashed filenames (`Reports-8f2a1c.js`) let you cache every chunk for a
year with `Cache-Control: public, max-age=31536000, immutable`, while the HTML
that references them is revalidated on every visit. Keeping rarely changing
libraries in a separate vendor chunk means a typical deploy only changes your
app chunks, so returning users download less. Bundlers do sensible grouping by
default; reach for `manualChunks` only when the visualiser shows a problem.

## Step 4: enforce a budget in CI

Without a check, the bundle grows back. A budget is a number that fails the
build.

```json
{
  "scripts": { "size": "size-limit" },
  "size-limit": [
    { "name": "initial JS", "path": "dist/assets/index-*.js", "limit": "170 kB" },
    { "name": "reports route", "path": "dist/assets/Reports-*.js", "limit": "90 kB" }
  ]
}
```

`size-limit` measures compressed size and can also estimate execution time on
a slow device. Its GitHub Action comments on each pull request with the size
difference, which puts the conversation in code review where it belongs.
Lighthouse CI can assert on resource sizes and timing metrics against a
deployed preview as well.

How to set the numbers:

| Approach | When it fits |
|---|---|
| Current size plus a small margin | An existing app: stop the growth first |
| Derived from a target, such as LCP under 2.5 s on a mid-range phone on 4G | New apps, or when you have field data |
| Per route | Apps with very different pages, such as marketing versus dashboard |

When a PR breaks the budget, the answer is usually a lazy import or a lighter
dependency. Raising the limit should be a deliberate, reviewed decision with a
reason in the commit message, not the default fix.

## Server rendering and Server Components

Splitting reduces what the client downloads; rendering on the server can
remove whole components from the client bundle. React Server Components run
only on the server, so their code and dependencies, such as a Markdown parser
or a date library used only for display, never ship. Hydration still costs
time for client components, so the same discipline applies to what you mark
`"use client"`. [The modern React guide](modern-react.md) covers the model.

## What you should be able to answer

- Why is 300 KB of JavaScript more expensive than 300 KB of image?
- How do you find out what's in a production bundle?
- Where would you add split points in a typical CRUD admin app?
- How can code splitting make a page slower, and how do you avoid that?
- What does a bundle budget look like in CI, and how do you choose the limit?
- A PR adds 90 KB to the initial chunk. What do you suggest?
