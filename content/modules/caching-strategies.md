# Caching, from the browser to the database

"Where would you cache this, and how would you invalidate it?" is a reliable
mid-level filter question, because there is no memorisable right answer — only
trade-offs you either can or cannot articulate.

## The layers

A request can be answered at any of these, in order of cheapness:

1. **Browser memory / disk cache** — governed by `Cache-Control` and `ETag`
2. **Service worker** — programmable, offline-capable
3. **CDN / edge** — shared cache near the user
4. **Reverse proxy** — nginx, your load balancer
5. **Application in-memory cache** — per instance
6. **Distributed cache** — Redis, shared across instances
7. **Database query cache / buffer pool** — mostly not yours to manage
8. **Materialised views / precomputed tables** — cached results in the database

**The nearer the user, the bigger the win and the harder the invalidation.** A
CDN-cached response never touches your servers; it is also the one you cannot
easily un-cache from 200 edge locations.

## Rule one: measure first

Caching adds a whole class of bug — stale data, inconsistency between users,
"it works after a hard refresh". Do not add it because something feels slow.
Add it because you measured, found the hot path, and tried the cheaper fixes
first: a missing index, an N+1, a serial chain that could be parallel.

## HTTP caching

The two headers that do almost everything:

```
Cache-Control: max-age=31536000, immutable    # hashed asset — cache forever
Cache-Control: private, max-age=0, must-revalidate  # per-user API response
Cache-Control: public, max-age=60, stale-while-revalidate=300
Cache-Control: no-store                        # never write this down
```

- `public` — shared caches (CDNs) may store it. `private` — browser only.
- `no-store` means do not cache. `no-cache` means cache but revalidate first.
  The names are backwards and this is a common interview question.
- `stale-while-revalidate` — serve the stale copy immediately and refresh in the
  background. Excellent for content that can be a minute out of date.

**`ETag`** turns a full response into a 304 with no body:

```
GET /api/orders/7                  ->  200, ETag: "v3"
GET /api/orders/7
If-None-Match: "v3"                ->  304 Not Modified
```

You still pay the round trip, but not the bandwidth or the rendering.

**The standard static-asset pattern:** content-hashed filenames cached forever,
referenced from an HTML shell cached for seconds. New deploy, new filenames,
instant pickup with no invalidation needed.

## Application caching

```js
const cached = await cache.get(key);
if (cached) return cached;

const value = await expensiveThing();
await cache.set(key, value, { ttl: 300 });
return value;
```

That is **cache-aside**, and it is what you will write 95% of the time. Others
worth knowing by name: **read-through** (the cache loads on miss), **write-
through** (write to cache and store together), **write-behind** (write to cache,
flush to store asynchronously — fast, and you can lose data).

### In-memory vs distributed

An in-memory cache is a hash map in your process. Fast, free, and **per
instance** — three replicas means three caches, three different answers, and
evicting on one does nothing to the others.

A distributed cache (Redis) gives one shared view at the cost of a network hop
and an extra thing to operate.

The rule: **in-memory for immutable or tolerant data** (reference lists,
compiled templates, config), **distributed for anything that must be consistent
across instances** (sessions, rate-limit counters, expensive shared query
results).

## Invalidation

The hard half. Three strategies:

**TTL (expiry).** Simple, self-healing, and always slightly stale. Pick the TTL
from how stale the data is allowed to be — 30 seconds is often plenty and
removes most of the load. This should be your default.

**Explicit invalidation.** Delete the key when the underlying data changes.
Precise, and it fails whenever someone adds a new write path and forgets. If you
do this, funnel all writes through one place.

**Key versioning.** Include a version or timestamp in the key
(`user:42:v7`). Bumping the version orphans the old entries, which expire on
their own. No delete needed, no risk of deleting the wrong thing.

## Key design

Namespace them so you can reason about them:

```
user:42:profile
orders:list:tenant=9:status=open:page=1:v3
```

Include **every input that changes the result** — including the user or tenant.
Forgetting the tenant in the key is a cache poisoning bug that shows one
customer another customer's data, and it is a genuinely common outage.

## The failure modes

**Stampede (dogpile).** A popular key expires and 500 concurrent requests all
miss and all recompute it. Mitigations: a lock so one request computes while
others wait, `stale-while-revalidate` semantics, or jittered TTLs so keys do not
all expire together.

**Cold cache after deploy.** Restart every instance and every cache is empty at
once, so the database takes the full load at the worst moment. Warm critical
keys on startup, or use a distributed cache that survives deploys.

**Unbounded growth.** A cache with no eviction is a memory leak. Set a maximum
size and an eviction policy (LRU is the usual default).

**Caching errors.** Cache a 500 response and you have made an outage sticky.
Only cache successes.

**Caching per-user data in a shared cache.** See key design.

## Client-side caching

A data library (TanStack Query, SWR, RTK Query) is a cache with a good
invalidation story, and it is why teams stopped hand-rolling `useEffect`
fetches:

- Deduplicates identical in-flight requests
- Serves cached data instantly, revalidates in the background
- Invalidates by key after a mutation
- Handles retries, focus refetching, and pagination

The mental model is the same: keys, TTL (`staleTime`), and invalidation.

## Not caching, which is often better

Before adding a cache, check whether you can:

- Add the missing index
- Fix the N+1
- Return less data — a projection instead of the whole entity
- Paginate properly
- Run independent calls concurrently
- Precompute the value on write instead of on every read

A denormalised counter column updated on write is a cache with perfect
invalidation, because the database keeps it consistent for you.

## The interview answer

**"Would you cache this endpoint?"**

> Depends on the read/write ratio and how stale it can be. If it is read
> constantly and changes rarely, a 60-second TTL at the CDN removes almost all
> the load and the staleness is invisible. If it is per-user I would keep it
> private and cache in Redis keyed by user, since a shared cache risks serving
> the wrong person's data. And I would check the query plan first — if it is
> slow because of a missing index, caching just hides that.
