# Browser storage compared

"Where would you store this?" is a favourite interview question because every answer has a
trade-off: cookies travel to the server, `localStorage` blocks and is readable by any
script, IndexedDB is powerful but awkward, and the Cache API is for responses, not data.
A mid-level answer picks by what the data is, who needs to read it, and what an attacker
could do with it.

## The options at a glance

| Store | Size (roughly) | API | Sent to server | Lifetime | Readable by JS |
| --- | --- | --- | --- | --- | --- |
| Cookie | ~4 KB each | `document.cookie`, `Set-Cookie` | on every matching request | session or `Max-Age`/`Expires` | not if `HttpOnly` |
| `sessionStorage` | ~5 MB per origin | sync, strings | never | per tab, until it closes | yes |
| `localStorage` | ~5 MB per origin | sync, strings | never | until cleared | yes |
| IndexedDB | large, share of disk quota | async, structured objects | never | until cleared or evicted | yes |
| Cache API | large, shares the same quota | async, `Request` → `Response` | never | until cleared or evicted | yes |
| In memory (a variable, a store) | RAM | whatever you like | never | until reload | yes |

"Origin" means scheme + host + port: `https://app.example.com` and
`https://admin.example.com` have separate storage, and so do `http://` and `https://`.

## Cookies: the only one the server sees

Cookies exist so the server can recognise a browser across requests. That makes them the
right place for a session identifier and the wrong place for anything else, because every
cookie is added to every matching request, including image and API calls.

```http
Set-Cookie: sid=9f2c…; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1209600
```

- `HttpOnly` hides it from `document.cookie`, so an XSS bug cannot read the session.
- `Secure` sends it only over HTTPS.
- `SameSite=Lax` stops it being sent on cross-site subrequests such as a `POST` from
  another site, which blocks most CSRF. Chromium assumes `Lax` when the attribute is
  missing, but not every browser does, so always set it explicitly.

Reading cookies from JavaScript is clumsy (`document.cookie` is one long string; the newer
async `cookieStore` API is nicer), but in practice the frontend should rarely touch them. The details of sessions versus tokens are in
[auth, sessions and JWTs](auth-sessions-jwt.md).

## Web Storage: `localStorage` and `sessionStorage`

The simplest API on the platform, and the most over-used.

```js
localStorage.setItem('prefs', JSON.stringify({ theme: 'dark', pageSize: 50 }));
const prefs = JSON.parse(localStorage.getItem('prefs') ?? '{}');

localStorage.setItem('count', 3);
typeof localStorage.getItem('count'); // 'string' — everything is stringified
```

What to know about it:

- **Strings only.** Numbers come back as strings, objects need `JSON.stringify`, and
  `Date` objects come back as ISO strings you must parse again.
- **Synchronous.** Every call blocks the main thread while the browser reads from disk.
  Fine for a few small values at start-up; bad for a 2 MB cache read on every keystroke.
- **Can throw.** `setItem` throws `QuotaExceededError` when full, and access can throw in
  some privacy modes or sandboxed iframes. Wrap it in `try/catch` and treat it as a cache,
  never as the only copy of important data.
- **Readable by any script on the origin.** One XSS hole, or one compromised npm package,
  and everything in it is exfiltrated. That is why storing access tokens there is a common
  interview red flag.

`sessionStorage` has the same API but is scoped to a single tab: two tabs on the same page
have separate copies, it survives reloads, and it is gone when the tab closes. It suits
wizard progress or a "return to" URL, not preferences.

### Keeping tabs in sync

The `storage` event fires in *other* tabs of the same origin when `localStorage` changes,
never in the tab that made the change:

```js
window.addEventListener('storage', (e) => {
  if (e.key === 'prefs') applyPrefs(JSON.parse(e.newValue ?? '{}'));
});
```

For richer cross-tab messaging use `BroadcastChannel`, which carries any structured data
without touching storage.

## IndexedDB: a real database in the browser

IndexedDB stores structured-clone values (objects, arrays, `Date`, `Blob`, `File`, `Map`)
in object stores with indexes and transactions, and it is asynchronous, so it does not
block rendering. It is the right home for offline data, drafts with attachments, and
anything larger than a few hundred kilobytes.

The raw API is event-based and verbose, so most teams use a thin promise wrapper such as
`idb` or a library like Dexie:

```js
import { openDB } from 'idb';

const db = await openDB('notes', 1, {
  upgrade(db) {
    const store = db.createObjectStore('notes', { keyPath: 'id' });
    store.createIndex('byUpdated', 'updatedAt');
  },
});

await db.put('notes', { id: crypto.randomUUID(), text: 'Hi', updatedAt: new Date() });
const recent = await db.getAllFromIndex('notes', 'byUpdated');
```

Two gotchas: schema changes happen only in `upgrade`, keyed by a version number you bump,
and a transaction auto-commits as soon as you `await` something that is not an IndexedDB
request, such as a `fetch`, inside it.

## Cache API: storing HTTP responses

The Cache API stores `Response` objects keyed by `Request`. It is designed for service
workers implementing offline or stale-while-revalidate strategies, though the page can use
it too:

```js
const cache = await caches.open('api-v1');
const hit = await cache.match('/api/products');
if (!hit) await cache.put('/api/products', await fetch('/api/products'));
```

It is not the HTTP cache. The browser's HTTP cache follows `Cache-Control` headers and you
cannot enumerate it; the Cache API is entirely under your control, and entries never expire
unless you delete them.

## Quotas, eviction and persistence

IndexedDB and the Cache API share an origin's quota, which is a proportion of free disk
space rather than a fixed number. You can check usage:

```js
const { usage, quota } = await navigator.storage.estimate();
const persisted = await navigator.storage.persist(); // ask not to be evicted
```

By default storage is "best effort": under disk pressure the browser may clear an origin's
data, least recently used first. Safari additionally caps script-writable storage for sites
the user has not interacted with for seven days when tracking prevention applies. The
lesson: the server is the source of truth, and browser storage is a cache or an outbox.

## Choosing, by example

| Data | Store | Why |
| --- | --- | --- |
| Session identifier | `HttpOnly` cookie | server needs it; scripts should not |
| Theme and table page size | `localStorage` | tiny, per-device, harmless if stolen |
| Multi-step form progress in one tab | `sessionStorage` | scoped to the tab, survives reload |
| Offline notes with images | IndexedDB | large, structured, async |
| App shell and API responses offline | Cache API in a service worker | stores real responses |
| Current filter state | the URL | shareable and survives reload |
| Server data such as orders | memory, via a query cache | the server owns it |

Access tokens are the contested case. Keeping a short-lived access token in memory and a
refresh token in an `HttpOnly` cookie is the common compromise; `localStorage` is readable
by any injected script, and a cookie brings CSRF concerns you must handle. A strong answer
names that trade-off rather than claiming one option is simply "secure".

## Where to practise

- [usePersistentState](../../react/23-usepersistentstate/) wraps `localStorage` with the
  serialisation, error handling and `storage`-event syncing described above.
- [Offline-first notes](../../react/59-offline-first-notes/) uses IndexedDB as an outbox.
- The [expense tracker](../../63-expense-tracker/) and [todo app](../../14-todo-app/)
  persist state without a framework.
- Why most "global state" is really a server cache is covered in
  [server and client state](server-and-client-state.md), and XSS in
  [web security basics](web-security-basics.md).

## What you should be able to answer

- What are the differences between cookies, `localStorage`, `sessionStorage` and IndexedDB
  in size, lifetime, API style and whether the server sees them?
- Why is storing an access token in `localStorage` considered risky, and what are the
  alternatives and their trade-offs?
- Why does `localStorage.getItem('count')` return a string, and what problems does its
  synchronous API cause?
- How do you keep two tabs in sync when a setting changes?
- When would you reach for IndexedDB or the Cache API instead of Web Storage?
- Can the browser delete data you stored, and how does that change your design?
