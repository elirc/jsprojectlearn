# Window functions for reporting

Running totals, month-on-month change, rank within a category, share of the
total, latest row per customer: these are the report queries product managers
ask for every week, and window functions answer all of them in one pass. Mid-level
interviews use them to separate people who write SQL from people who fetch rows
and loop in code. [sql-fundamentals.md](sql-fundamentals.md) introduced
top-N-per-group; this guide covers the rest of the toolkit.

Everything here runs on Postgres 17, SQL Server 2022, MySQL 8 and SQLite 3.25+
unless marked.

## The one idea: aggregate without collapsing

`GROUP BY` turns many rows into one. A window function computes over a set of
related rows **and keeps every row**:

```sql
SELECT id, customer_id, total,
       SUM(total) OVER (PARTITION BY customer_id) AS customer_total
FROM orders;
```

Every order is still there, each carrying its customer's total. The `OVER`
clause has three optional parts:

| Part | Meaning | If omitted |
| --- | --- | --- |
| `PARTITION BY` | Which rows belong together | The whole result is one partition |
| `ORDER BY` | Order within the partition | Rows are unordered; ranking and running totals make no sense |
| Frame (`ROWS` / `RANGE`) | Which rows around the current one to include | With `ORDER BY`: from the start up to the current row, including ties |

Window functions run after `WHERE`, `GROUP BY` and `HAVING`, and before the
final `ORDER BY` and `LIMIT`. That is why you cannot filter on them in `WHERE`
and must wrap the query in a CTE or subquery first.

## Running totals and moving averages

With this daily revenue: 1 March 100, 2 March 80, 3 March 120, 4 March 60.

```sql
SELECT day, revenue,
  SUM(revenue) OVER (ORDER BY day) AS running,
  AVG(revenue) OVER (ORDER BY day
                     ROWS BETWEEN 2 PRECEDING AND CURRENT ROW) AS avg_3d
FROM daily;
-- running: 100, 180, 300, 360
-- avg_3d:  100, 90, 100, 86.67
```

Two frame details trip people up:

- **The default frame is `RANGE`, not `ROWS`.** With duplicate `ORDER BY`
  values, `RANGE` treats ties as one step, so two orders on the same day both
  show the day's full running total. Add a tiebreaker (`ORDER BY day, id`) or
  say `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` explicitly when you
  want a per-row running sum.
- **`ROWS` counts rows, not days.** If days can be missing, a 7-row window
  covers more than 7 days. Either fill the calendar first (see
  [sql-group-by-patterns.md](sql-group-by-patterns.md)) or, in Postgres, use
  `RANGE BETWEEN INTERVAL '6 days' PRECEDING AND CURRENT ROW`.

## Change from the previous period

`LAG` reads a value from an earlier row in the partition; `LEAD` reads a later
one.

```sql
SELECT month, revenue,
  revenue - LAG(revenue) OVER (ORDER BY month) AS change,
  ROUND(100.0 * (revenue - LAG(revenue) OVER (ORDER BY month))
        / NULLIF(LAG(revenue) OVER (ORDER BY month), 0), 1) AS pct_change
FROM monthly;
```

The first row has no previous value, so `LAG` returns NULL, and so does the
change. Pass a default as the third argument (`LAG(revenue, 1, 0)`) only when
zero is genuinely correct; for percentage change it is not. `LEAD` is the
natural tool for durations: time from one page view to the next in a session,
or when each subscription period ended.

## Ranking

| Function | Ties on 90, 90, 80 | Use it for |
| --- | --- | --- |
| `ROW_NUMBER()` | 1, 2, 3 | Exactly one row per slot: dedupe, latest per group, pagination |
| `RANK()` | 1, 1, 3 | Competition ranking with gaps |
| `DENSE_RANK()` | 1, 1, 2 | "Second-highest value" questions |
| `NTILE(4)` | Quartile buckets | Splitting customers into bands |

`ROW_NUMBER` with ties is non-deterministic unless the `ORDER BY` is unique, so
always add a tiebreaker such as `id`. The latest order per customer is the
canonical example:

```sql
WITH ranked AS (
  SELECT o.*,
         ROW_NUMBER() OVER (PARTITION BY customer_id
                            ORDER BY created_at DESC, id DESC) AS rn
  FROM orders o
)
SELECT * FROM ranked WHERE rn = 1;
```

Postgres users often write `SELECT DISTINCT ON (customer_id) ... ORDER BY
customer_id, created_at DESC` instead; it is shorter but Postgres-only.

## Share of total

An empty `OVER ()` is the whole result set, which makes percentages easy:

```sql
SELECT region, SUM(amount) AS revenue,
  ROUND(100.0 * SUM(amount) / SUM(SUM(amount)) OVER (), 1) AS pct
FROM sales
GROUP BY region;
```

`SUM(SUM(amount)) OVER ()` looks odd but is correct: the inner `SUM` is the
group aggregate, and the outer windowed `SUM` adds up the grouped rows. Swap in
`OVER (PARTITION BY country)` for share within each country. Multiply by
`100.0`, not `100`, or integer division returns 0 on SQL Server and Postgres.

## First and last values

`FIRST_VALUE(name) OVER (PARTITION BY dept ORDER BY salary DESC)` puts the
top earner's name on every row of the department. `LAST_VALUE` looks
symmetrical but returns the current row with the default frame, because the
frame ends at the current row. Either give it a full frame:

```sql
LAST_VALUE(price) OVER (ORDER BY day
  ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING)
```

or reverse the order and use `FIRST_VALUE`, which is easier to read.

## Gaps and islands: streaks and sessions

"Longest run of consecutive login days" is a classic. For consecutive dates,
subtracting a row number gives a constant for every row in the same run:

```sql
SELECT user_id, MIN(day) AS started, MAX(day) AS ended, COUNT(*) AS days
FROM (
  SELECT user_id, day,
         day - ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY day)::int AS grp
  FROM logins
) t
GROUP BY user_id, grp;
-- 1-3 March: 3 days; 5-6 March: 2 days
```

For sessions ("a new session starts after 30 minutes of inactivity"), use `LAG`
to flag each row that starts a session, then a running `SUM` of the flags to
number the sessions. The same two-step shape (flag, then running sum) solves
most "group consecutive rows" problems.

## Performance notes

A window function needs its partition sorted. An index matching `PARTITION BY`
then `ORDER BY` (for example `orders (customer_id, created_at DESC)`) lets the
engine read rows already in order and skip the sort. Several windows sharing
the same `OVER` clause are computed together; the `WINDOW w AS (...)` clause
(Postgres, MySQL, SQLite, SQL Server 2022) names it once. For "top 3 per
customer" over a few customers, a `LATERAL` join with `LIMIT` can beat ranking
the whole table; see [sql-joins-in-depth.md](sql-joins-in-depth.md).

To see these patterns in a real schema, extend
[../../86-sqlite-orders/](../../86-sqlite-orders/): SQLite supports every
function above.

## What you should be able to answer

- What is the difference between `SUM(total)` with `GROUP BY customer_id` and `SUM(total) OVER (PARTITION BY customer_id)`?
- Why can two rows with the same date get the same running total, and how do you fix it?
- How do you return each customer's latest order, and why does the `ORDER BY` need a tiebreaker?
- When do you use `RANK`, `DENSE_RANK` and `ROW_NUMBER`?
- How do you compute each region's percentage of total revenue in a single query?
- Why does `LAST_VALUE` return the current row, and what are two fixes?
