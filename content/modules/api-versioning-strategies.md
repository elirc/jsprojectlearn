# API versioning strategies

"How would you version this API?" sounds like a question about URLs. It is
really a question about change: which changes break clients, how you avoid
making them, and how you retire an old contract without breaking the people
still on it. Mid-level candidates are expected to know the options, name their
costs, and say when versioning is unnecessary.

## First decide what counts as breaking

Versioning exists to protect clients from breaking changes, so start there. The
test is simple: **could a correctly written client that worked yesterday fail
today?**

| Change | Breaking? | Why |
|---|---|---|
| Add an optional response field | No | Tolerant clients ignore it |
| Add an optional request field with a default | No | Old clients do not send it |
| Add a new endpoint | No | Nobody calls it yet |
| Add a value to a response enum | **Often** | A client with an exhaustive `switch` has no branch for it |
| Make an optional request field required | Yes | Old requests now fail validation |
| Remove or rename a field | Yes | Clients reading it get `undefined` |
| Change a type (`"42"` to `42`, number to object) | Yes | Parsing or comparisons fail |
| Tighten validation (max length 200 to 100) | Yes | Previously valid requests are rejected |
| Change a status code (200 to 201, 404 to 204) | Yes | Clients branch on status |
| Change default sort, page size or error shape | Yes, quietly | Nothing crashes; behaviour is wrong |
| Change the meaning of a field (`price` now includes tax) | Yes, worst kind | Every check passes and the numbers are wrong |

The last two rows are why "our tests pass" is not evidence of compatibility.
Behavioural changes break clients without breaking schemas.

## Additive evolution and tolerant readers

Most mature APIs rarely bump a version. They evolve additively, and they rely on
clients being **tolerant readers**: ignore fields you do not know, do not
depend on field order, and treat unknown enum values as a defined fallback.

The defaults in your stack matter here:

- `System.Text.Json` skips unknown properties unless you opt into
  `JsonUnmappedMemberHandling.Disallow`.
- In Zod 4, `z.object` strips unknown keys, which is tolerant; `z.strictObject`
  rejects them, which turns every additive server change into a client
  failure. Use strict parsing on **input to your server**, tolerant parsing on
  **responses from someone else's**.

Enum additions deserve a contract clause. Document that clients must handle
unknown values, and write your own clients that way:

```ts
type OrderStatus = 'pending' | 'paid' | 'shipped' | (string & {});

function label(status: OrderStatus): string {
  switch (status) {
    case 'pending': return 'Awaiting payment';
    case 'paid': return 'Paid';
    case 'shipped': return 'On its way';
    default: return 'Processing'; // a status added next year lands here
  }
}
```

The `(string & {})` keeps autocomplete for the known values while forcing a
`default` branch. When you need a genuinely incompatible shape, prefer adding a
new field (`priceIncludingTax`) alongside the old one to changing the old one.
This is expand-and-contract, the same pattern you use for database migrations.

## The four ways to carry a version

| Style | Example | Strengths | Costs |
|---|---|---|---|
| URL path | `GET /v2/orders/7` | Visible in logs, links, browser and curl; trivially routed and cached | Purists object that the resource's URI changes; tempts you to version everything at once |
| Query string | `GET /orders/7?api-version=2026-03-01` | Easy to add; Azure uses dated versions this way | Easy to drop when building URLs; muddles cache keys |
| Custom header | `X-Api-Version: 2` or Stripe's `Stripe-Version` | Clean URLs; lets you version per request | Invisible in logs and browser; caches need `Vary` |
| Media type | `Accept: application/vnd.acme.order.v2+json` | Versions the representation, not the resource; most "RESTful" | Hardest to test by hand; tooling support is weakest |

For a public or partner API, **URL path with a major version** is the pragmatic
default: everyone understands it and every tool supports it. Header-based
dated versions (Stripe, GitHub's `X-GitHub-Api-Version: 2022-11-28`) suit APIs
with many small breaking changes, where each account is pinned to the version
it signed up with and upgrades explicitly.

Whichever you choose, decide what happens when the client sends no version.
Defaulting to the oldest keeps old clients working; defaulting to the newest
breaks them silently. Many teams require the version outright.

## Running two versions without two codebases

The expensive mistake is copying the whole v1 project into v2. Instead keep one
domain and service layer, and make versions a thin edge concern:

```text
/v1/orders ─┐                           ┌─ OrderV1Dto (price excl. tax)
            ├─> OrderService (one) ─────┤
/v2/orders ─┘                           └─ OrderV2Dto (price object)
```

In Express 5 that is one router per version sharing the same services:

```js
import express from 'express';
import { orderService } from './orders.js';

const v1 = express.Router();
v1.get('/orders/:id', async (req, res) => {
  const o = await orderService.get(req.params.id);
  res.json({ id: o.id, price: o.netPence / 100 });
});

const v2 = express.Router();
v2.get('/orders/:id', async (req, res) => {
  const o = await orderService.get(req.params.id);
  res.json({ id: o.id, price: { net: o.netPence, gross: o.grossPence, currency: 'GBP' } });
});

const app = express();
app.use('/v1', v1);
app.use('/v2', v2);
```

Stripe takes this further with version-change modules: the core always
produces the latest shape, and a chain of small transformers rewrites the
response backwards for older pinned versions. Every version you keep costs
tests, documentation and support, so keep at most two majors alive.

## Asp.Versioning in ASP.NET Core

The `Asp.Versioning.Http` package (with `Asp.Versioning.Mvc.ApiExplorer` for
OpenAPI) is the standard library:

```cs
builder.Services.AddApiVersioning(o =>
{
    o.DefaultApiVersion = new ApiVersion(1);
    o.AssumeDefaultVersionWhenUnspecified = false;  // require a version
    o.ReportApiVersions = true;                      // api-supported-versions header
    o.ApiVersionReader = new UrlSegmentApiVersionReader();
})
.AddApiExplorer(o =>
{
    o.GroupNameFormat = "'v'VVV";                    // group names "v1", "v2"
    o.SubstituteApiVersionInUrl = true;
});

var app = builder.Build();
var orders = app.NewVersionedApi("Orders");

var v1 = orders.MapGroup("/api/v{version:apiVersion}/orders")
               .HasDeprecatedApiVersion(1.0);
v1.MapGet("/{id:int}", (int id, OrderService s) => s.GetV1(id));

var v2 = orders.MapGroup("/api/v{version:apiVersion}/orders")
               .HasApiVersion(2.0);
v2.MapGet("/{id:int}", (int id, OrderService s) => s.GetV2(id));
```

`ApiVersionReader.Combine(...)` accepts several styles at once, for example
URL segment plus `HeaderApiVersionReader("X-Api-Version")`. With
`ReportApiVersions`, responses carry `api-supported-versions` and
`api-deprecated-versions`, and an unsupported version gets a 400
ProblemDetails rather than a confusing 404.

## One OpenAPI document per version

Each version is a separate contract, so publish a separate document. With the
built-in `Microsoft.AspNetCore.OpenApi` in .NET 9 and 10:

```cs
builder.Services.AddOpenApi("v1");
builder.Services.AddOpenApi("v2");
// ...
app.MapOpenApi();   // /openapi/v1.json and /openapi/v2.json
```

By default a document includes endpoints whose API Explorer group name matches
the document name, which is exactly what `GroupNameFormat = "'v'VVV"` produces.
Generated clients and contract tests then run per version, and a diff between
`v1.json` from the last release and today's build catches accidental breaking
changes in CI. That workflow is covered in
[contract-first OpenAPI](openapi-contract-first.md).

## Deprecation and Sunset headers

Announcing a retirement in a blog post reaches nobody's code. Put it in the
response, using two standard headers:

```http
Deprecation: @1788220800
Sunset: Tue, 30 Mar 2027 00:00:00 GMT
Link: <https://developer.example.com/migrate-v2>; rel="deprecation"; type="text/html"
```

- **`Deprecation`** (RFC 9745, 2025) says when the endpoint was or will be
  deprecated, as a Unix timestamp prefixed with `@`. Deprecated means "still
  works, stop building on it".
- **`Sunset`** (RFC 8594) says when it will stop responding, as an HTTP date.
  Asp.Versioning can emit it from a policy:
  `o.Policies.Sunset(1.0).Effective(new DateTimeOffset(2027, 3, 30, 0, 0, 0, TimeSpan.Zero))`.
- **`Link`** with `rel="deprecation"` or `rel="sunset"` points to the
  migration guide.

Then measure. Log the version on every request and tag metrics with the client
id, so a month before the sunset date you can email the three integrations
still calling v1 instead of discovering them from their outage. Browser
clients reading these headers cross-origin need them listed in
`Access-Control-Expose-Headers` (see [CORS explained](cors-explained.md)).
After the sunset, `410 Gone` with a link to the migration guide beats a 404.

## When not to version at all

Versioning is for clients you do not control and cannot upgrade in lockstep:
public APIs, partner integrations, mobile apps (users run old builds for
months). A **backend used only by your own SPA**, deployed together from the
same repository, usually needs no version: the contract is the code, and a
typed client generated from OpenAPI makes breaking changes a compile error.

One catch keeps that from being free: an open browser tab still runs
yesterday's JavaScript after you deploy. Make server changes expand-and-contract
across two deploys (add the new field, ship the SPA that uses it, then remove
the old one), and the tab keeps working until it reloads. Versioning an
internal API "just in case" buys you two code paths and no users of the second.

## What you should be able to answer

- Is adding a value to an enum in a response a breaking change? What do you tell clients to do about it?
- Compare URL, header, query and media-type versioning. Which would you pick for a public API and why?
- How do you run v1 and v2 without duplicating your business logic?
- What do the `Deprecation` and `Sunset` headers mean, and how would you find out who is still on v1?
- Why does an internal SPA backend usually not need versioning, and what still goes wrong on deploy?
- Name a change that breaks clients without changing the schema at all.
