# 86 — SQLite orders (real SQL, zero installs)

**Lesson: the database is not a dumb file you save into. Constraints,
transactions, JOINs, indexes and parameters are where correctness lives —
and each one is a question you will be asked in a CRUD interview.**

## Run it

```
node 86-sqlite-orders/original.js
node 86-sqlite-orders/refactored/cli.js
node 86-sqlite-orders/refactored/cli.js --log-sql
node --test "86-sqlite-orders/**/*.test.js"
```

Uses `node:sqlite` (`DatabaseSync`), built into Node without a flag since 22.13. No `npm install`.
Some Node versions print an `ExperimentalWarning` for it; that's expected.

Read alongside the two guides this project puts into practice:
[`content/modules/sql-fundamentals.md`](../content/modules/sql-fundamentals.md)
(JOINs, the COUNT and WHERE traps, indexes, transactions, N+1, injection,
money types) and
[`content/modules/orm-and-ef-core.md`](../content/modules/orm-and-ef-core.md)
(N+1 in ORM form, logging generated SQL, migrations, transactions).

## What's wrong with the original?

It works — run it and a report prints. Then look closer:

1. **SQL built by string concatenation.** The seed data can't include a
   customer called O'Brien (the apostrophe ends the string literal and the
   statement fails), and a hostile name becomes SQL. The ORDER BY column
   is pasted in too.
2. **Money as `REAL`.** Order #1 prints `$3.3000000000000003`. That's 1.10 +
   2.20 in binary floating point.
3. **N+1.** One query for the page of orders, then one more per order for
   its customer. The report's own counter says 8 statements for 4 orders.
4. **No transaction** around "insert order, insert items". A failure on item
   2 leaves an order with half its items and a stale total.
5. **OFFSET pagination.** Insert an order between page 1 and page 2 and
   page 2 repeats a row.
6. **A schema that trusts everyone.** Foreign keys are off (SQLite's
   default), no UNIQUE on email (duplicates guarded by check-then-insert),
   no CHECK on status, no key on `order_items`, no index, no migrations.
7. **INNER JOIN for "every customer's order count"** — Sam, who never
   ordered, silently isn't in the list.
8. **Queries and `console.log` interleaved** — nothing is testable
   without capturing stdout, nothing is reusable by an API.

## What changed and why

| Original | Refactored | Why |
|---|---|---|
| `"... WHERE email = '" + email + "'"` | `prepare('... WHERE email = ?').get(email)` | The value travels separately from the SQL text, so it can never become SQL. Escaping by hand fails on edge cases; parameters don't have edge cases. |
| `ORDER BY " + sortColumn` | `ORDER_SORTS[sort]` allowlist, `RangeError` otherwise | Identifiers can't be parameters. The client picks a key; only our own strings reach the SQL. `Object.hasOwn` so `"constructor"` isn't a sort. |
| `price REAL`, `total += price * qty` | `INTEGER` cents in `STRICT` tables, `Number.isInteger` at the door | Integers add exactly. `STRICT` makes SQLite reject a stray `19.99` the way Postgres would. |
| Customer fetched per order in a loop | `listOrdersWithCustomer`: one `JOIN` | 1 statement for N orders instead of N+1. The test counts both. `listOrdersNaive` is kept only to be counted. |
| Order and items committed separately | `BEGIN` / `COMMIT` / `ROLLBACK` in `createOrder` | All rows land or none do. The test forces a failure on item 2 and finds zero orders. |
| `LIMIT 2 OFFSET page*2` | Keyset: `WHERE (created_at, id) < (?, ?)`, opaque cursor | A position defined by data doesn't shift when rows are inserted. `id` breaks timestamp ties. The test proves OFFSET repeats a row in the same scenario. |
| No `PRAGMA foreign_keys` | `PRAGMA foreign_keys = ON` in `openDb` | SQLite ships with FK enforcement off, per connection. Without it `REFERENCES` does nothing. |
| Check-then-insert for duplicate email | `email TEXT NOT NULL UNIQUE` + `DuplicateEmailError` | Two requests can both pass the check before either inserts. The constraint has no gap. |
| `status TEXT` | `CHECK (status IN ('pending','paid','shipped','cancelled'))` | The database refuses a status no code path should write. |
| `order_items` with no key | `PRIMARY KEY (order_id, sku)` | One line per product per order; a duplicate line is an error, not a silent double charge. |
| No index | `orders(customer_id, created_at DESC)` and `orders(created_at DESC, id DESC)` | The first serves "orders for customer X, newest first" and the join column (SQLite doesn't index foreign keys automatically). The second matches the keyset query exactly, so each page is an index seek. Two indexes, each for a query that exists. |
| `CREATE TABLE` in the script | Versioned `MIGRATIONS` + `schema_migrations` table | Every database converges on the same schema; each migration runs once, inside its own transaction. |
| `JOIN ... COUNT(*)` | `LEFT JOIN ... COUNT(o.id)`, `COALESCE(SUM(...), 0)` | Customers with no orders appear, with 0 — not missing, not 1, not `null`. |
| Queries mixed with printing | `repository.js` (SQL) → `report.js` (pure text) → `cli.js` (wiring) | The numbers are testable without a console; the queries are reusable by an HTTP handler. |
| No visibility into SQL | `countingDb(db, { onQuery })`, `--log-sql` | N+1 is invisible in code and obvious in a query log. |

## Interviewers ask

- **INNER vs LEFT JOIN?** INNER keeps rows that match on both sides; LEFT
  keeps every left row and fills the right side with NULLs. Then the traps:
  count with `COUNT(o.id)`, not `COUNT(*)` (the NULL row counts as 1); and
  a filter on the right table goes in `ON`, not `WHERE` — `WHERE o.status =
  'paid'` removes the NULL rows and turns your LEFT JOIN into an INNER one.
  Both are tests in `orders.test.js`.
- **What does an index do, and why not index everything?** It's a sorted
  structure that lets the database seek instead of scanning every row.
  Every index is extra work on every INSERT/UPDATE/DELETE and extra storage,
  so index what you filter, join and sort on. Composite order matters:
  `(customer_id, created_at)` serves `WHERE customer_id = ?` but not
  `WHERE created_at > ?` alone.
- **What is N+1 and how do you spot it?** One query for a list, then one per
  row for related data. It hides behind an innocent loop or property access,
  so you find it by logging SQL: `cli.js --log-sql` shows the report is 3
  statements; the original's counter shows it growing per row. Fix with a
  JOIN, eager loading (`Include` in EF Core), or one `WHERE id IN (...)`.
- **Why parameters instead of escaping?** Parameters are sent separately
  from the query text; input can't become code. Escaping is a string
  transformation you have to get right for every encoding and edge case.
  The one gap is identifiers (column names), which come from an allowlist.
- **UNIQUE constraint vs checking first?** Check-then-insert is two
  statements with a gap between them; two concurrent requests both pass the
  check. A UNIQUE constraint is enforced atomically by the database. Insert
  and translate the violation (here: `DuplicateEmailError`, → 409 in an API).
- **OFFSET vs keyset pagination?** OFFSET counts rows, so inserts shift
  pages (duplicates or skips) and deep pages scan everything they skip.
  Keyset says "after this row" using an indexed, unique sort key — stable
  and fast at any depth. Cost: no "jump to page 37", only next/previous.

## Key takeaway

Push every rule the database can enforce into the schema, send every value
as a parameter, and wrap every multi-row write in a transaction. Then count
your queries: a report whose statement count grows with its row count has
an N+1 in it.
