# REST API design that survives review

You will be asked to design an API in an interview. Not a distributed system —
an API. "Design the endpoints for a task management app" or "how would you
expose orders and their line items". This guide is the checklist a good answer
walks through.

## The one-sentence version

**The URL is a noun, the method is the verb, the status code is the outcome, and
the body has a shape you promised.**

Most bad APIs break one of those four.

## Naming resources

```
GET    /orders                 list
POST   /orders                 create
GET    /orders/7               read one
PUT    /orders/7               replace
PATCH  /orders/7               partial update
DELETE /orders/7               remove
GET    /orders/7/items         sub-resource list
```

Rules that hold up:

- **Plural nouns.** `/orders`, not `/order` or `/getOrders`.
- **No verbs in the path.** The method is the verb. `/orders/7/cancel` is a
  compromise people make for actions that are not really CRUD — it is
  acceptable, but reach for it only when modelling the action as a resource
  (`POST /orders/7/cancellation`) genuinely reads worse.
- **Nest one level, at most two.** `/users/42/orders` is fine.
  `/users/42/orders/7/items/3/discounts` is not — once you have the item id,
  `/order-items/3` is enough.
- **Lowercase, hyphens, not underscores or camelCase**, in paths.

## Choosing a status code

Work through this in order:

1. Did we understand the request? No → **400**.
2. Do we know who they are? No → **401**.
3. Are they allowed? No → **403** (or 404 if existence itself is a secret).
4. Does the thing exist? No → **404**.
5. Does it clash with current state? Yes → **409**.
6. Are they going too fast? Yes → **429** with `Retry-After`.
7. Did we break? Yes → **500** (and log it with a correlation id).
8. Otherwise: **200**, **201** with `Location`, or **204**.

An empty list is **200 with `[]`**, never 404. The collection exists; it is
empty. Returning 404 forces every client to treat a normal case as an error.

## A consistent error body

Pick one shape and use it everywhere. ProblemDetails (RFC 9457, which replaced
RFC 7807 in 2023 with the same shape) is a good default and ASP.NET Core emits
it natively:

```json
{
  "type": "https://example.com/errors/validation",
  "title": "One or more validation errors occurred.",
  "status": 400,
  "detail": "See errors for field-level messages.",
  "instance": "/api/orders",
  "traceId": "0HN7...",
  "errors": {
    "quantity": ["must be greater than 0"],
    "productId": ["is required"]
  }
}
```

What matters:

- A **stable machine-readable code** the client can branch on. Clients must
  never have to match on English prose.
- **Field-level detail** for validation, so a form can highlight the right
  inputs.
- A **trace id** the user can quote to support, matching a log entry.
- **No stack traces.** Ever. They tell an attacker your framework version, your
  file paths, and sometimes your connection string.

## Request validation

Validate at the edge — the first thing the handler does, before anything
touches the database. Then the rest of your code can trust its inputs.

Return **all** the errors, not just the first one. A form that reveals one
problem per submit is a genuinely bad experience and it is a two-line change to
fix.

And remember: client-side validation is a UX feature. Anyone can `curl` your
endpoint. Every rule that matters is enforced server-side.

## Pagination

Never return an unbounded collection. Offset (`?page=3&limit=20`) is simple and
fine for a small admin table; cursor (`?after=…&limit=20`) is stable under
inserts and fast at any depth, so default to it for feeds and anything busy.
The details, including the SQL, are in [the pagination
guide](api-pagination-filtering.md). Always send back enough for the client to
continue:

```json
{
  "data": [ ... ],
  "page": { "nextCursor": "eyJpZCI6...", "hasMore": true }
}
```

## Filtering, sorting, searching

Query parameters on the collection:

```
GET /orders?status=open&customerId=42&sort=-createdAt&q=blue&limit=20
```

- Prefix a sort field with `-` for descending. One convention, documented.
- **Whitelist sortable and filterable fields.** Passing user input into an
  `ORDER BY` is an injection risk and an accidental full table scan.
- Multiple values: `?status=open&status=pending` or `?status=open,pending`.
  Pick one.

## Shaping responses

- **Return the created resource** from a POST. It saves the client a round trip
  and gives them the server-assigned id and timestamps.
- **Do not leak internal fields.** Derive a DTO from your entity rather than
  serialising it directly — `Omit<User, 'passwordHash'>` in TypeScript, a
  projection in C#. Then a sensitive column added later cannot leak by default.
- **Be consistent about casing and dates.** camelCase keys, ISO-8601 UTC
  timestamps with an offset. Decide once.
- **Do not wrap single objects in a needless envelope.** `{"data": {...}}` on
  every response is noise unless you have a reason (pagination metadata is a
  reason).

## Versioning

The best version strategy is not needing one:

- Adding a field is backwards compatible **if clients ignore unknown fields**.
- Removing a field, renaming one, or changing a type is breaking.
- Changing the meaning of an existing field is the worst kind of breaking,
  because nothing fails loudly.

When you genuinely must break something, `/v2/orders` in the path is the
simplest thing that works and it is trivially visible in logs. Header-based
versioning is purer and harder to debug. Whichever you pick: run both, announce
a deprecation window, and measure who is still on the old one.

## Concurrency

Two users open the same order and both save. Without protection the second
write silently discards the first — the **lost update**.

The HTTP-native fix is ETag plus `If-Match`:

```
GET /orders/7        ->  ETag: "v3"
PUT /orders/7
If-Match: "v3"       ->  412 Precondition Failed if it changed
```

Turn that 412 (or 409) into a real UI message: "this order changed while you
were editing". Silently winning is worse than an error.

## Idempotency for POST

POST is not idempotent, so a retry creates a duplicate. For anything that
creates money, orders, or messages, accept a client-generated key:

```
POST /payments
Idempotency-Key: 9f2b1c...
```

Store the key with the result. A repeat of the same key replays the stored
response instead of doing the work twice. This is how every payment API works
and it is a strong thing to mention unprompted. `Idempotency-Key` is the
de-facto header name; it is still an IETF draft rather than a finished standard.

## Long-running work

Do not hold a request open for 40 seconds. Accept, queue, and return a handle:

```
POST /reports        ->  202 Accepted
                         Location: /reports/8f3
GET  /reports/8f3    ->  200 { "status": "running" }
                     ->  200 { "status": "done", "url": "..." }
```

## Documentation

An API nobody can call is not finished. OpenAPI generated from the code (rather
than maintained separately, where it will drift) gives you a browsable spec,
generated clients, and a contract you can test against.

In ASP.NET Core, the templates since .NET 9 use the built-in
`Microsoft.AspNetCore.OpenApi` package (`AddOpenApi()` and `MapOpenApi()`) and
no longer ship Swashbuckle. Older tutorials that start with `AddSwaggerGen()`
still work, but that is no longer the default. Pair the document with a UI such
as Scalar or Swagger UI if you want one.

## REST vs GraphQL vs gRPC

"Why not GraphQL?" is a common follow-up. Have a short, balanced answer:

| | REST | GraphQL | gRPC |
|---|---|---|---|
| Shape | Resources and HTTP verbs | One endpoint; the client writes a query for the fields it wants | Typed remote procedure calls from `.proto` files |
| HTTP caching | Works out of the box (GET, ETag, CDN) | Mostly lost: everything is a POST to `/graphql` | None; binary over HTTP/2 |
| Best at | Public and CRUD APIs, most web apps | Many clients with different data needs (web, iOS, Android), aggregating several backends | Service-to-service calls inside your own system |
| Costs | Over- or under-fetching; several round trips for one screen | N+1 through resolvers (needs a DataLoader), authorisation per field, query-cost limits | Not callable from a browser without a proxy; harder to debug by hand |

GraphQL earns its complexity when many clients need different slices of the
same data, or when one team fronts several services. For one web app talking
to its own backend, REST is less work. gRPC is for backends talking to
backends, where the typed contract and speed matter and nobody opens it in a
browser. (tRPC, in TypeScript monorepos, gives end-to-end types by sharing the
server's function signatures with the client; it only works when both ends are
TypeScript.)

## The design questions to ask out loud in an interview

Interviewers are usually testing whether you ask these at all:

- Who consumes this — one first-party app, or many unknown clients?
- What is the expected scale, and how big can a collection get?
- Is any of it public, or is everything behind auth?
- What happens when two people edit the same record?
- What must be transactional?
- What is the retry story — can this be safely called twice?

Naming three of those before writing an endpoint is what a mid-level answer
looks like.
