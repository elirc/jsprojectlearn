# Indexes, the planner and reading query plans

"This endpoint got slow, what do you do?" is the performance question every
mid-level backend interview asks. A strong answer is a method: get the query,
read its plan, compare estimates to reality, then fix the index or the query.
[sql-fundamentals.md](sql-fundamentals.md) covers what an index is; this guide
covers how the planner decides whether to use one and how to read what it did.

## How the planner decides

SQL says what you want, not how to get it. The planner (optimiser) generates
candidate plans and picks the one with the lowest **estimated cost**, using
statistics about each table: row counts, distinct values and the most common
values per column. Three consequences:

- **Selectivity decides.** An index is worth using when the filter keeps a small
  fraction of rows. `WHERE status = 'active'` on a table where 95% of rows are
  active is faster as a sequential scan, and the planner knows it.
- **Small tables are scanned.** Reading 200 rows from a few pages beats walking
  an index. A seq scan on a tiny lookup table is not a problem.
- **Bad statistics make bad plans.** After a bulk load, or on columns whose
  values are correlated, estimates can be wrong by orders of magnitude, and the
  planner picks a nested loop that runs a million times. Postgres autovacuum
  refreshes stats eventually; run `ANALYZE table` after big imports.

## Designing composite indexes

A B-tree index on `(a, b, c)` is sorted by `a`, then by `b` within each `a`,
then by `c`. It can serve:

| Query shape | Uses the index? |
| --- | --- |
| `WHERE a = ?` | Yes |
| `WHERE a = ? AND b > ?` | Yes, seek on `a`, range on `b` |
| `WHERE a = ? ORDER BY b` | Yes, and no sort step |
| `WHERE b = ?` | Not as a seek; `b` is not sorted globally |
| `WHERE a > ? AND b = ?` | Seeks on `a`; `b` only filters within the range |

The rule of thumb: **equality columns first, then the range or sort column**.
For "the 20 latest orders for this customer", `orders (customer_id,
created_at)` lets the engine jump to the customer and read backwards, stopping
after 20 rows.

Two refinements:

- **Covering indexes** contain every column the query needs, so the engine never
  visits the table. Add non-key columns with `INCLUDE (total, status)` in
  Postgres 11+ and SQL Server, keeping the key narrow.
- **Partial (filtered) indexes** index only some rows: `CREATE INDEX ... ON
  jobs (id) WHERE status = 'pending'` stays tiny on a table of millions of
  finished jobs. A partial unique index also enforces rules such as "one active
  email" alongside soft delete.

Every index costs writes, disk and memory, so add them for queries you actually
run, and drop the ones `pg_stat_user_indexes` (Postgres) or
`sys.dm_db_index_usage_stats` (SQL Server) show are never read.

## Why an index is not used

When a plan ignores an index you expected, check these in order:

1. **The predicate is not sargable.** A function or arithmetic on the column
   hides it from the index: `WHERE lower(email) = $1`, `WHERE
   date(created_at) = '2026-03-01'`, `WHERE YEAR(CreatedAt) = 2026`. Rewrite
   as a range on the bare column, or create an expression index on exactly that
   expression.
2. **Implicit conversion.** In SQL Server, comparing a `varchar` column to an
   `nvarchar` parameter converts the column, often forcing a scan. Match
   parameter types to column types (in EF Core, configure `IsUnicode(false)`).
3. **Leading wildcard.** `LIKE '%smith'` cannot seek a B-tree. Use a trigram
   index in Postgres or full-text search (see
   [full-text-search-in-sql.md](full-text-search-in-sql.md)).
4. **Wrong column order.** The filter uses the second column of a composite
   index but not the first.
5. **It genuinely is cheaper not to.** Low selectivity or a small table.

## Reading a Postgres plan

`EXPLAIN` shows the estimated plan without running the query. `EXPLAIN
(ANALYZE, BUFFERS)` runs it and adds actual rows, time and I/O. Because
`ANALYZE` executes the statement, wrap data-changing statements in `BEGIN; ...
ROLLBACK;`.

```text
Limit  (cost=0.43..8.95 rows=20) (actual time=0.031..0.090 rows=20 loops=1)
  ->  Index Scan Backward using ix_orders_customer_created on orders
        (cost=0.43..512.10 rows=1203) (actual time=0.030..0.085 rows=20 loops=1)
        Index Cond: (customer_id = 42)
        Buffers: shared hit=24
Planning Time: 0.120 ms
Execution Time: 0.110 ms
```

Read it inside out: the most indented node runs first and feeds its parent.
What to look for:

- **Estimated `rows` versus actual `rows`.** A 10x or worse mismatch is the
  single best clue. The planner chose its join strategy for the wrong size.
- **`loops`.** Actual time and rows are per loop. An inner node with
  `loops=40000` and 0.02 ms each costs 800 ms in total.
- **`Rows Removed by Filter`.** A seq scan that reads 3 million rows to keep 5
  wants an index.
- **`Sort Method: external merge Disk: ...`.** The sort spilled to disk. An
  index that returns rows in order removes the sort; raising `work_mem` for the
  session is the other lever.
- **`Buffers: shared read`** counts pages fetched from disk rather than cache.
  High reads on a repeated query mean the working set does not fit in memory.
- **`Heap Fetches`** on an Index Only Scan means the visibility map is stale;
  a `VACUUM` restores true index-only reads.

Common node types: Seq Scan, Index Scan, Index Only Scan, Bitmap Heap Scan
(many matching rows, or `OR` across two indexes), and the three joins: Nested
Loop (small outer side, indexed inner), Hash Join (large unsorted inputs) and
Merge Join (both inputs already sorted on the key).

## Reading a SQL Server plan

In SQL Server Management Studio or Azure Data Studio, the estimated plan comes
from Ctrl+L and the actual plan from Ctrl+M before running. The vocabulary
differs:

| SQL Server operator | Meaning |
| --- | --- |
| Clustered Index Scan | Reading the whole table (the clustered index is the table) |
| Index Seek | Navigating the B-tree to matching keys |
| Key Lookup | Fetching missing columns from the clustered index, once per row |
| Sort, Hash Match | Same ideas as in Postgres |

A seek feeding tens of thousands of Key Lookups is the classic fix-me: add the
missing columns with `INCLUDE` so the index covers the query. Treat the green
"Missing Index" hint as a suggestion; it ignores other queries and existing
indexes.

SQL Server caches plans per statement and builds them using the first
parameter values it sees (**parameter sniffing**). A plan compiled for a
tenant with 10 rows can be terrible for one with two million. Targeted fixes
include `OPTION (RECOMPILE)` on that statement or `OPTIMIZE FOR`; Query Store
shows when a plan changed.

## SQLite, for local practice

SQLite's `EXPLAIN QUERY PLAN` is terse but readable, which makes it good for
practice with [../../86-sqlite-orders/](../../86-sqlite-orders/):

```text
SEARCH orders USING COVERING INDEX ix_orders_customer_created (customer_id=?)
SEARCH orders USING INDEX ix_orders_customer_created (customer_id=?)
USE TEMP B-TREE FOR ORDER BY
SCAN orders
```

`SEARCH` is a seek, `SCAN` is a full read, and `TEMP B-TREE` is a sort the
index could not avoid. With an index on `orders (customer_id, created_at)`,
the first line came from a query selecting only indexed columns for one
customer, the next two from `WHERE customer_id = ? ORDER BY total`, and the
last from a filter on `created_at` alone.

## A method for "it got slow"

1. Find the query: `pg_stat_statements` sorted by total time, Query Store in
   SQL Server, or your ORM's SQL log (see
   [ef-core-query-performance.md](ef-core-query-performance.md)).
2. Run `EXPLAIN (ANALYZE, BUFFERS)` with realistic parameters.
3. Find the node where estimates and actuals diverge, or where most time goes.
4. Fix the cause: a missing or misordered index, a non-sargable predicate,
   stale statistics, or a query that fetches far more than it needs.
5. Re-run the plan and measure. Keep the change only if it helped.

## What you should be able to answer

- Why might Postgres choose a sequential scan even though the filtered column is indexed?
- How do you order the columns of a composite index for `WHERE customer_id = ? ORDER BY created_at DESC LIMIT 20`?
- Name three reasons an index is not used, and how to fix each.
- In `EXPLAIN ANALYZE` output, what do estimated versus actual rows and `loops` tell you?
- What is a Key Lookup in a SQL Server plan, and how does `INCLUDE` remove it?
- What is parameter sniffing, and what is one targeted fix?
