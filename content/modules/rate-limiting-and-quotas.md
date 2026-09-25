# Rate limiting and quotas

"How would you stop one client overwhelming your API?" appears in backend and
system-design rounds alike. A mid-level answer picks an algorithm for a reason,
chooses the right key, knows why an in-memory limiter breaks with three
instances, and returns a 429 a client can actually act on.

## Why limit at all

Four reasons, leading to different limits:

- **Abuse**: credential stuffing, scraping, id enumeration. Tight limits on
  specific endpoints, keyed by account *and* IP.
- **Fairness**: one tenant's batch job must not slow everyone else.
- **Cost**: an endpoint that calls an LLM or sends SMS costs money per request.
  Low limits plus a monthly quota.
- **Your own bugs**: a client in a retry loop is the most common "attack" you
  will see. A generous global limit catches it.

Rate limiting is not DDoS protection: a volumetric attack saturates your network
before your code runs, which is the CDN's job.

## The algorithms

| Algorithm | How it works | Bursts | Memory per key | Typical use |
|---|---|---|---|---|
| Fixed window | Count requests per clock window (e.g. per minute); reset at the boundary | Up to 2× limit across a boundary | One counter | Simple quotas, login attempts |
| Sliding log | Store a timestamp per request; count those in the last N seconds | Exact, none | One entry per request | Low-volume, high-precision limits |
| Sliding window counter | Weighted blend of this window's and last window's counts | Smoothed, approximate | Two counters | Good default for per-user API limits |
| Token bucket | Bucket holds up to *capacity* tokens, refilled at *rate*; each request takes one | Allows bursts up to capacity | Tokens + timestamp | APIs where short bursts are fine |
| Leaky bucket | Requests queue and drain at a fixed rate | Smoothed out; excess queued or dropped | A queue | Protecting a downstream that needs a steady rate |
| Concurrency limit | Cap *in-flight* requests, not requests per time | Not time based | One counter | Slow, expensive endpoints (exports, reports) |

The fixed-window flaw is the one to explain in interviews: with 100 per minute,
a client can send 100 at 12:00:59 and 100 at 12:01:00, which is 200 in two
seconds. The sliding window counter fixes most of that cheaply:

```text
estimate = previousWindowCount × (1 − elapsedFractionOfCurrentWindow) + currentWindowCount
e.g. 80 × (1 − 0.25) + 30 = 90  → under 100, allowed
```

Token bucket is the most common in practice because "average rate plus
allowed burst" is how people naturally think about API traffic. Here is a
complete version, run on Node 24 with a simulated clock:

```js
export function createTokenBucket({ capacity, refillPerSec, now = () => performance.now() }) {
  const buckets = new Map(); // key -> { tokens, last }
  return function take(key, cost = 1) {
    const t = now();
    const b = buckets.get(key) ?? { tokens: capacity, last: t };
    b.tokens = Math.min(capacity, b.tokens + ((t - b.last) / 1000) * refillPerSec);
    b.last = t;
    buckets.set(key, b);
    if (b.tokens >= cost) {
      b.tokens -= cost;
      return { allowed: true, remaining: Math.floor(b.tokens) };
    }
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((cost - b.tokens) / refillPerSec) };
  };
}

let clock = 0;
const take = createTokenBucket({ capacity: 5, refillPerSec: 1, now: () => clock });
// 7 immediate calls: ok ok ok ok ok 429 429
clock += 2500; // 2.5 s later: two more succeed, the third gets retryAfter: 1
```

No timers: tokens are computed lazily from elapsed time, so it scales to
millions of keys, and `cost` lets an expensive endpoint take five tokens. This
map grows forever; a real one evicts idle keys, as
[../../76-rate-limiter/](../../76-rate-limiter/) does.

## Choosing the key, and the proxy trap

The key decides *who* is limited:

| Key | Good for | Pitfall |
|---|---|---|
| User id | Authenticated APIs; fair per person | Nothing to key on before login |
| API key or client id | Partner and public APIs; maps to a plan | Leaked keys; limit per key *and* per account |
| Tenant id | B2B SaaS fairness | One tenant with 5,000 users needs a bigger number |
| IP address | Anonymous endpoints, login, sign-up | Office NAT and mobile carriers share IPs; IPv6 users get whole /64 ranges |

For login, combine keys: a per-IP limit stops one machine trying many
accounts; a per-account limit stops a botnet trying one account from many IPs.

The classic bug is reading the wrong IP. Behind a load balancer every request
comes from the balancer's address, so everyone shares one bucket. The fix is
`X-Forwarded-For`, but that header is **client-controlled**: anyone can send
`X-Forwarded-For: 1.2.3.4` and get a fresh bucket per request. Trust only the
entries added by proxies you run:

```js
app.set('trust proxy', 1); // exactly one proxy in front; req.ip = the address it saw
```

```csharp
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
    o.KnownProxies.Add(IPAddress.Parse("10.0.0.5")); // only this proxy is believed
});
```

Setting `trust proxy` to `true` in Express means "believe the leftmost address",
which is the attacker's.

## Distributed limiting with Redis

An in-memory limiter counts per process. With three instances behind a load
balancer, a "100 per minute" limit is really 300, and it resets on every
deploy. Share the counters in Redis.

The naive fixed window has a race:

```js
const n = await redis.incr(key);
if (n === 1) await redis.expire(key, 60); // crash here → key never expires, user blocked forever
```

Make it atomic with a Lua script, which Redis runs as one indivisible step:

```lua
-- KEYS[1] = rl:user:42:<window>, ARGV[1] = window seconds, ARGV[2] = limit
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
return { n, redis.call('TTL', KEYS[1]) }
```

The same pattern holds for token buckets: read tokens and timestamp, refill,
decide and write back in one script, using Redis's clock (`TIME`) rather than
each app server's. Decide what happens when Redis is down: most APIs **fail
open** (allow traffic, log loudly) because blocking every user is worse than a
brief period without limits; login throttling may reasonably fail closed.

## 429, Retry-After and the RateLimit headers

A rejected request gets `429 Too Many Requests` (RFC 6585) and a `Retry-After`
header in seconds, which RFC 9110 defines. Add a problem details body (see
[API error design](api-error-design.md)) so clients get a code, not prose:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 12
RateLimit-Policy: "default";q=100;w=60
RateLimit: "default";r=0;t=12
Content-Type: application/problem+json

{ "type": "https://api.example.com/problems/rate-limited", "title": "Too many requests",
  "status": 429, "code": "RATE_LIMITED" }
```

`RateLimit-Policy` and `RateLimit` come from the IETF httpapi working group's
draft (quota `q`, window `w`, remaining `r`, seconds until reset `t`). It is
still a draft and the header names changed between revisions (older ones used
`RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`), so document which
you send. Sending them on successful responses lets well-behaved clients slow
down before they hit the wall.

Use 429 for the client's own limit and 503 with `Retry-After` when *you* are
overloaded. The distinction is covered in
[HTTP status codes in depth](http-status-codes-in-depth.md).

## Quotas are not rate limits

A **rate limit** protects capacity over seconds or minutes. A **quota** is a
commercial allowance over days or months: "10,000 calls per month on the Free
plan". Quotas need durable storage, a usage page and warnings at 80%; when
exhausted they return 429 or 403 with a `QUOTA_EXCEEDED` code. Paid APIs
usually have both.

## Clients: behave well

Your frontend and integrations are clients too. On 429, wait for
`Retry-After`; without it, back off exponentially with jitter
(`delay = random(0, base × 2^attempt)`). Cap attempts, and only retry requests
that are safe to repeat (see
[idempotency and safe retries](idempotency-and-safe-retries.md)). Debounce
search-as-you-type at the source rather than letting the server reject every
keystroke.

## Framework and gateway support

**ASP.NET Core** has built-in middleware in `Microsoft.AspNetCore.RateLimiting`:

```csharp
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests; // default is 503!
    o.AddPolicy("per-user", ctx => RateLimitPartition.GetTokenBucketLimiter(
        ctx.User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? ctx.Connection.RemoteIpAddress?.ToString() ?? "anon",
        _ => new TokenBucketRateLimiterOptions
        {
            TokenLimit = 20, TokensPerPeriod = 10,
            ReplenishmentPeriod = TimeSpan.FromSeconds(1), QueueLimit = 0,
        }));
    o.AddConcurrencyLimiter("exports", c => { c.PermitLimit = 2; c.QueueLimit = 0; });
    o.OnRejected = (ctx, ct) =>
    {
        if (ctx.Lease.TryGetMetadata(MetadataName.RetryAfter, out var wait))
            ctx.HttpContext.Response.Headers.RetryAfter = ((int)wait.TotalSeconds).ToString();
        return ValueTask.CompletedTask;
    };
});

app.UseRateLimiter();                       // after UseAuthentication for user keys
app.MapGet("/api/orders", ListOrders).RequireRateLimiting("per-user");
```

The **partitioned** limiter gives each key its own bucket. Controllers use
`[EnableRateLimiting("per-user")]` and `[DisableRateLimiting]`. These limiters
are in-memory, per instance: for multi-instance accuracy you need a Redis-backed
limiter or a gateway.

**Express** uses `express-rate-limit`:

```js
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';

app.use('/api', rateLimit({
  windowMs: 60_000,
  limit: 100,
  standardHeaders: 'draft-8',   // RateLimit-Policy + RateLimit
  legacyHeaders: false,         // drop X-RateLimit-*
  keyGenerator: (req) => req.user?.id ?? ipKeyGenerator(req.ip),
  store: new RedisStore({ sendCommand: (...args) => redis.sendCommand(args) }),
}));
```

`ipKeyGenerator` (exported by the same package) groups IPv6 addresses by
subnet so one user cannot rotate through their /64.

**Gateways** (Azure API Management, AWS API Gateway, Kong, nginx `limit_req`)
enforce limits per key and plan before traffic reaches your app, and usually
own quotas. Keep app-level limits for rules only your code can key on, such as
per-tenant or per-account on login.

## What you should be able to answer

- Compare fixed window, sliding window counter and token bucket. What is the fixed-window boundary problem?
- Which key would you limit a login endpoint on, and why is trusting `X-Forwarded-For` dangerous?
- Why does an in-memory limiter fail with several instances, and how do you make a Redis counter atomic?
- What should a 429 response include, and how should a client react to it?
- How is a quota different from a rate limit?
- How do you configure a per-user limiter in ASP.NET Core, and what is its default rejection status?
