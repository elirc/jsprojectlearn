# The OWASP API Security Top 10, in CRUD code

The OWASP API Security Top 10 (2023 edition) is the checklist security-minded
interviewers reach for, and most of it is not exotic: it is authorisation
checks you forgot to write in ordinary Express or ASP.NET Core handlers. Know
each risk by number, what it looks like in your own code, and the fix.

| # | Risk | One-line summary |
|---|---|---|
| API1 | Broken object level authorisation (BOLA) | You can fetch someone else's object by changing an id |
| API2 | Broken authentication | Tokens or login flows can be forged, guessed or replayed |
| API3 | Broken object property level authorisation | You can read or write *fields* you should not |
| API4 | Unrestricted resource consumption | One request, or many, can exhaust CPU, memory or money |
| API5 | Broken function level authorisation (BFLA) | You can call *operations* you should not |
| API6 | Unrestricted access to sensitive business flows | A legitimate flow can be automated to harm the business |
| API7 | Server-side request forgery (SSRF) | Your server fetches a URL the attacker chose |
| API8 | Security misconfiguration | Defaults, verbose errors, loose CORS, missing headers |
| API9 | Improper inventory management | Old, undocumented or forgotten endpoints still live |
| API10 | Unsafe consumption of APIs | You trust data from third-party APIs too much |

## API1: Broken object level authorisation

The top risk every year. The [security basics guide](web-security-basics.md)
covers the single-record case; the variants that survive code review are
subtler:

- **Nested routes**: `GET /api/projects/12/invoices/88` checks that you own
  project 12, then loads invoice 88 without checking it belongs to project 12.
- **Writes**: `PUT /api/addresses/5` loads by id and updates, ownership never
  checked because "only the UI calls it".
- **Unguessable ids are not a fix**: GUIDs leak through URLs, logs and shared
  links. They slow enumeration; they do not authorise.

In a multi-tenant EF Core app, make the safe query the default with a global
query filter, so a forgotten `Where` fails closed:

```csharp
modelBuilder.Entity<Invoice>()
    .HasQueryFilter(i => i.TenantId == _tenant.Id);   // applied to every query

// Handler: scope by parent AND id; not found and not yours look identical
var invoice = await db.Invoices
    .SingleOrDefaultAsync(i => i.Id == invoiceId && i.ProjectId == projectId, ct);
return invoice is null ? TypedResults.NotFound() : TypedResults.Ok(invoice.ToDto());
```

Test it: an integration test that logs in as user B and requests user A's
resource, expecting 404, catches regressions no reviewer will. See
[ASP.NET Core authentication and authorisation](aspnet-authn-authz.md) for
resource-based handlers.

## API3: Broken object property level authorisation

This merges two older entries: **mass assignment** (writing fields you should
not) and **excessive data exposure** (reading fields you should not).

```js
// Vulnerable: the body is spread straight into the row
app.patch('/api/me', auth, async (req, res) => {
  const user = await db.user.update({ where: { id: req.user.id }, data: req.body });
  res.json(user);  // also returns passwordHash, role, mfaSecret...
});
```

A request with `{"role":"admin","emailVerified":true}` promotes itself. Fix
both directions with explicit shapes:

```js
const UpdateMe = z.object({ displayName: z.string().max(80), bio: z.string().max(500) }).strict();

app.patch('/api/me', auth, async (req, res) => {
  const data = UpdateMe.parse(req.body);          // unknown keys rejected
  const user = await db.user.update({ where: { id: req.user.id }, data });
  res.json({ id: user.id, displayName: user.displayName, bio: user.bio });
});
```

In ASP.NET Core, bind to a request DTO, never the EF entity, and return a
response DTO. `[JsonIgnore]` on the entity is a weak substitute: the next
developer adds a sensitive column and forgets the attribute. Different roles
seeing different fields (an admin sees `email`, others do not) is a response
mapping decision, made on the server; hiding it in React does not count.

## API5: Broken function level authorisation

BOLA is "right function, wrong object"; BFLA is "wrong function entirely". A
normal user calls `DELETE /api/users/7` or `POST /api/admin/refunds`, and it
works because the route only required a logged-in user.

```csharp
// Fail closed: every endpoint needs an authenticated user unless marked otherwise
builder.Services.AddAuthorizationBuilder()
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build())
    .AddPolicy("Admin", p => p.RequireRole("admin"));

var admin = app.MapGroup("/api/admin").RequireAuthorization("Admin");
admin.MapPost("/refunds", IssueRefund);
```

Common holes: the admin UI is hidden but its API is not; `GET` is restricted
and `DELETE` on the same path is not; an "internal" endpoint is reachable from
the internet. Put role checks on route groups or controllers so new endpoints
inherit them, and in Express apply `requireRole('admin')` to the router, not to
each handler.

## API2: Broken authentication

The API-flavoured failures are mostly about tokens and unthrottled flows:

```js
// Vulnerable: decode is not verify; no algorithm pinning; no audience check
const claims = jwt.decode(token);

// Fixed
const claims = jwt.verify(token, publicKey, {
  algorithms: ['RS256'], issuer: 'https://auth.example.com', audience: 'orders-api',
});
```

Also on the list: no rate limit on login, OTP or password reset (a six-digit
code falls to a million requests); tokens in query strings; long-lived tokens
with no revocation; password change without the current password. In ASP.NET
Core `AddJwtBearer` validates issuer, audience, lifetime and signature by
default; the bug is turning those off to "get it working". The deeper
background is in [sessions and JWTs](auth-sessions-jwt.md).

## API4 and API6: resources and business flows

**API4, unrestricted resource consumption**, is any request whose cost the
client controls without a ceiling:

| Vector | Fix |
|---|---|
| `?limit=1000000` | Clamp page size server-side (see [pagination](api-pagination-filtering.md)) |
| 2 GB upload or JSON body | `express.json({ limit: '100kb' })`; `MaxRequestBodySize`; stream uploads to storage |
| Expensive search or export | Timeouts, cancellation tokens, concurrency limits, background jobs |
| Paid side effects (SMS, email, LLM calls) | Per-account limits and spending caps |
| Deep GraphQL queries | Depth and cost limits |

The general tool is [rate limiting and quotas](rate-limiting-and-quotas.md).

**API6, unrestricted access to sensitive business flows**, is different: every
request is legitimate on its own, but automation at scale hurts the business.
Bots buying all the concert tickets, scripts creating accounts to farm referral
credit, scrapers draining a price list. Rate limits by IP do not stop a botnet.
Defences are business-aware: per-account and per-card purchase limits, device
fingerprinting, CAPTCHA or proof-of-work on the specific flow, delaying the
reward until the referred account is real, and monitoring for non-human
patterns. Identify which flows would hurt if automated before an attacker does.

## API7: Server-side request forgery

Any feature where the server fetches a user-supplied URL: webhook targets,
"import from URL", link previews, avatar by URL, PDF rendering of HTML.

```js
// Vulnerable: attacker sends http://169.254.169.254/latest/meta-data/iam/...
const res = await fetch(req.body.imageUrl);
```

That address is the cloud metadata service, which hands out credentials. Other
targets: `http://localhost:6379`, internal admin panels, `file://` URLs. Fixes,
layered:

- Allow only `https:` and, where possible, an **allowlist** of hosts.
- Resolve the hostname and **reject private, loopback and link-local ranges**
  (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, `::1`, `fc00::/7`), then
  connect to that resolved IP so DNS cannot change between check and use.
- Disable redirects (`redirect: 'manual'`) or re-validate each hop.
- Set timeouts and a response size cap; never return the raw response to the
  caller.
- At the network level, block egress to metadata endpoints and require IMDSv2
  on AWS.

## API8 and API9: configuration and inventory

**API8, security misconfiguration**, is the long tail. The ones found most in
CRUD apps:

- CORS that reflects any `Origin` with `Access-Control-Allow-Credentials: true`
  (see [CORS explained](cors-explained.md)).
- Stack traces or the developer exception page in production (see
  [API error design](api-error-design.md)).
- Missing `Strict-Transport-Security`, or HTTP left open.
- Swagger UI or Scalar exposed publicly for an internal API.
- Default credentials on admin tools, debug endpoints left mapped,
  `Cache-Control` missing on responses with personal data.

**API9, improper inventory management**, is not knowing what you run.
`/api/v1/users` was replaced by v2 with proper authorisation checks, but v1 is
still deployed and still leaks. `staging-api.example.com` uses a copy of
production data and no rate limits. A partner integration endpoint nobody
remembers bypasses the new auth. Fixes: an up-to-date OpenAPI document for
every deployed version (see [OpenAPI contract-first](openapi-contract-first.md)),
a retirement date for every old version (see
[API versioning strategies](api-versioning-strategies.md)), non-production
environments that never hold real personal data, and a list of which data
flows to which third party.

## API10: Unsafe consumption of APIs

Developers validate user input and then trust whatever a partner API, a
webhook or an internal service returns. Attackers who compromise, or simply
impersonate, that third party get a trusted path into your system.

```csharp
// Vulnerable: third-party address string goes straight into SQL and the UI
var addr = await client.GetFromJsonAsync<JsonElement>(url);
await db.Database.ExecuteSqlRawAsync(
    $"UPDATE Customers SET Address = '{addr.GetProperty("line1")}' WHERE Id = {id}");
```

Treat third-party data exactly like user input: validate its shape (Zod,
`System.Text.Json` into a typed DTO with validation), parameterise queries,
encode on output, enforce timeouts and size limits, require TLS, verify webhook
signatures, and do not follow redirects blindly. The operational side of this is
in [third-party integrations](third-party-integrations.md).

## What you should be able to answer

- What is the difference between BOLA and BFLA? Give an example of each from a CRUD API.
- How does mass assignment happen in Express and in ASP.NET Core, and what fixes it in both directions?
- Why are GUIDs not a fix for BOLA, and how does a global query filter help?
- A user can supply a webhook URL. What SSRF defences do you apply?
- How is "unrestricted access to sensitive business flows" different from ordinary rate limiting?
- Why do forgotten old API versions count as a security risk?
