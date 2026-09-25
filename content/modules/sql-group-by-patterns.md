# GROUP BY patterns

Most "write a query" interview tasks are aggregation in disguise: revenue per
month, customers with more than N orders, duplicates to clean up, a dashboard
with five counts per row. The syntax is small; the patterns are what you are
being tested on. This guide assumes the basics of `GROUP BY` and `HAVING` from
[sql-fundamentals.md](sql-fundamentals.md).

Examples are Postgres 17 unless marked. The sample `orders` table has
`customer_id`, `status` ('paid', 'refunded', 'void'), `total` and `created_at`.

## The mental model: rows in, one row per group out

`GROUP BY` sorts rows into buckets by the grouping key, then every aggregate
collapses a bucket to one value. Two consequences follow:

- Every column in `SELECT` must be either in the grouping key or inside an
  aggregate. Postgres relaxes this when you group by a table's primary key (it
  knows the other columns are functionally dependent), but SQL Server does not,
  so the portable habit is to group by `c.id, c.name`.
- `WHERE` filters rows **before** grouping; `HAVING` filters groups **after**.
  A condition that does not mention an aggregate belongs in `WHERE`, where it
  can use an index and shrinks the work.

```sql
SELECT customer_id, SUM(total) AS spend
FROM orders
WHERE status = 'paid'            -- row filter
GROUP BY customer_id
HAVING SUM(total) > 100          -- group filter
ORDER BY spend DESC;
```

## Conditional aggregation: many counts in one pass

Dashboards want several numbers per row. Instead of one query per number, put
the condition inside the aggregate:

```sql
SELECT customer_id,
       COUNT(*)                                        AS orders,
       COUNT(*) FILTER (WHERE status = 'paid')         AS paid,
       SUM(CASE WHEN status = 'refunded' THEN total ELSE 0 END) AS refunded
FROM orders
GROUP BY customer_id;
```

`FILTER` is standard SQL and works in Postgres and SQLite. The `CASE` form works
everywhere, including SQL Server and MySQL. `COUNT(CASE WHEN ... THEN 1 END)`
also works, because `COUNT` skips the NULL the missing `ELSE` produces.

The same trick pivots data: one column per status, per month or per region,
without a `PIVOT` keyword.

## Counting children, including zero

"Orders per customer" must show customers with none. That needs a LEFT JOIN
from the parent and a count of a column on the optional side:

```sql
SELECT c.id, c.name, COUNT(o.id) AS orders
FROM customers c
LEFT JOIN orders o ON o.customer_id = c.id
GROUP BY c.id, c.name;
```

`COUNT(*)` here would report 1 for a customer with no orders, because the LEFT
JOIN produced one row of NULLs for them. If you also join a second child table,
aggregate each child in a subquery first; joining two children then grouping
multiplies rows (see [sql-joins-in-depth.md](sql-joins-in-depth.md)).

## Grouping by time

Group by a truncated timestamp, never by the raw one:

| Engine | Per day | Per month |
| --- | --- | --- |
| Postgres | `date_trunc('day', created_at)` or `created_at::date` | `date_trunc('month', created_at)` |
| SQL Server 2022 | `CAST(CreatedAt AS date)` | `DATETRUNC(month, CreatedAt)` |
| SQLite | `date(created_at)` | `strftime('%Y-%m', created_at)` |

Two traps. First, time zones: `timestamptz` truncates in the session's time
zone, so decide which zone a "day" means (usually the business's) and say so:
`date_trunc('day', created_at AT TIME ZONE 'Europe/London')`. Second, missing
days: a day with no orders has no group, so the chart has a gap instead of a
zero. Generate the calendar and LEFT JOIN onto it:

```sql
SELECT d::date AS day, COUNT(o.id) AS orders
FROM generate_series('2026-03-01'::date, '2026-03-31', interval '1 day') AS d
LEFT JOIN orders o
  ON o.created_at >= d AND o.created_at < d + interval '1 day'
GROUP BY d
ORDER BY d;
```

SQL Server 2022 has `GENERATE_SERIES(0, 30)` for numbers you add to a start
date; older versions use a recursive CTE or a calendar table.

## Group-level conditions: "all", "both", "none"

Row filters answer questions about single rows. Questions about a whole group
need `HAVING` with a comparison of counts.

```sql
-- Customers whose every order is paid
SELECT customer_id
FROM orders
GROUP BY customer_id
HAVING COUNT(*) = COUNT(*) FILTER (WHERE status = 'paid');

-- Customers who bought both product 1 and product 2
SELECT customer_id
FROM order_lines
WHERE product_id IN (1, 2)
GROUP BY customer_id
HAVING COUNT(DISTINCT product_id) = 2;
```

`COUNT(DISTINCT ...)` matters in the second query: without it, buying product 1
twice would pass. Postgres also has `bool_and(status = 'paid')` for the first,
which reads more naturally.

## Finding and removing duplicates

Before adding a unique constraint you must clean the table. Find the
duplicates with a group, then delete all but one row per key with a window
function:

```sql
-- Which emails repeat?
SELECT lower(email), COUNT(*)
FROM users
GROUP BY lower(email)
HAVING COUNT(*) > 1;

-- Keep the oldest row per email
DELETE FROM users
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY lower(email) ORDER BY id) AS rn
    FROM users
  ) t
  WHERE rn > 1
);
```

Run the inner SELECT first, inside a transaction, and check the count before
you delete. Then add the constraint in the same deploy so duplicates cannot
come back.

## Subtotals: ROLLUP and GROUPING SETS

Reports often want per-city rows, per-region subtotals and a grand total.
`ROLLUP` adds them in one query (Postgres, SQL Server, MySQL 8):

```sql
SELECT region, city, SUM(total) AS revenue,
       GROUPING(city) AS is_subtotal
FROM sales
GROUP BY ROLLUP (region, city);
```

Subtotal rows have NULL in the rolled-up column; `GROUPING()` returns 1 for
those, which tells them apart from a genuine NULL city. `GROUPING SETS` lets
you name arbitrary combinations when a strict hierarchy does not fit.

## Aggregate gotchas that ship wrong numbers

- **Empty input gives NULL, not zero.** `SUM(total)` over no rows is NULL, and
  your API returns `null` for revenue. Wrap it: `COALESCE(SUM(total), 0)`.
  `COUNT` is the exception and returns 0.
- **NULLs are skipped.** `AVG(rating)` averages only rated rows. That is often
  right, but decide deliberately, and say so in the report.
- **Integer maths in SQL Server.** `AVG` of an `int` column returns an `int`,
  and `SUM` of `int` overflows past about 2.1 billion. Cast to `decimal` or
  `bigint`. Postgres widens both automatically.
- **Averages of averages.** The average of per-customer averages is not the
  average order value. Compute from the underlying rows unless you mean the
  former.
- **Grouping by a nullable column** puts all NULLs in one group. Label it with
  `COALESCE(region, 'Unknown')` so it is not mistaken for a blank.

When the question is "the top row in each group" (latest order per customer,
highest paid per department), `GROUP BY` is the wrong tool, because it cannot
return the other columns of the winning row. That is a window function job:
[sql-window-functions-for-reporting.md](sql-window-functions-for-reporting.md).

## What you should be able to answer

- What is the difference between `WHERE` and `HAVING`, and why should non-aggregate filters go in `WHERE`?
- How do you return paid, refunded and total order counts per customer in one query, in Postgres and in SQL Server?
- Why does `COUNT(*)` report 1 for a customer with no orders after a LEFT JOIN, and what do you count instead?
- How do you build a daily chart that shows zero on days with no orders?
- How do you find customers who bought both of two products, and why is `COUNT(DISTINCT ...)` needed?
- How do you remove duplicate rows before adding a unique constraint?
