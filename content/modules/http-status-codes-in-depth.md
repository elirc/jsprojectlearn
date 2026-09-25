# HTTP status codes in depth

Every candidate knows 200, 404 and 500. The mid-level questions are about the
near neighbours: 400 or 422, 401 or 403, 409 or 412, 302 or 303 or 307. Each
pair has a real consequence, because proxies, caches, browsers and `fetch` all
behave differently depending on which one you send. This guide is about those
consequences; the basic decision ladder is in [REST API design](rest-api-design.md).

## Status codes are instructions to machines

A status code is read by far more than your frontend:

| Reader | What it does with the code |
|---|---|
| Browser navigation | Follows 3xx, shows a login dialog on `401` + `WWW-Authenticate: Basic`, caches 301/308 permanently |
| `fetch` | Follows redirects by default, rewrites the method on some, and **resolves** for every status; only network failures reject |
| Shared caches (CDNs) | Heuristically cache 200, 203, 204, 206, 300, 301, 308, 404, 405, 410, 414 and 501 when no `Cache-Control` says otherwise (RFC 9110 §15.1) |
| Retry logic | Treats 408, 429, 502, 503 and 504 as "maybe later"; almost every other 4xx as "never" |
| Monitoring | Counts 5xx against your error budget; 4xx usually does not page anyone |

So `fetch` does not throw on a 500 (check `res.ok`), and a 404 is cacheable by
default: some CDNs negatively cache it for minutes after you create the
resource. Send `Cache-Control: no-store` on errors you do not want remembered.

## 400 vs 422, and the rest of the input errors

RFC 9110 now defines **422 Unprocessable Content** as a core code, so the old
"it is only WebDAV" argument is gone. The useful split:

- **400** — I could not parse this. Broken JSON, a string where the schema
  demands a number, a missing required query parameter.
- **422** — I parsed it and it is the right shape, but it breaks a rule. End
  date before start date, quantity above stock, an unknown currency code.

ASP.NET Core's `[ApiController]` returns 400 for both, a defensible house
style; what matters is one rule per API. Also know **405** (must send `Allow`),
**413** (body too large), **415** (wrong `Content-Type`) and **410** (gone for good).

415 is the one that catches people: in Express 5, `express.json()` silently
skips a body without `Content-Type: application/json` and your handler sees
`req.body` as `undefined`, while ASP.NET Core's `[FromBody]` answers 415 for you.

## 401 vs 403 vs 404-for-hiding

**401** means "I do not know who you are", and RFC 9110 requires a
`WWW-Authenticate` header naming the scheme (`Bearer`, `Basic`). Send
`WWW-Authenticate: Basic` to a browser and it pops up a native login dialog,
which is why SPAs stick to `Bearer`. **403** means "I know who you are and the
answer is no". Retrying a 403 with the same credentials is pointless; retrying
a 401 after refreshing the token is the normal flow.

**404 instead of 403** is deliberate when existence itself is information: a
403 on another tenant's `GET /orders/9912` confirms the order exists and lets an
attacker enumerate ids. Resources scoped to a user or tenant return 404 to
outsiders; features gated by role (`/admin/reports`) return 403, because their
existence is no secret. See [OWASP API Top 10](owasp-api-top-10.md).

A classic ASP.NET Core trap: cookie authentication answers an unauthenticated
API call with **302 to `/Account/Login`**, not 401. `fetch` follows it, gets
the login page's HTML with a 200, and your JSON parse fails. Override
`Events.OnRedirectToLogin` and `OnRedirectToAccessDenied` in the cookie options
to set 401 and 403 instead.

## 409 vs 412 vs 428

All three are about state, and they are not interchangeable:

| Code | Trigger | What the client should do |
|---|---|---|
| **409 Conflict** | The request clashes with current state: duplicate email, cancelling a shipped order, concurrent edit detected without preconditions | Show the conflict; maybe re-fetch |
| **412 Precondition Failed** | The client sent `If-Match: "v3"` and the resource is now `"v4"` | Re-fetch, merge or ask the user, retry with the new ETag |
| **428 Precondition Required** | The client sent a PUT *without* `If-Match` and your API insists on one | Fix the client: always send the ETag |

412 is only correct when the client sent a precondition header. If you detect
a lost update through an EF Core `DbUpdateConcurrencyException` on a row
version the client posted in the body, that is a 409. 428 (RFC 6585) is how
you make optimistic concurrency mandatory instead of polite.

## Redirects: five codes, two questions

Every redirect answers two questions: is it permanent, and may the client
change POST to GET?

| Code | Permanent? | Method on follow | Use |
|---|---|---|---|
| 301 Moved Permanently | Yes | POST may become GET (browsers do) | Old URL for GET-only pages |
| 302 Found | No | POST may become GET (browsers do) | Legacy temporary redirect |
| 303 See Other | No | **Always** GET | After a form POST: Post/Redirect/Get |
| 307 Temporary Redirect | No | Preserved, body resent | Temporary move of an API endpoint |
| 308 Permanent Redirect | Yes | Preserved, body resent | Permanent move of an API endpoint, HTTP → HTTPS for APIs |

Running `fetch` in Node 24 against an Express app confirms it: a POST
redirected with 302 or 303 arrives as GET; with 307 it arrives as POST.

301 and 308 are cacheable by default and browsers keep them; a mistaken
permanent redirect cannot be undone from the server, so test with 302/307 first.

## 2xx choices: 200, 201, 202, 204

- **201 Created** with a `Location` header and the body, saving a GET.
- **204 No Content** has no body, by definition. `await res.json()` on a 204
  throws `SyntaxError: Unexpected end of JSON input`, so a client wrapper
  should check the status before parsing. If the client needs the updated
  resource (server-set timestamps, a new ETag), return **200** with it instead.
- **202 Accepted** means "queued, not done". Pair it with a `Location` to a
  status resource:

```http
POST /reports            ->  202 Accepted
                             Location: /reports/jobs/81
                             Retry-After: 5

GET /reports/jobs/81     ->  200 {"status":"running"}
GET /reports/jobs/81     ->  303 See Other
                             Location: /reports/81
```

The 303 on completion lets a client follow straight to the result.

## 429, 503 and Retry-After

**429** is this client exceeding its quota; **503** is the service being
unavailable for everyone (overloaded, deploying, in maintenance). Both should
carry `Retry-After`, in seconds or as an HTTP date:

```http
Retry-After: 30
Retry-After: Wed, 30 Sep 2026 07:28:00 GMT
```

Well-behaved clients wait at least that long. A browser `fetch` from another
origin cannot read `Retry-After` unless you list it in
`Access-Control-Expose-Headers` (see [CORS explained](cors-explained.md)). Quota
design is in [rate limiting and quotas](rate-limiting-and-quotas.md).

## 500 vs 502 vs 504: who produced it?

Your code produces 500. **502 and 504 are almost always produced by something
in front of your code**: nginx, a load balancer, IIS with the ASP.NET Core
Module, a CDN.

| Code | The proxy is saying | Usual cause |
|---|---|---|
| 502 Bad Gateway | The upstream gave me garbage or refused the connection | App crashed, not listening, wrong port, container restarting |
| 503 Service Unavailable | No healthy upstream, or the app said so | All instances failing health checks, deploy in progress |
| 504 Gateway Timeout | The upstream did not answer in time | Slow query longer than the proxy timeout (nginx defaults to 60 s) |

A 504 with no matching app error means the app was still working when the
proxy gave up. The work may have completed, so a retried POST needs an
[idempotency key](idempotency-and-safe-retries.md).

## The same decisions in code

ASP.NET Core minimal APIs with `TypedResults` put the possible outcomes in the
signature, so OpenAPI documents them for free:

```cs
app.MapPut("/orders/{id:int}", async Task<Results<Ok<OrderDto>, NotFound, ProblemHttpResult>>
    (int id, OrderUpdate body, HttpRequest req, AppDb db) =>
{
    var order = await db.Orders.FindAsync(id);
    if (order is null) return TypedResults.NotFound();

    var ifMatch = req.Headers.IfMatch.ToString();
    if (string.IsNullOrEmpty(ifMatch))
        return TypedResults.Problem(statusCode: 428, title: "If-Match header required");
    if (ifMatch != $"\"{order.Version}\"")
        return TypedResults.Problem(statusCode: 412, title: "Order changed since you loaded it");

    order.Apply(body);
    await db.SaveChangesAsync();
    return TypedResults.Ok(OrderDto.From(order));
});
```

Also know `Created(uri, value)`, `Accepted(uri, value)`, `NoContent()`,
`ValidationProblem(errors)` and `Redirect(url, permanent, preserveMethod)`,
which covers 302/301/307/308; there is no 303 helper. `Forbid()` and
`Challenge()` delegate to the authentication handler. Error bodies are covered
in [API error design](api-error-design.md) and the [ProblemDetails project](../../csharp/20-error-handling-problemdetails/).

Express 5:

```js
app.post('/orders', async (req, res) => {
  const order = await orders.create(req.body);
  res.status(201).location(`/orders/${order.id}`).json(order);
});

app.post('/checkout', (req, res) => res.redirect(303, '/orders/confirmation'));

app.use((req, res) => res.status(503).set('Retry-After', '120').json({ title: 'Maintenance' }));
```

Express 5 throws a `RangeError` from `res.status()` outside 100–999, and
rejected promises from async handlers reach your error middleware without a
wrapper. The [REST API project](../../65-rest-api/) and the
[REST conventions project](../../csharp/16-rest-conventions/) practise these
choices end to end.

## What you should be able to answer

- When would you return 422 instead of 400, and why is "always 400" also defensible?
- Why might you return 404 when the user is authenticated but not allowed to see the resource, and when would you still use 403?
- What is the difference between 409, 412 and 428, and which headers are involved?
- A POST is redirected: what does the browser do with 302, 303 and 307, and why are 301 and 308 risky to get wrong?
- Your logs show 504s at the load balancer but no errors in the app. What happened, and what does it mean for retrying the request?
- Why does `await res.json()` throw on some successful responses, and how would you design a 202 flow?
