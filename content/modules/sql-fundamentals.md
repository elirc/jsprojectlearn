# SQL you will be asked to write

This is the biggest gap in most self-taught developers' knowledge and the one
interviewers probe hardest for CRUD roles. You will be asked to write a JOIN on
a whiteboard or in a shared editor. This guide covers what that actually
requires.

Examples use PostgreSQL syntax; SQL Server and MySQL differ mostly in function
names and in `LIMIT` vs `TOP` vs `OFFSET/FETCH`.

## The schema we will use

```sql
CREATE TABLE customers (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id           BIGSERIAL PRIMARY KEY,
  customer_id  BIGINT NOT NULL REFERENCES customers(id),
  status       TEXT NOT NULL,
  total_cents  BIGINT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_customer ON orders(customer_id, created_at DESC);
```

Note three things already: money as an integer of cents, timestamps with a
timezone, and an index on the foreign key. All three come up below.

## The clauses, in execution order

You write them in one order and the database evaluates them in another. This
explains most beginner confusion:

| Written | Evaluated | |
|---------|-----------|---|
| SELECT | 5 | which columns |
| FROM / JOIN | 1 | which rows, combined how |
| WHERE | 2 | filter individual rows |
| GROUP BY | 3 | collapse into groups |
| HAVING | 4 | filter groups |
| ORDER BY | 6 | sort |
| LIMIT | 7 | truncate |

Two consequences you will be tested on:

- **You cannot use a SELECT alias in WHERE** (WHERE runs first), but you *can*
  in ORDER BY.
- **WHERE filters rows, HAVING filters groups.** `WHERE status = 'paid'` narrows
  the input; `HAVING COUNT(*) > 5` narrows the result. Filter in WHERE where you
  can — fewer rows to aggregate.

## JOINs, properly

```sql
-- Only customers who have ordered
SELECT c.name, o.total_cents
FROM customers c
INNER JOIN orders o ON o.customer_id = c.id;

-- Every customer, with NULLs where there is no order
SELECT c.name, o.total_cents
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id;
```

**INNER** keeps rows that match on both sides. **LEFT** keeps every row from the
left table, filling the right side with NULLs when there is no match. RIGHT is
LEFT with the tables swapped and is rarely used. FULL keeps unmatched rows from
both sides.

The question that gets asked: *"Show every customer and how many orders they
have, including customers with none."*

```sql
SELECT c.id, c.name, COUNT(o.id) AS order_count
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
GROUP BY c.id, c.name
ORDER BY order_count DESC;
```

Two traps in that query, both deliberate:

1. **`COUNT(o.id)`, not `COUNT(*)`.** `COUNT(*)` counts rows, and a customer with
   no orders still produces one row from the LEFT JOIN — so they would score 1
   instead of 0. `COUNT(column)` skips NULLs.
2. **Everything in SELECT must be grouped or aggregated.** Postgres errors if
   you forget; MySQL historically picked a value arbitrarily, silently producing
   wrong reports.

### The LEFT JOIN killed by WHERE

This is the single most common SQL bug, and a great interview question:

```sql
-- Broken: silently becomes an INNER JOIN
SELECT c.name, o.total_cents
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.status = 'paid';
```

For a customer with no orders, `o.status` is NULL, and `NULL = 'paid'` is not
true — so the row is filtered out. Move the condition into the ON clause:

```sql
LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'paid'
```

**Rule: conditions on the outer-joined table belong in ON, not WHERE.**

## NULL is not a value

`NULL` means *unknown*. Any comparison with it is unknown, which is not true.

- `NULL = NULL` → not true. Use `IS NULL`.
- `WHERE status NOT IN ('a', 'b', NULL)` returns **no rows at all**, because
  the comparison against NULL is never true.
- `COUNT(col)` skips NULLs; `COUNT(*)` does not.
- `SUM` of an empty set is NULL, not 0. Use `COALESCE(SUM(x), 0)`.

## Aggregation

```sql
SELECT
  date_trunc('month', created_at) AS month,
  COUNT(*)                        AS orders,
  SUM(total_cents)                AS revenue_cents,
  AVG(total_cents)::int           AS avg_cents
FROM orders
WHERE status = 'paid'
GROUP BY 1
HAVING COUNT(*) > 10
ORDER BY 1 DESC;
```

`GROUP BY 1` refers to the first select expression — convenient, and accepted
in most engines.

## Window functions: top N per group

The classic "show me the 3 most recent orders per customer". `GROUP BY` cannot
do it — grouping collapses rows and you want to keep them.

```sql
SELECT * FROM (
  SELECT
    o.*,
    ROW_NUMBER() OVER (
      PARTITION BY o.customer_id
      ORDER BY o.created_at DESC
    ) AS rn
  FROM orders o
) ranked
WHERE rn <= 3;
```

`PARTITION BY` restarts the numbering per group; the window function runs over
the rows without collapsing them. Also useful: `RANK()`, `LAG()`/`LEAD()` for
comparing a row to the previous one, and `SUM(...) OVER (...)` for running
totals.

Being able to write this is a genuine mid-level marker.

## Indexes

An index is a sorted structure over one or more columns, letting the database
seek instead of scanning every row.

**Index what you filter, join and sort on.** Do not index everything: every
index must be updated on every INSERT, UPDATE and DELETE, and each one costs
storage.

Things that surprise people:

- **A function on the column disables the index.**
  `WHERE LOWER(email) = 'a@b.com'` cannot use an index on `email`. Store the
  value normalised, use a case-insensitive collation, or create a functional
  index on `LOWER(email)`.
- **Leading wildcards disable it too.** `LIKE '%smith'` cannot seek. `LIKE
  'smith%'` can.
- **Composite index order matters.** An index on `(customer_id, created_at)`
  serves `WHERE customer_id = ?`, and `WHERE customer_id = ? ORDER BY
  created_at` — but not `WHERE created_at > ?` alone. Put the equality column
  first.
- **A foreign key is not automatically indexed** in every engine, and an
  unindexed FK makes cascading deletes crawl.
- **Low-cardinality columns rarely benefit.** An index on a boolean usually
  earns nothing.

## Reading a query plan

```sql
EXPLAIN ANALYZE
SELECT * FROM orders WHERE customer_id = 42;
```

What to look for:

- `Seq Scan` on a large table where you expected `Index Scan` — a missing or
  unusable index.
- A row-estimate wildly different from the actual count — stale statistics, or
  a predicate the planner cannot reason about.
- A nested loop over a large outer relation — often the join order or a missing
  index.

"How would you diagnose a slow query?" — *turn on query logging, find it, run
EXPLAIN ANALYZE, look for a sequential scan.* That answer is enough.

## Transactions

```sql
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
UPDATE accounts SET balance = balance + 100 WHERE id = 2;
COMMIT;
```

**ACID:**

- **Atomic** — all statements commit or none do.
- **Consistent** — constraints hold before and after.
- **Isolated** — concurrent transactions do not see each other's partial work.
- **Durable** — once committed, it survives a crash.

Keep transactions short. A transaction held open across a network call or user
think-time holds locks and exhausts the connection pool.

### Isolation levels, in brief

Default is usually READ COMMITTED: you never read uncommitted data, but the same
query twice in one transaction can return different results. REPEATABLE READ and
SERIALIZABLE add guarantees at the cost of more blocking or more retries. You
mostly do not need to change it — but knowing the default exists is worth a
sentence.

### The lost update

Two users read a row, both edit, both save. The second write silently discards
the first.

**Optimistic** (usual choice): keep a `version` column.

```sql
UPDATE orders
SET status = 'shipped', version = version + 1
WHERE id = 7 AND version = 3;
```

Zero rows affected means someone got there first — return 409 and tell the user.

**Pessimistic**: `SELECT ... FOR UPDATE` locks the row. Simple, but it holds a
lock for as long as you hold it, which is dangerous across user interaction.

## The N+1 problem

```
SELECT * FROM orders WHERE customer_id = 42;   -- 1 query
-- then, per order, in application code:
SELECT * FROM customers WHERE id = ?;          -- N queries
```

101 round trips for 100 orders. It is invisible in the code — it looks like an
innocent property access — which is why you must log the SQL your ORM generates
in development.

Fixes: a JOIN, an eager-load directive (`Include` in EF Core), or one batched
second query with `WHERE id IN (...)`.

## Preventing SQL injection

Parameterise. Always.

```sql
-- Correct: the value can never become SQL
SELECT * FROM users WHERE email = $1;
```

Parameters are transmitted separately from the query text, so input cannot
become code. Hand-rolled escaping fails on encodings and edge cases.

The one place parameters do not help is **dynamic identifiers** — a column name
in `ORDER BY` cannot be a parameter. That value must come from an allowlist you
control, never from user input.

## Types worth getting right

- **Money**: integer minor units (cents), or `DECIMAL(19,4)`. Never a float —
  binary floats cannot represent 0.10 exactly and sums drift. Store the
  currency alongside it.
- **Timestamps**: UTC, in a timezone-aware column. Convert for display only. A
  local time is ambiguous twice a year.
- **Dates without time** (a birthday, an invoice date) are a genuinely different
  type from an instant. Do not store them as midnight-in-some-timezone.
- **Enums**: a constrained text column with a CHECK, or a lookup table. Native
  enum types are hard to alter later.
- **Ids**: sequential integers are compact and index well but leak volume and
  are enumerable. UUIDs avoid that but fragment a clustered index — use a
  sequential UUID variant if you need both.

## The 20-minute practice list

Write these against the schema above, without looking anything up:

1. All orders for customer 42, newest first.
2. Every customer with their order count, including those with none.
3. Total paid revenue per month for the last 12 months.
4. Customers who have never ordered.
5. The 3 most recent orders per customer.
6. Customers whose total spend exceeds 100,000 cents.
7. Orders with no matching customer (should be none — prove it).
8. Add an index that makes query 1 fast, and say why it works.

If you can do all eight, you are ahead of most candidates for a CRUD role.
