# Caching in ASP.NET Core

.NET has four caching APIs that sound alike, and interviewers like asking you
to tell them apart: `IMemoryCache`, `IDistributedCache`, `HybridCache` and
output caching. You should know what each stores, where, and which one
protects you from a stampede. The layer-by-layer theory is in
[caching-strategies.md](caching-strategies.md); this guide is the .NET toolbox.

## The map

| API | Stores | Where | Stampede protection | Typical use |
|---|---|---|---|---|
| `IMemoryCache` | Objects | This process | No | Reference data on one instance |
| `IDistributedCache` | `byte[]` | Redis, SQL Server, … | No | Shared state across replicas |
| `HybridCache` | Objects (serialised for L2) | Memory L1 + distributed L2 | Yes, per process | The default for new data caching |
| Output caching | Whole HTTP responses | Memory, or Redis | Yes (locking) | Public GET endpoints |

## IMemoryCache

In-process, fast, and gone on restart. Each replica has its own copy.

```cs
builder.Services.AddMemoryCache();

public sealed class CountryService(IMemoryCache cache, AppDb db)
{
    public Task<List<Country>?> GetAllAsync(CancellationToken ct) =>
        cache.GetOrCreateAsync("countries:all", async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(1);
            entry.SlidingExpiration = TimeSpan.FromMinutes(10);
            return await db.Countries.AsNoTracking().ToListAsync(ct);
        });
}
```

**Absolute** expiration evicts at a fixed time. **Sliding** evicts after a
period without access, and resets on every read — so a hot entry with only a
sliding expiration never expires and never refreshes. Combine them: sliding to
drop unused entries early, absolute as the upper bound on staleness.

Two gotchas interviewers probe:

- **`GetOrCreateAsync` is not a lock.** A hundred concurrent misses on the same
  key run the factory a hundred times.
- **`SizeLimit` changes the rules.** Set
  `AddMemoryCache(o => o.SizeLimit = 1_000)` and every entry must declare
  `entry.Size`; one that does not makes the call throw. The units are yours
  to define (entries, rough kilobytes), and the cache does not measure
  anything itself.

Without a size limit, the memory cache is bounded only by memory pressure and
your expirations. The [caching project](../../csharp/33-caching-memory/)
builds this layer.

## IDistributedCache

The abstraction for a cache shared by every instance. The production
implementation is usually Redis (or the protocol-compatible Valkey):

```cs
builder.Services.AddStackExchangeRedisCache(o =>
{
    o.Configuration = builder.Configuration.GetConnectionString("Redis");
    o.InstanceName = "shop:";   // prefixed to every key
});
```

The API is deliberately low-level: `GetAsync` and `SetAsync` deal in
`byte[]`, with string helpers (`GetStringAsync`, `SetStringAsync`) as extension
methods. You serialise yourself, and there is no get-or-create:

```cs
var json = await cache.GetStringAsync($"product:{id}", ct);
if (json is null)
{
    var product = await db.Products.FindAsync([id], ct);
    json = JsonSerializer.Serialize(product);
    await cache.SetStringAsync($"product:{id}", json,
        new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(5) }, ct);
}
```

Every read is a network round trip plus deserialisation, and nothing stops a
stampede. `AddDistributedMemoryCache()` registers an in-memory implementation
for development and tests — it is not distributed at all.

## HybridCache

`HybridCache` (the `Microsoft.Extensions.Caching.Hybrid` package, generally
available in 2025 and usable from .NET 8) fixes both previous problems. It is
the answer to "what would you use today?".

```cs
builder.Services.AddStackExchangeRedisCache(o => o.Configuration = redisCs); // becomes L2
builder.Services.AddHybridCache(o =>
{
    o.DefaultEntryOptions = new HybridCacheEntryOptions
    {
        Expiration = TimeSpan.FromMinutes(5),            // L2 (and overall) lifetime
        LocalCacheExpiration = TimeSpan.FromMinutes(1)   // L1 lifetime
    };
});
```

```cs
app.MapGet("/products/{id:int}", async (int id, HybridCache cache, AppDb db, CancellationToken ct) =>
    await cache.GetOrCreateAsync(
        $"product:{id}",
        async token => await db.Products.AsNoTracking()
            .Where(p => p.Id == id).Select(p => new ProductDto(p.Id, p.Name, p.Price))
            .SingleOrDefaultAsync(token),
        tags: ["products"],
        cancellationToken: ct));
```

What it adds:

- **Two levels.** Checks in-process memory first, then the registered
  `IDistributedCache`, then runs the factory and fills both. With no
  distributed cache registered it works as a memory cache.
- **Stampede protection.** Concurrent callers for one key in the same process
  share one factory call. It is per process, not cluster-wide: five replicas
  can still make five calls.
- **Serialisation** handled for you (System.Text.Json by default,
  replaceable).
- **Tags.** `RemoveByTagAsync("products")` invalidates every entry carrying the
  tag; `RemoveAsync(key)` removes one entry.

One subtlety: because values can be deserialised from L2, you generally get a
fresh copy per call. Mutating a cached object is a bug in any case — cache
immutable DTOs such as records.

## Output caching

Output caching (.NET 7+) stores the **whole response** on the server and serves
it without running your handler:

```cs
builder.Services.AddOutputCache(o =>
{
    o.AddBasePolicy(b => b.Expire(TimeSpan.FromSeconds(30)));
    o.AddPolicy("Catalogue", b => b
        .Expire(TimeSpan.FromMinutes(5))
        .SetVaryByQuery("category", "page")
        .Tag("products"));
});

app.UseOutputCache();   // after UseCors and routing; see the pipeline guide

app.MapGet("/catalogue", GetCatalogue).CacheOutput("Catalogue");
```

Controllers use `[OutputCache(PolicyName = "Catalogue")]`. The **defaults**
decide more than people expect:

- only `GET` and `HEAD` requests, and only `200 OK` responses;
- **not** for authenticated requests, and **not** for responses that set a
  cookie — so per-user data is not accidentally shared;
- 60-second expiry, and a cache key built from the full URL, including the
  query string.

`SetVaryByQuery` narrows the key to the parameters that matter, so a tracking
parameter does not fragment the cache. When the data changes, evict by tag from
the write path:

```cs
app.MapPut("/products/{id:int}", async (int id, ProductUpdate body, AppDb db,
    IOutputCacheStore store, HybridCache cache, CancellationToken ct) =>
{
    // ... save changes
    await store.EvictByTagAsync("products", ct);
    await cache.RemoveByTagAsync("products", ct);
    return Results.NoContent();
});
```

The store is in memory by default; `AddStackExchangeRedisOutputCache` shares
it across replicas so an eviction reaches all of them. Middleware order is in
[aspnet-middleware-pipeline.md](aspnet-middleware-pipeline.md).

## Response caching is a different thing

The older response caching middleware (`AddResponseCaching`,
`UseResponseCaching`, `[ResponseCache]`) is driven by **HTTP cache headers**.
It honours `Cache-Control` on the request, so any client sending `no-cache`
bypasses it, and it cannot be invalidated from code.

| | Response caching | Output caching |
|---|---|---|
| Controlled by | HTTP headers (client can bypass) | Server policies |
| Invalidation | None; wait for expiry | Tags via `EvictByTagAsync` |
| Storage | Memory only | Memory or Redis, pluggable |
| Stampede | No | Locking on by default |

Use `[ResponseCache]` (or plain `Cache-Control` headers) to tell browsers and
CDNs what they may cache, and output caching for the server's own copy. Those
headers are covered in [http-fundamentals.md](http-fundamentals.md).

## Keys and invalidation in practice

The .NET APIs give you mechanisms, not a design. The rules that prevent
incidents:

- **Every input goes in the key.** `product:{id}` for public data;
  `tenant:{tenantId}:orders:{userId}:page:{n}` for anything scoped. A missing
  tenant id shows one customer another's data.
- **Centralise key construction** in one static class, so the reader and the
  invalidating writer cannot drift apart.
- **Cache DTOs, not entities.** Entities carry navigations and tracking state;
  DTOs serialise cleanly and are safe to share.
- **Pick the TTL from tolerance for staleness**, then add tag eviction on
  writes you control. TTL is the safety net for writes you do not control.
- **Do not cache failures** — a null for a not-yet-created row, or an error,
  becomes sticky.

## What you should be able to answer

- What is the difference between absolute and sliding expiration, and why combine them?
- What happens when you set `SizeLimit` on `IMemoryCache` but add entries without a `Size`?
- What does `HybridCache` add over `IDistributedCache`, and is its stampede protection cluster-wide?
- Which requests and responses does output caching skip by default, and why?
- How do you invalidate cached catalogue pages after a product update in both output caching and `HybridCache`?
- How does output caching differ from the response caching middleware?
