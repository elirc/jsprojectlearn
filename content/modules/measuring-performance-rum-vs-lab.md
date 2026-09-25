# Measuring performance: field versus lab

"The page is fast on my machine" is where most performance work goes wrong.
Your laptop on office Wi-Fi is not your users' three-year-old Android phone on
a train. Interviewers ask "how would you know if the site got slower?" and
"why does Lighthouse disagree with Search Console?" to find out whether you
understand the two kinds of data and when each one is trustworthy.

## Two kinds of data

| | Lab (synthetic) | Field (real user monitoring, RUM) |
|---|---|---|
| Source | A scripted load on a controlled machine | Real visits, measured in real browsers |
| Tools | Lighthouse, DevTools Performance panel, WebPageTest | CrUX, the `web-vitals` library, commercial RUM |
| Strength | Repeatable, debuggable, available before release | Shows what users actually experience |
| Weakness | One device, one network, no real interactions | Noisy, delayed, harder to debug |
| Measures INP? | No (TBT as a proxy) | Yes |
| Best for | Diagnosing causes, catching regressions in CI | Deciding what to fix, proving the fix worked |

The rule: **field data tells you whether there's a problem; lab data tells you
why.** When they disagree, the field is right about the user experience, and
the disagreement is a clue: lab runs usually use a cold cache, a single
location, no logged-in state and none of the variety of real devices.

## Lab tools and how to use them well

**Lighthouse** loads the page once with simulated throttling (a mid-range
mobile CPU and a slow 4G connection by default) and reports metrics, a score
and diagnostic "insights". Use it to find problems, not as a target. Scores vary
between runs because of CPU load, network conditions and third-party responses;
compare the median of several runs on the same machine.

**The DevTools Performance panel** records what the main thread actually did.
Recent versions show live LCP, INP and CLS for your local session next to your
site's CrUX field values, so you can see immediately whether your machine is
representative. Turn on CPU throttling (4x or 6x) and network throttling to
approximate the p75 user. Record an interaction and the flame chart shows the
long task, the functions in it, and any forced layouts.

**WebPageTest** runs on real devices in real locations, records filmstrips and
waterfalls, and can script multi-step journeys. It's the tool for comparing
before and after, or your site against a competitor's.

## CrUX: Google's field data

The Chrome User Experience Report aggregates Core Web Vitals from Chrome users
who have opted in to usage statistics.

- It covers **the previous 28 days**, rolling, so a fix takes about four weeks
  to show fully.
- It reports the **75th percentile** and the good, needs-improvement and poor
  distribution, per origin and for URLs with enough traffic, split by phone and
  desktop.
- It's available in PageSpeed Insights, Search Console, the CrUX API and
  BigQuery (monthly).
- It only includes **public pages with enough traffic**. Logged-in dashboards,
  internal tools and new sites usually have no data.
- It only includes Chrome users, so Safari-heavy audiences are under-represented.

CrUX is what Google search uses for page experience. It's the scoreboard, but
too coarse and slow to debug with.

## Your own RUM with `web-vitals`

For anything CrUX doesn't cover, or when you need detail, collect your own.
Google's `web-vitals` library handles the edge cases (bfcache restores,
background tabs, prerendering, when INP and CLS are final) and reports each
metric once it's ready.

```ts
import { onLCP, onINP, onCLS, type Metric } from 'web-vitals/attribution';

function send(metric: Metric) {
  const body = JSON.stringify({
    name: metric.name, value: metric.value, rating: metric.rating,
    id: metric.id, route: location.pathname,
    attribution: metric.attribution, // e.g. LCP element, slow script
  });
  navigator.sendBeacon('/rum', body) || fetch('/rum', { method: 'POST', body, keepalive: true });
}

onLCP(send); onINP(send); onCLS(send);
```

- **Use a beacon.** INP and CLS are often reported when the page is hidden, and
  an ordinary request may be cancelled then.
- **Use the attribution build.** It adds the LCP element and its sub-part
  timings, the INP target element and phase breakdown (including Long Animation
  Frame script attribution), and the element that shifted most. That's what
  turns "INP is poor" into "the filter button's handler takes 380 ms".
- **Tag every event** with the route, device class, connection type
  (`navigator.connection` where available), app version and whether it was a
  logged-in session, so you can segment later.
- **Sample** on high-traffic sites; 10% of sessions still gives stable
  percentiles.

## Analysing field data correctly

- **Percentiles, not averages.** Report p75 (the Core Web Vitals standard), and
  watch p95 for the users having the worst time. An average hides a bimodal
  distribution such as fast desktop visits and slow mobile ones.
- **Segment before concluding.** An overall regression might be one route, one
  browser or one country. Mobile and desktop should always be separate.
- **Watch the mix.** If a marketing campaign brings in more low-end mobile
  traffic, p75 gets worse without any code change. Compare like with like.
- **Correlate with releases.** Annotate dashboards with deploys so a step
  change points at a specific release.

## Measuring your own code

Standard metrics tell you the page is slow; custom timings tell you which part
of your app is. The User Timing API puts your own marks on the same timeline:

```ts
performance.mark('orders:fetch-start');
const orders = await fetchOrders();
performance.mark('orders:rendered');
performance.measure('orders:load', 'orders:fetch-start', 'orders:rendered');
```

Measures appear in the DevTools Timings track and can be read by a
`PerformanceObserver` and sent with your RUM. On the server, a `Server-Timing`
header exposes database and render times to the browser, which splits a slow
TTFB into its causes without separate tooling:

```http
Server-Timing: db;dur=182;desc="orders query", render;dur=41
```

Cross-origin resources only expose detailed timings if they send
`Timing-Allow-Origin`, so set it on your CDN if you want image and font timing
in RUM. [Logging and observability](logging-and-observability.md) covers the
server-side tracing that pairs with this.

## Lab checks in CI

Field data finds problems after release. To catch them before, run lab checks
on every pull request against a preview deployment:

- **Lighthouse CI** with assertions on metrics and resource sizes, run three to
  five times per URL with the median taken.
- **Bundle budgets** with `size-limit`, which are fast and deterministic
  ([bundle budgets](bundle-budgets-and-code-splitting.md)).
- **Thresholds with headroom.** Fail on clear regressions, warn on small ones;
  a gate that fails on noise gets disabled within a month.

## Putting it together

A realistic workflow for a team:

1. RUM dashboard shows INP p75 on the orders page rose from 180 ms to 340 ms
   after Tuesday's release, mobile only.
2. Attribution data points to the status filter's click handler.
3. Reproduce locally with 6x CPU throttling; the Performance panel shows the
   handler re-rendering a 5,000-row table.
4. Fix (virtualise the table, defer the filter with `startTransition`), verify
   in the lab, and add a Lighthouse CI or interaction test so it can't silently
   return.
5. Confirm INP p75 recovers in RUM over the following days.

## What you should be able to answer

- What's the difference between lab and field data, and which do you trust
  for what?
- Why might Lighthouse show a good LCP while CrUX shows a poor one?
- Why does CrUX have no data for an internal admin app, and what would you do
  instead?
- How would you collect Core Web Vitals from real users, and why use
  `sendBeacon`?
- Why report p75 rather than an average, and why segment by device?
- How would you catch a performance regression before it reached production?
