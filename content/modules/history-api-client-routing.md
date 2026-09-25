# The History API and client-side routing

Every single-page app has a router, and React Router, TanStack Router and Next.js all sit
on the same few browser primitives. Interviewers ask how client-side routing works to see
whether you understand what the library does for you: why a deep link 404s on refresh,
why `pushState` does not fire `popstate`, and what a hand-rolled router forgets about
Ctrl+click, scroll position and focus.

## What "client-side routing" means

In a traditional multi-page site, clicking a link makes the browser request a new document.
In an SPA, a script intercepts the navigation, changes the URL without a request, and
renders the new view itself. Three things must stay in sync:

1. **The URL**, so it can be bookmarked, shared and reloaded.
2. **The history stack**, so Back and Forward work.
3. **The rendered view**, which your code draws from the URL.

The rule that keeps a router simple: the URL is the source of truth, and the view is a
function of it. Every way of changing the URL (a click, Back, a redirect after saving)
should end in the same `render(location)` call.

## The History API

```js
history.pushState({ scrollY: 0 }, '', '/orders/42'); // new entry; URL changes, no request
history.replaceState(state, '', '/orders?sort=date'); // overwrite the current entry
history.back();    // same as the Back button
history.go(-2);    // two entries back
history.state;     // the state object of the current entry
```

| Call | History length | Fires `popstate` | Typical use |
| --- | --- | --- | --- |
| `pushState` | +1 | no | navigating to a new page |
| `replaceState` | unchanged | no | filters, sort order, redirects, fixing a URL |
| Back / Forward / `history.go()` | unchanged | yes | the user moving through history |

The second argument (`title`) is ignored by browsers; set `document.title` yourself. The
new URL must be same-origin, or the call throws. The state object is structured-cloned, so
it can hold plain data but not functions or DOM nodes, and it is restored when the user
comes back to that entry, even after a reload.

`pushState` and `replaceState` **do not** fire `popstate`. That surprises everyone once: your
code changed the URL, so your code already knows, and must render. `popstate` only tells
you about navigations your code did not make.

## A minimal router

```js
const routes = [
  { pattern: new URLPattern({ pathname: '/orders/:id' }), view: orderView },
  { pattern: new URLPattern({ pathname: '/orders' }), view: ordersView },
];

function render() {
  const match = routes.find((r) => r.pattern.test(location.href));
  const params = match?.pattern.exec(location.href).pathname.groups ?? {};
  (match?.view ?? notFoundView)(params, new URLSearchParams(location.search));
}

function navigate(url, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState'](null, '', url);
  render();
}

window.addEventListener('popstate', render);
render();
```

`URLPattern` is newer; plain regular expressions work if you need wider support.

## Intercepting link clicks properly

Routers render real `<a href>` elements and intercept clicks, so links still work as links:
they can be opened in a new tab, copied and crawled. The interception must know when to
stay out of the way:

```js
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a) return;
  if (e.defaultPrevented || e.button !== 0) return;               // not a plain left click
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;   // new tab / window / download
  if (a.target && a.target !== '_self') return;
  if (a.hasAttribute('download')) return;
  const url = new URL(a.href);
  if (url.origin !== location.origin) return;                     // external link

  e.preventDefault();
  navigate(url.pathname + url.search + url.hash);
});
```

Forgetting the modifier-key check is the classic bug: Ctrl+click and Cmd+click stop opening
new tabs, and power users notice immediately.

## Deep links and the server

Load `https://app.example.com/orders/42` directly, or press F5 there, and the browser asks
the **server** for `/orders/42`. A static host that only knows about `index.html` returns
404. The fix is on the server: a fallback rewrite that serves `index.html` for any path
that is not a real file (for example `try_files $uri /index.html` in nginx,
`MapFallbackToFile("index.html")` in ASP.NET Core, or a rewrite rule on your static host).
API routes should be excluded, so a missing API endpoint still returns a real 404.

Hash routing (`/#/orders/42`) avoids this because the fragment is never sent to the server,
at the cost of uglier URLs and fragments no longer being usable for in-page anchors. It is
still useful on hosts you cannot configure. The [hash router](../../react/42-hash-router/)
project builds one; [the router project](../../60-router/) builds the History API version.

## `pushState` or `replaceState`?

Ask: "Should Back return here?"

- **Push** for real page changes: list to detail, detail to edit.
- **Replace** for changes the user would not think of as a page: typing in a filter box,
  changing sort order, switching tabs within a view, correcting a URL
  (`/orders/42` to `/orders/42-blue-widget`).
- **Replace after a redirect**, such as after login or after creating a record, so Back does
  not return to the login form or re-open a form that would submit again.

Pushing an entry on every keystroke in a search box makes Back step through each letter,
which is one of the most common routing complaints in usability testing.

## What the browser used to do for you

A full page load gave you several things for free that a client router must now handle:

| Concern | What to do in a client router |
| --- | --- |
| Scroll position | scroll to top on push; restore on Back (store `scrollY` in state, set `history.scrollRestoration = 'manual'` if you manage it yourself) |
| Page title | set `document.title` for every route |
| Focus | move focus to the new page's `<h1>` or main region so keyboard and screen reader users know the page changed |
| Announcements | optionally announce the new title in a polite live region |
| Hash links | scroll to the fragment's element after rendering |
| Leaving with unsaved changes | block the navigation with a prompt; `beforeunload` only covers leaving the document |

Focus and announcements matter for accessibility; see
[accessibility fundamentals](accessibility-fundamentals.md).

## Back/forward cache

Browsers may keep a whole page in memory when the user navigates away to another document
and restore it instantly on Back, without re-running scripts. Your page then shows whatever
it showed before, which may be stale (a cart count, a login state). Listen for
`pageshow` and check `event.persisted` to refresh data. Pages with an `unload` listener or
`Cache-Control: no-store` are often excluded, which makes Back slower.

## The Navigation API

The newer Navigation API was designed to replace the History API for routers. A single
`navigate` event fires for **every** navigation, including link clicks, form submissions,
Back and Forward and your own calls, and you opt in to handling it:

```js
navigation.addEventListener('navigate', (event) => {
  if (!event.canIntercept || event.hashChange || event.downloadRequest) return;
  const url = new URL(event.destination.url);
  event.intercept({ handler: () => render(url) });
});
```

No click interception, no modifier-key checks, and the browser shows its loading indicator
and handles focus and scroll by default. It arrived in Chromium first and later in other
engines; check support for your audience before dropping the History API version.

## What you should be able to answer

- How does a client-side router change the URL without a page load, and what keeps the view
  in sync with it?
- Why does `pushState` not fire `popstate`, and when does `popstate` fire?
- Why does refreshing a deep link return 404 on a static host, and how do you fix it?
- When should you use `replaceState` instead of `pushState`?
- What must a click-intercepting router check so Ctrl+click and external links still work?
- What does a client router have to handle that a full page load did for free?
