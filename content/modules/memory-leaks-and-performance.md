# Memory leaks and performance problems in production

"Memory grows until the service is killed" and "the API gets slow under load
but CPU looks fine" are two of the most common real production problems, and
interviewers use them to see whether you measure or guess. This guide covers
how leaks happen in Node, .NET and the browser, how to find them with heap
snapshots and dumps, and how to diagnose CPU, event-loop and thread-pool
problems with the right tools.

[debugging-playbook](debugging-playbook.md) gives the general method; this
guide is the runtime-specific toolkit.

## Leak or just high usage?

Garbage-collected runtimes free memory only when nothing references it. A
**leak** in a GC language is memory that is still referenced, by accident. Two
graphs look alarming but mean different things:

| Pattern | Likely meaning |
| --- | --- |
| Rises, then plateaus under steady load | normal: caches warm, GC holds committed memory |
| Sawtooth that returns to the same floor | normal allocation and collection |
| Floor rises after every GC, for hours or days | a leak |
| Jumps with specific requests, then drops | large allocations (buffering files, huge queries) |

.NET's Server GC in particular keeps memory it has committed, so a high,
stable working set is not a leak. A leak is growth that continues across
collections and ends in an out-of-memory crash or an `OOMKilled` container.

## How leaks happen

The same few causes account for most real leaks, in every runtime:

- **Unbounded caches.** A `Map` or `Dictionary` at module or singleton level
  that is only ever added to.
- **Listeners and subscriptions never removed.** Event handlers, `setInterval`,
  message-bus subscriptions, observables. The publisher holds a reference to
  the handler, and the handler's closure holds everything it captured.
- **Long-lived objects collecting short-lived ones.** A singleton service
  appending every request to a list "for diagnostics".
- **Closures capturing more than you think.** A callback that references one
  small value can keep a large surrounding object alive.
- **Static events in .NET.** Subscribing an instance method to a static event
  keeps the instance alive forever.
- **In the browser:** detached DOM nodes still referenced from a listener on
  `window` or a timer, usually an effect without cleanup.

The fix for caches is to bound them. A minimal least-recently-used cache in
JavaScript relies on `Map` preserving insertion order:

```js
class BoundedCache {
  #map = new Map();
  constructor(max) { this.max = max; }
  get(key) {
    if (!this.#map.has(key)) return undefined;
    const value = this.#map.get(key);
    this.#map.delete(key);          // move to the "most recent" end
    this.#map.set(key, value);
    return value;
  }
  set(key, value) {
    this.#map.delete(key);
    this.#map.set(key, value);
    if (this.#map.size > this.max) this.#map.delete(this.#map.keys().next().value);
  }
}
```

In real code, use a library (`lru-cache` in Node; `IMemoryCache` with
`SizeLimit` or `HybridCache` in .NET) and add a TTL. See
[caching-strategies](caching-strategies.md) and the
[LRU cache project](../../41-lru-cache/).

## Finding a leak in Node

1. **Reproduce the growth** locally or in staging with a load generator
   hitting the suspect endpoints.
2. **Take heap snapshots over time.** Start with `node --inspect`, open
   `chrome://inspect`, and take a snapshot, run load, take another, run more
   load, take a third. Or write them from code with `v8.writeHeapSnapshot()`.
3. **Compare snapshots.** In the Comparison view, sort by size delta. The
   constructor that keeps growing (`Object`, `Array`, your `Session` class) is
   the leak's victim.
4. **Follow the retainers.** The Retainers panel shows the chain of references
   keeping an object alive, ending at a root such as a module-level variable or
   an event emitter's listener array. That chain is the bug.

Two flags help in production:

```sh
node --heapsnapshot-near-heap-limit=2 dist/server.js   # snapshot before OOM
node --max-old-space-size=512 dist/server.js           # explicit heap ceiling
```

`process.memoryUsage()` separates the V8 heap (`heapUsed`) from the whole
process (`rss`). If `rss` grows while `heapUsed` stays flat, look outside the
heap: Buffers, native modules or streams that are never consumed.

## Finding a leak in .NET

| Tool | Use it to |
| --- | --- |
| `dotnet-counters monitor -p <pid>` | watch GC heap size, gen 2 collections, LOH size, thread pool queue, exception rate live |
| `dotnet-gcdump collect -p <pid>` | capture a lightweight heap graph; open in Visual Studio or PerfView |
| `dotnet-dump collect -p <pid>` | capture a full dump; analyse with `dotnet-dump analyze` |
| `dotnet-trace collect -p <pid>` | CPU and event traces, including allocation sampling |

With a dump, `dumpheap -stat` lists types by count and size, and `gcroot
<address>` shows what keeps an instance alive: the .NET equivalent of V8's
retainer path. Take two dumps some time apart and compare the counts.

Some .NET-specific memory traps:

- **Large object heap.** Arrays of 85,000 bytes or more go on the LOH, which is
  collected only in gen 2. Allocating big buffers per request causes frequent
  full GCs; rent them from `ArrayPool<byte>.Shared` or stream instead.
- **Buffering whole files.** `File.ReadAllBytesAsync` on a 2 GB file allocates
  2 GB. Return `PhysicalFile` or a `FileStream`.
- **Captive dependencies.** A scoped `DbContext` held by a singleton keeps
  every tracked entity alive and is not thread-safe either.

## CPU and the Node event loop

Node runs your JavaScript on one thread. Anything synchronous and slow (a huge
`JSON.parse`, a CPU-heavy loop, synchronous crypto, a catastrophically
backtracking regex) stops every other request. Symptoms: one core at 100%, all
endpoints slow at once, timeouts under light load.

Measure event-loop delay directly:

```js
import { monitorEventLoopDelay } from "node:perf_hooks";

const h = monitorEventLoopDelay({ resolution: 20 });
h.enable();
setInterval(() => {
  // percentiles are in nanoseconds
  console.log(`event loop p99: ${(h.percentile(99) / 1e6).toFixed(1)} ms`);
  h.reset();
}, 10_000).unref();
```

Then find the hot code with a CPU profile: `node --cpu-prof` writes a
`.cpuprofile` you can load in Chrome DevTools, or use the Performance tab while
attached with `--inspect`. Fixes: stream instead of buffering, chunk long
loops, move CPU-heavy work to `worker_threads` (see the
[worker pool project](../../84-worker-pool/)) or a background job.

## Reading a flame graph

Profilers sample the call stack many times a second and draw the result:

- **Width** is the share of samples where that function was on the stack, so
  wide means expensive (including what it calls).
- **Height** is just call depth.
- Look for **wide plateaus at the top**: functions that spend time in
  themselves rather than in callees. That is where optimisation pays off.

A common surprise: the widest plateau is logging, JSON serialisation or a
validation library, not your business logic.

## Thread-pool starvation in .NET

ASP.NET Core serves requests from the thread pool. Blocking a pool thread on
async work, with `.Result`, `.Wait()` or `GetAwaiter().GetResult()`, ties it up
while the work it waits for also needs a pool thread. The pool injects new
threads slowly, so under a burst requests queue for seconds.

The tell is distinctive: **low CPU, high latency, and a growing thread-pool
queue** in `dotnet-counters`. The fix is async all the way down; see
[csharp-async-deep-dive](csharp-async-deep-dive.md).

Other .NET throughput traps are sockets exhausted by `new HttpClient()` per
call (use `IHttpClientFactory`) and lock contention on shared state.

## Performance under load: work from the bottleneck

When a service slows as traffic rises, something is saturating. Check, in
order: database (slow queries, lock waits, connection pool at its limit),
application pools (DB pool, HTTP connection pool, thread pool), CPU (including
container throttling), then memory and GC time. The first resource at its
ceiling is the bottleneck; everything else is waiting on it.

Measure with realistic data. A load test that hits the same ten ids measures
your cache, not your system.

## Browser memory and performance

In Chrome DevTools, the **Memory** panel takes heap snapshots of the page; filter
for "Detached" to find DOM nodes kept alive by JavaScript. The **Performance**
panel records long tasks (over 50 ms) that make the page janky and hurt
Interaction to Next Paint. The usual React culprits are effects without
cleanup, huge lists rendered without virtualisation, and expensive work in
render.

## What you should be able to answer

- How do you tell a memory leak from a runtime simply holding memory?
- Walk through finding a leak with heap snapshots. What is a retainer path?
- Name four common causes of leaks in Node or .NET code.
- Your Node API is slow on every endpoint at once and one core is pinned. What
  is happening and how do you prove it?
- Low CPU, high latency, growing thread-pool queue in .NET: what is it and how
  do you fix it?
- How do you read a flame graph, and where do you look first?
