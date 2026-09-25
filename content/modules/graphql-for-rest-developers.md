# GraphQL (and gRPC) for REST developers

You will be asked "have you used GraphQL?" and, more usefully, "would you use it
here?". The strong answer is not enthusiasm; it is knowing which REST problems
GraphQL solves, which new ones it creates (N+1, caching, query cost, per-field
authorisation), and when neither it nor gRPC earns its keep in a CRUD app.

## The model in five minutes

A GraphQL server publishes a **typed schema**. Clients send a **document** that
selects exactly the fields they want, and the response mirrors its shape.

```graphql
type Query {
  order(id: ID!): Order
  orders(first: Int = 20, after: String): OrderConnection!
}

type Mutation {
  cancelOrder(id: ID!, reason: String): CancelOrderPayload!
}

type Order {
  id: ID!
  status: OrderStatus!
  totalPence: Int!
  customer: Customer!      # a relationship, resolved on demand
  lines: [OrderLine!]!
}

enum OrderStatus { PENDING PAID SHIPPED CANCELLED }
```

```graphql
query OrderScreen($id: ID!) {
  order(id: $id) {
    status
    totalPence
    customer { name email }
  }
}
```

`!` means non-null. A **query** reads, a **mutation** writes (and runs its
top-level fields in order), a **subscription** pushes updates over WebSockets
or server-sent events. Every field on every type is backed by a **resolver**:
a function `(parent, args, context) => value`. If a resolver is not written,
the default one reads the property of the same name from the parent object.

```js
const resolvers = {
  Query: {
    order: (_, { id }, ctx) => ctx.db.orders.findForUser(id, ctx.user.id),
  },
  Order: {
    customer: (order, _, ctx) => ctx.loaders.customer.load(order.customerId),
  },
};
```

In Node you would host this with Apollo Server or GraphQL Yoga; in .NET, Hot
Chocolate is the usual choice.

## Mapping REST concepts across

| REST | GraphQL |
|---|---|
| Many URLs, one per resource | One endpoint, usually `POST /graphql` |
| HTTP method says read or write | `query` versus `mutation` in the document |
| Response shape fixed by the server | Response shape chosen by the client, within the schema |
| `GET /orders/7` then `GET /customers/3` | One query following the `customer` field |
| `?fields=id,status` sparse fieldsets | Built in: you only get what you select |
| OpenAPI document | The schema itself, queryable by introspection |
| Status codes for errors | Usually `200` with an `errors` array |
| Versioning with `/v2` | Add fields, mark old ones `@deprecated`, never version |
| HTTP caching with `Cache-Control`, ETag | Mostly unavailable; caching moves to the client |

**Over-fetching** (the endpoint returns 40 fields; the card shows 3) and
**under-fetching** (one screen needs five round trips) are the problems GraphQL
was built for. REST patches them by hand with sparse fieldsets, `?include=`
expansions, or a backend-for-frontend endpoint per screen.

## N+1 and DataLoader

Resolvers run per field, per object. Ask for 50 orders with their customers and
a naive `Order.customer` resolver issues one query for the orders and fifty for
the customers: GraphQL's signature performance bug.

The fix is **batching per request**: collect every key requested in the same
tick, then load them in one query. That is what the `dataloader` package (and
Hot Chocolate's built-in data loaders) do. The core idea fits in fifteen lines,
and this version runs as written on Node 24:

```js
function createLoader(batchFn) {
  let queue = [];
  return (key) => new Promise((resolve, reject) => {
    queue.push({ key, resolve, reject });
    if (queue.length === 1) queueMicrotask(async () => {
      const batch = queue; queue = [];
      try {
        const rows = await batchFn([...new Set(batch.map((b) => b.key))]);
        const byId = new Map(rows.map((r) => [r.id, r]));
        batch.forEach((b) => b.resolve(byId.get(b.key) ?? null));
      } catch (e) { batch.forEach((b) => b.reject(e)); }
    });
  });
}
// four loads for authors 1, 2, 1, 3 → one query: WHERE id IN (1, 2, 3)
```

Two rules: create loaders **per request** (in the context), never globally, or
one user's cached rows leak into another's response; and have the batch
function return results in key order, with nulls for misses. The same N+1 shape
appears in EF Core with lazy loading, covered in
[EF Core relationships and loading](ef-core-relationships-loading.md).

## Errors, 200s and partial data

A GraphQL response can contain both `data` and `errors`:

```json
{
  "data": { "order": { "status": "PAID", "customer": null } },
  "errors": [{
    "message": "Not authorised to view customer",
    "path": ["order", "customer"],
    "extensions": { "code": "FORBIDDEN" }
  }]
}
```

The order loaded; one field failed and was nulled. If that field were non-null
(`Customer!`), the null would propagate up to the nearest nullable parent,
possibly wiping out the whole `order`. So nullability is a resilience decision,
not just a typing one.

Consequences for you:

- With `application/json`, servers traditionally return **200 even for
  errors**, so monitoring that counts 5xx sees nothing. Instrument the `errors`
  array. The GraphQL-over-HTTP specification's
  `application/graphql-response+json` lets servers use 4xx for requests that
  fail entirely (parse or validation errors), but field errors are still 200.
- Clients must check `errors` on every response, not just the status.
- Put a machine-readable code in `extensions.code`, the GraphQL equivalent of
  the `code` in [problem details](api-error-design.md).
- Expected business failures (card declined) are often better modelled in the
  schema as result types or union payloads than as errors.

## Caching and persisted queries

REST reads are `GET` requests with URLs, so browsers, CDNs and proxies cache
them for free (see [HTTP caching end to end](http-caching-end-to-end.md)).
GraphQL queries are usually `POST` bodies, which no shared cache stores. Caching
moves into the client: Apollo Client and urql keep a normalised cache keyed by
`__typename` and `id`, which is powerful and a source of subtle staleness bugs.

**Persisted queries** win some of it back. The client sends a hash of a query
the server already knows instead of the full text:

```http
GET /graphql?extensions={"persistedQuery":{"version":1,"sha256Hash":"ab12..."}}&variables={"id":"7"}
```

That is a `GET` with a stable URL, so a CDN can cache it. In the stricter form,
**trusted documents**, the server accepts *only* hashes registered at build
time, which is also a strong security control: arbitrary queries from outsiders
are simply rejected.

## Securing a GraphQL API

One endpoint that accepts arbitrary queries needs defences REST gets from its
fixed routes:

| Threat | Defence |
|---|---|
| Deeply nested query (`author { posts { author { posts ... } } }`) | Maximum depth limit |
| Cheap-looking query returning millions of nodes | Cost or complexity analysis; mandatory `first` with a cap on lists |
| Aliases or batched operations to brute-force a login in one request | Count aliases and operations per request; rate limit by operations, not HTTP requests |
| Schema discovery | Disable introspection in production for private APIs (defence in depth, not a control) |
| Reading fields you should not | **Authorisation per field and per object**, in resolvers or the domain layer |

The last row is where real breaches happen. A REST endpoint has one place to
check ownership; a graph lets a caller reach
`order.customer.paymentMethods` by paths you never considered. Authorise in the
business layer each resolver calls, not at the edge. The same object-level checks appear
in the [OWASP API Top 10](owasp-api-top-10.md) and apply doubly here. Also turn
off detailed error messages in production so exceptions do not leak into
`errors[].message`.

## When GraphQL is (and is not) worth it

Worth it when:

- Several clients (web, iOS, Android, partners) need different slices of the
  same data and you are tired of per-client endpoints.
- One gateway aggregates several backend services into one graph.
- The frontend team moves faster than the backend and wants to own data needs.

Not worth it when you are building **one web app over one database with one
team**, which is most CRUD work. You would take on resolver plumbing,
DataLoaders, cost limits, a client cache and bespoke monitoring to solve an
over-fetching problem a well-designed REST endpoint, or a BFF, solves in an
afternoon. Say that in an interview; it shows judgement rather than fashion.

## gRPC, briefly

gRPC is the other alternative you should be able to place. It is typed remote
procedure calls, defined in Protocol Buffers:

```protobuf
syntax = "proto3";
service Orders {
  rpc GetOrder (GetOrderRequest) returns (Order);
  rpc WatchOrders (WatchRequest) returns (stream Order); // server streaming
}
message Order {
  string id = 1;
  int64 total_pence = 2;
  reserved 3;               // was 'note'; never reuse the number
  OrderStatus status = 4;
}
```

What matters:

- **Field numbers, not names, go on the wire.** Rename freely; never change or
  reuse a number. Mark removed ones `reserved`. That is the whole compatibility
  story, and a favourite interview question.
- **Binary and HTTP/2.** Compact and fast, with unary, server-streaming,
  client-streaming and bidirectional calls, plus deadlines that propagate.
- **Codegen everywhere.** `protoc` or `buf` generate clients and servers;
  ASP.NET Core hosts services with `Grpc.AspNetCore`.
- **Browsers cannot speak it directly.** They cannot control HTTP/2 framing
  and trailers, so you need **gRPC-Web** through a proxy (Envoy) or the
  Connect protocol, or ASP.NET Core's JSON transcoding to expose REST too.

Use gRPC for service-to-service calls inside your own system. For a browser
talking to its own backend, REST remains the default, as argued in
[REST API design](rest-api-design.md).

## What you should be able to answer

- How do schema, query, mutation and resolver relate, and how does a query map onto REST calls?
- What is the N+1 problem in GraphQL, and how does a DataLoader fix it? Why per request?
- Why do GraphQL APIs often return 200 for errors, and what does partial data mean for nullability?
- Why is HTTP caching harder with GraphQL, and what do persisted queries change?
- Name three GraphQL-specific security controls and where authorisation belongs.
- In gRPC, why must you never reuse a field number, and how does a browser call a gRPC service?
