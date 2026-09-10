# Pagination, filtering and sorting

Every list endpoint you write needs these three, and each has a version that
works on your laptop and fails in production. This guide is the difference.

## Never return an unbounded collection

`GET /orders` returning every order is a bug that ships. It works with 40 rows
and takes the service down with 400,000. Always have a default limit and a
maximum limit, and enforce both server-side:

```
const limit = Math.min(Number(query.limit) || 20, 100);
```

## Offset pagination

```
GET /orders?page=3&limit=20
```

```sql
SELECT * FROM orders ORDER BY created_at DESC LIMIT 20 OFFSET 40;
```

**Good for:** small admin tables, anything where users expect page numbers and
a total count.

**Two real problems:**

1. **It is unstable.** Rows inserted or deleted between page requests shift
   everything. A user paging through a busy feed sees the same record twice, or
   misses one entirely.
2. **It gets slow.** `OFFSET 100000` still makes the database produce and
   discard 100,000 rows. The cost grows linearly with depth.

## Cursor (keyset) pagination

```
GET /orders?limit=20
GET /orders?limit=20&after=eyJjIjoiMjAyNi0wMy0wMSIsImkiOjkxMn0
```

```sql
SELECT * FROM orders
WHERE (created_at, id) < ($1, $2)
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

The cursor encodes the sort key of the last row you saw. The index seeks
straight to it, so page 5,000 costs the same as page 1.

**Details that matter:**

- **Include a tiebreaker.** Sorting by `created_at` alone is not a total order —
  two rows with the same timestamp can be returned in either order, which
  duplicates or skips rows at page boundaries. Add the primary key.
- **Make the cursor opaque.** Base64 an object rather than exposing
  `?after_created_at=...`. Then you can change the sort key later without
  breaking clients, and nobody builds a dependency on the format.
- **The index must match the sort.** `(created_at DESC, id DESC)` here.
- **No random access, no cheap total count.** That is the trade-off.

**Default to cursor** for feeds, activity logs, infinite scroll and anything
with a lot of writes.

## Response envelope

The client needs enough to continue:

```json
{
  "data": [ ... ],
  "page": {
    "nextCursor": "eyJjIjoi...",
    "hasMore": true,
    "limit": 20
  }
}
```

For offset, include `total` if you can afford the second query. `COUNT(*)` on a
large filtered set is expensive — an approximate count, or no count at all, is
often the right answer.

## Filtering

Query parameters on the collection:

```
GET /orders?status=open&customerId=42&createdAfter=2026-01-01&minTotal=1000
```

Rules:

- **Whitelist every filterable field.** Building a WHERE clause from arbitrary
  parameter names is an injection risk and lets a client force a full table scan
  on an unindexed column.
- **Multiple values:** pick `?status=open&status=pending` or
  `?status=open,pending` and be consistent.
- **Ranges:** `createdAfter` / `createdBefore` reads better than an operator
  syntax like `created[gte]`, and is easier to validate.
- **Parse and validate types.** `?limit=abc` should be a 400, not a crash or a
  silent NaN.

Resist inventing a query language in query parameters. Once you need boolean
logic and nesting, either accept a POST with a structured body to a `/search`
endpoint, or admit you want GraphQL.

## Sorting

```
GET /orders?sort=-createdAt,total
```

Leading `-` means descending. One convention, documented.

**Whitelist sortable fields.** This one is not optional:

```js
const SORTABLE = { createdAt: 'created_at', total: 'total_cents', status: 'status' };

const column = SORTABLE[field];
if (!column) throw new BadRequest(`Cannot sort by ${field}`);
```

A column name cannot be a query parameter, so it must come from a map you
control. This is the one place where the usual "parameterise everything" advice
does not save you.

Also: every sortable field needs an index, or you have just given clients a way
to make your database sort a million rows on demand.

## Searching

`?q=blue widget` is a different thing from a filter and deserves different
treatment:

- `LIKE '%term%'` cannot use a normal index — it is a full scan. Fine on 10,000
  rows, not on 10 million.
- Full-text search (Postgres `tsvector`, SQL Server full-text) handles stemming,
  ranking and word boundaries, and can be indexed.
- A dedicated search engine (Elasticsearch, Meilisearch, Typesense) is the next
  step up, at the cost of keeping a second store in sync.

Start with the simplest thing that is fast enough, and know what the next step
is.

## Frontend concerns

**Put the filter state in the URL.** Not in component state:

```
/orders?status=open&sort=-createdAt&page=3
```

The view becomes shareable, bookmarkable, and survives a refresh and the back
button. The rule of thumb: state that describes *what you are looking at*
belongs in the URL; state that describes *how the UI is arranged right now* (a
collapsed panel) does not.

**Debounce the search box** but not the filter dropdowns — a dropdown change is
a deliberate single action, and delaying it just feels broken.

**Cancel superseded requests.** Type fast and the response for "blu" can arrive
after the response for "blue". Use an `AbortController`, or ignore any response
that is not for the current query.

**Reset to page 1 when a filter changes.** Being on page 7 of a result set that
now has two pages shows an empty screen that looks like a bug.

## The checklist

- [ ] Default limit and enforced maximum
- [ ] Cursor pagination for anything busy; offset only where page numbers matter
- [ ] Total order in the sort — always include a tiebreaker
- [ ] Filterable and sortable fields whitelisted and indexed
- [ ] Opaque cursors
- [ ] Filter state in the URL on the client
- [ ] Superseded requests cancelled
- [ ] Page resets when filters change
