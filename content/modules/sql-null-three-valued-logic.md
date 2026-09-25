# NULL and three-valued logic

NULL causes more silently wrong query results than any other part of SQL. Rows
vanish from filters, `NOT IN` returns nothing, totals come back as `null` in your
JSON, and a unique constraint lets duplicates in. Interviewers love NULL because
a short snippet exposes whether you understand the rules or have memorised
"use IS NULL". This guide gives you the rules. Every result below was checked
on SQLite and matches Postgres 17 and SQL Server 2022 unless noted.

## NULL means unknown, so comparisons are unknown

NULL is not a value; it is the absence of one. Comparing anything to an
unknown gives an unknown result, which SQL calls UNKNOWN (and shows as NULL):

```sql
SELECT NULL = NULL;   -- NULL, not true
SELECT NULL <> 1;     -- NULL, not true
SELECT 1 + NULL;      -- NULL
SELECT 'a' || NULL;   -- NULL (Postgres, SQLite); CONCAT('a', NULL) gives 'a'
```

That is why `WHERE email = NULL` never matches anything. `IS NULL` and `IS
NOT NULL` are the only direct tests, and they always return true or false.

### The truth tables that matter

SQL logic has three values: TRUE, FALSE and UNKNOWN. AND and OR follow the
rule "if the known part decides the answer, use it":

| Expression | Result |
| --- | --- |
| `UNKNOWN AND FALSE` | FALSE |
| `UNKNOWN AND TRUE` | UNKNOWN |
| `UNKNOWN OR TRUE` | TRUE |
| `UNKNOWN OR FALSE` | UNKNOWN |
| `NOT UNKNOWN` | UNKNOWN |

The last row is the one that surprises people: negating an unknown condition
does not make it true.

## WHERE keeps only TRUE

A `WHERE`, `ON` or `HAVING` clause keeps a row only when the condition is
TRUE. FALSE and UNKNOWN are both discarded. So every nullable column splits
your data three ways, and simple filters miss a part:

```sql
-- status holds 'a', 'b' and NULL
SELECT COUNT(*) FROM t WHERE status = 'a';        -- 1
SELECT COUNT(*) FROM t WHERE status <> 'a';       -- 1, not 2
SELECT COUNT(*) FROM t WHERE NOT (status = 'a');  -- 1, not 2
```

The NULL row is in neither result. If you mean "anything except 'a',
including missing", say so: `WHERE status <> 'a' OR status IS NULL`, or use
the NULL-safe comparison below.

## The NOT IN trap

`x NOT IN (1, NULL)` expands to `x <> 1 AND x <> NULL`. The second part is
UNKNOWN for every `x`, so the whole condition is never TRUE:

```sql
SELECT 2 IN (1, NULL);      -- NULL (unknown), not false
SELECT 2 NOT IN (1, NULL);  -- NULL, so WHERE drops the row

SELECT name FROM customers
WHERE id NOT IN (SELECT referrer_id FROM customers);
-- returns nothing if any referrer_id is NULL
```

`NOT EXISTS` does not have this problem, because it asks whether a matching
row exists, which is always true or false. Make it your default for anti-joins
(see [sql-joins-in-depth.md](sql-joins-in-depth.md)). `IN` with a NULL in the
list still finds genuine matches; only `NOT IN` breaks.

## CHECK constraints pass on UNKNOWN

A CHECK constraint rejects a row only when the condition is FALSE. UNKNOWN
passes:

```sql
CREATE TABLE products (price numeric CHECK (price > 0));
INSERT INTO products VALUES (NULL);   -- succeeds
```

This is the mirror image of `WHERE`. If the value is required, add `NOT NULL`
as well; the CHECK only guards values that exist.

## Aggregates skip NULLs

| Expression | Over `10, NULL, 20` | Over zero rows |
| --- | --- | --- |
| `COUNT(*)` | 3 | 0 |
| `COUNT(v)` | 2 | 0 |
| `SUM(v)` | 30 | NULL |
| `AVG(v)` | 15 (not 10) | NULL |
| `MAX(v)` | 20 | NULL |

Two bugs follow directly. `AVG` silently ignores unrated rows, which may or may
not be what the report means. And `SUM` over an empty set returns NULL, so a
revenue endpoint for a quiet day returns `{ "revenue": null }` and the frontend
prints "null". Write `COALESCE(SUM(total), 0)`.

Arithmetic inside an aggregate is evaluated per row first: `SUM(price * qty)`
skips any line whose `qty` is NULL, so the invoice total quietly omits it.

## Where NULLs count as equal

Despite `NULL = NULL` being unknown, several features treat NULLs as a single
group:

- `GROUP BY` and `DISTINCT` put all NULLs together in one group.
- `UNION`, `INTERSECT` and `EXCEPT` treat NULLs as duplicates of each other.
- `COUNT(DISTINCT v)` ignores NULLs entirely.

Unique constraints are where engines differ:

| Engine | Two NULLs in a UNIQUE column |
| --- | --- |
| Postgres | Allowed by default; `UNIQUE NULLS NOT DISTINCT` (15+) forbids it |
| SQLite, MySQL | Allowed |
| SQL Server | Rejected: a unique index allows one NULL. Use a filtered index `WHERE col IS NOT NULL` to allow many |

Know which you are on before you rely on "email is optional but unique".

## Comparing nullable values safely

To ask "are these two values the same, treating two NULLs as equal", use the
NULL-safe comparison:

| Engine | Syntax |
| --- | --- |
| Postgres, SQL Server 2022 | `a IS NOT DISTINCT FROM b` |
| SQLite | `a IS b` |
| MySQL | `a <=> b` |

This matters in change detection (`WHERE old.email IS DISTINCT FROM
new.email`) and in joins on nullable columns: `ON a.coupon = b.coupon` never
pairs two NULL coupons.

## Functions for handling NULL

- `COALESCE(a, b, 'default')` returns the first non-NULL argument. Standard
  and portable.
- `NULLIF(a, b)` returns NULL when `a = b`. Its main use is avoiding
  divide-by-zero: `orders / NULLIF(visits, 0)`.
- SQL Server's `ISNULL(a, b)` takes the type of `a`, so `ISNULL(@code, 'UNKNOWN')`
  with a `varchar(3)` variable returns `'UNK'`. Prefer `COALESCE`.

### Sorting

NULLs sort as larger than every value in Postgres, so they come last in `ASC`
and first in `DESC`. SQL Server, SQLite and MySQL treat them as smaller, so the
opposite. Postgres and SQLite accept `NULLS FIRST` / `NULLS LAST`; in SQL
Server, sort on `CASE WHEN col IS NULL THEN 1 ELSE 0 END` first.

## Design: fewer NULLs, fewer bugs

The best NULL handling is not needing it. Declare columns `NOT NULL` whenever
the value is always known, and choose one representation for "none" (NULL or
an empty string, not both). Use NULL for genuinely unknown or not-applicable
values, such as `shipped_at` before shipping, where it carries meaning. And in
application code, remember that the driver hands you `null`; TypeScript types
for query results should say so (see
[typescript-narrowing.md](typescript-narrowing.md)).

## What you should be able to answer

- Why does `WHERE status <> 'a'` not return rows where status is NULL, and how do you include them?
- Why can `NOT IN (subquery)` return no rows at all, and what should you write instead?
- What do `COUNT(*)`, `COUNT(col)`, `SUM(col)` and `AVG(col)` return when some values are NULL, and when there are no rows?
- Why does a CHECK constraint accept a NULL, and what do you add to prevent it?
- Can a UNIQUE column hold two NULLs? Give the answer for Postgres and SQL Server.
- How do you compare two nullable columns so that two NULLs count as equal?
