# Joins in depth

Every CRUD interview has a join in it, and most wrong answers are not syntax
errors: they are rows that vanish, rows that double, or totals that are quietly
too high. This guide goes past "INNER keeps matches, LEFT keeps everything on
the left" (covered in [sql-fundamentals.md](sql-fundamentals.md)) to the
behaviours that cause real bugs.

Examples use Postgres 17 syntax and this data; most also run unchanged on
SQLite 3.39+, and on SQL Server 2022 with `TOP` in place of `LIMIT`.

```sql
-- customers: (1, 'Ana'), (2, 'Ben'), (3, 'Cy')
-- orders:    (10, customer 1, 'paid', 100), (11, customer 1, 'void', 40),
--            (12, customer 2, 'paid', 50)
-- payments:  (1, order 10, 60), (2, order 10, 40), (3, order 12, 50)
```

## A join is a filtered pairing

Think of every join as: pair each left row with each right row, keep the pairs
where `ON` is true. That model explains almost everything else.

- **Row count follows matches.** A customer with three orders appears three
  times. That is correct, and it is also the root of fan-out bugs below.
- **`ON` decides pairing; `WHERE` decides survival.** For an inner join they are
  interchangeable. For outer joins they are not.
- **Join algorithms never change results.** Hash, merge and nested-loop joins
  are planner choices about speed. If your row count changes, your query
  changed, not the plan.

## ON versus WHERE with an outer join

The single most common join bug. Compare these two "customers with their paid
orders" queries:

```sql
-- A: filter in ON
SELECT c.name, o.id
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id AND o.status = 'paid';
-- Ana 10, Ben 12, Cy NULL

-- B: filter in WHERE
SELECT c.name, o.id
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
WHERE o.status = 'paid';
-- Ana 10, Ben 12   (Cy has gone)
```

In B the LEFT JOIN produced a row for Cy with NULLs, then `WHERE o.status =
'paid'` evaluated `NULL = 'paid'`, which is unknown, so the row was dropped.
You have written an inner join with extra steps.

The rule: **conditions on the optional side of an outer join belong in `ON`**.
Conditions on the preserved side (for example `c.country = 'GB'`) belong in
`WHERE`. The one legitimate `WHERE` test on the optional side is `IS NULL`,
which is the anti-join pattern.

## Fan-out: why totals double

Joining two one-to-many relationships multiplies rows. Ana's order 10 has two
payments, so joining orders to payments gives order 10 twice:

```sql
SELECT c.name, SUM(o.total) AS revenue
FROM customers c
JOIN orders o   ON o.customer_id = c.id
JOIN payments p ON p.order_id = o.id
GROUP BY c.name;
-- Ana 200   (should be 100)
```

The fix is to aggregate each child **before** joining, so each side contributes
one row per key:

```sql
WITH paid AS (
  SELECT order_id, SUM(amount) AS paid
  FROM payments GROUP BY order_id
)
SELECT o.id, o.total, COALESCE(paid.paid, 0) AS paid
FROM orders o
LEFT JOIN paid ON paid.order_id = o.id;
```

`SUM(DISTINCT o.total)` looks like a fix and is not: two different orders with
the same total collapse into one. Whenever a report number looks too high, count
rows per key after each join; the join that multiplies them is your culprit.

## Semi-joins and anti-joins

Often you do not want the child rows at all, only to know whether one exists.

| Question | Idiom | Returns each parent |
| --- | --- | --- |
| Customers with at least one order | `WHERE EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.id)` | once |
| Customers with no orders | `WHERE NOT EXISTS (...)` | once |
| Same, join form | `LEFT JOIN orders o ON ... WHERE o.id IS NULL` | once |
| Tempting but wrong | `JOIN orders` then `DISTINCT` | once, after extra work |

`EXISTS` stops at the first match and never duplicates the parent. Modern
Postgres and SQL Server plan `IN (subquery)` and `EXISTS` the same way, as a
semi-join, so choose on clarity.

`NOT IN` is the trap. If the subquery returns a single NULL, `x NOT IN (...)`
is never true, and the query returns nothing:

```sql
SELECT name FROM customers
WHERE id NOT IN (SELECT customer_id FROM orders);  -- empty if any customer_id is NULL
```

Use `NOT EXISTS` by default. See [sql-null-three-valued-logic.md](sql-null-three-valued-logic.md)
for why.

## Self-joins and non-equi joins

A self-join is an ordinary join where both sides are the same table under
different aliases. Use LEFT when the relationship is optional:

```sql
SELECT e.name, m.name AS manager
FROM employees e
LEFT JOIN employees m ON m.id = e.manager_id;  -- keeps the CEO
```

Joins do not have to use `=`. Range joins answer "which price applied on the
order date?":

```sql
SELECT o.id, pr.amount
FROM orders o
JOIN prices pr
  ON pr.product_id = o.product_id
 AND o.created_at >= pr.valid_from
 AND o.created_at <  COALESCE(pr.valid_to, 'infinity');
```

If `prices` ever has overlapping ranges for a product, this fans out too.
Postgres can prevent that with an exclusion constraint; elsewhere, test for it.

## FULL OUTER and CROSS JOIN

`FULL OUTER JOIN` keeps unmatched rows from both sides. Its natural use is
reconciliation: ledger versus bank statement, where you want "in ours only",
"in theirs only" and "in both" in one pass. SQLite gained it in 3.39; MySQL still
lacks it (emulate with a LEFT JOIN `UNION` a RIGHT JOIN anti-join).

`CROSS JOIN` returns every pairing deliberately: sizes × colours to generate
variants, or users × days to build a calendar grid you then LEFT JOIN facts
onto. The accidental version is `FROM a, b` with the join condition forgotten
in `WHERE`, which is one reason teams require explicit `JOIN ... ON`.

## Top N per parent: LATERAL and APPLY

"Each customer with their three latest orders" cannot be done with a plain join
plus `LIMIT`, because `LIMIT` applies to the whole result. Two good options:

```sql
-- Postgres: LATERAL lets the subquery see c
SELECT c.name, o.id, o.created_at
FROM customers c
LEFT JOIN LATERAL (
  SELECT id, created_at FROM orders
  WHERE customer_id = c.id
  ORDER BY created_at DESC
  LIMIT 3
) o ON true;
```

SQL Server writes the same thing as `OUTER APPLY (SELECT TOP 3 ...)`. With an
index on `orders (customer_id, created_at DESC)` each lookup is a short index
read. The portable alternative is `ROW_NUMBER()` partitioned by customer and
filtered to `<= 3`, covered in
[sql-window-functions-for-reporting.md](sql-window-functions-for-reporting.md).
LATERAL wins when parents are few and children many; the window version wins
when you need most rows anyway.

## Joins and indexes

The planner can only make a join cheap if the join keys are indexed where it
needs them:

- Primary keys are indexed automatically.
- **Foreign key columns are not**, in Postgres or SQL Server. Index
  `orders.customer_id` yourself; it serves joins, "orders for this customer"
  pages, and cascade checks on delete.
- A composite index that starts with the join key and continues with the sort
  key (`customer_id, created_at`) serves both the join and the `ORDER BY`.

Practise these against the orders schema in
[../../86-sqlite-orders/](../../86-sqlite-orders/), then read the plan for each
(see [sql-indexes-and-query-plans.md](sql-indexes-and-query-plans.md)).

## What you should be able to answer

- Why does moving a condition from `ON` to `WHERE` turn a LEFT JOIN into an inner join, and when is a `WHERE` test on the right side correct?
- A revenue report doubled after someone added a join to payments. How do you find the cause and fix it without `DISTINCT`?
- Why is `NOT EXISTS` safer than `NOT IN` for "customers with no orders"?
- How do you list each customer with their three most recent orders, in Postgres and in SQL Server?
- When would you use a FULL OUTER JOIN or a CROSS JOIN on purpose?
- Which join columns do you index yourself, and why is the foreign key column not indexed for you?
