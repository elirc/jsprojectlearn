# Zero-downtime schema migrations

A migration that works in seconds on your laptop can take an API down for ten
minutes on a table with 50 million rows. Mid-level interviews ask "how would you
add a required column to a big live table?" or "how do you rename a column
without downtime?" because the answers show whether you have shipped to real
users. [ef-core-migrations-in-teams.md](ef-core-migrations-in-teams.md) covers
the EF Core workflow; this guide is about what the database does underneath,
on Postgres 17 and SQL Server 2022.

## Why migrations cause outages

Three separate problems, each with its own fix:

1. **Locks.** Most DDL needs a strong table lock. In Postgres, `ALTER TABLE`
   usually takes ACCESS EXCLUSIVE, which blocks reads and writes.
2. **Rewrites and scans.** Some changes rewrite every row or scan the whole
   table to validate it, holding that lock for the duration.
3. **Incompatible code.** During a rolling deploy, old and new versions of the
   app run at the same time against one schema. A change that the old version
   cannot handle breaks it until the rollout completes.

## The compatibility rule

Every migration must be compatible with **both** the currently running code
and the code about to be deployed. So you never make a breaking change in one
step. Instead you expand, migrate, then contract, across several deploys:

| Step | Schema | Code |
| --- | --- | --- |
| 1. Expand | Add the new column or table, nullable | Unchanged |
| 2. Dual write | Unchanged | Write old and new; read old |
| 3. Backfill | Copy existing data in batches | Unchanged |
| 4. Switch reads | Add constraints on the new column | Read new; still write both |
| 5. Contract | Drop the old column | Stop writing old (deploy first) |

Renaming `fullname` to `display_name` in one migration breaks every running
instance still selecting `fullname`. Expand and contract turns it into five
boring, safe steps. The same shape handles splitting a table, changing a type
and moving data to a new relationship.

## Which DDL is cheap

Knowing which statements are metadata-only is most of the skill.

| Change | Postgres 17 | SQL Server 2022 |
| --- | --- | --- |
| Add nullable column | Instant | Instant |
| Add column with constant default | Instant (11+) | Metadata-only on Enterprise edition and Azure SQL |
| Add column with volatile default (`random()`, `clock_timestamp()`) | Full rewrite | Size-of-data |
| Change column type | Usually a rewrite (some widenings like `varchar(50)` to `varchar(100)` are instant) | Often size-of-data |
| Add index | Blocks writes; use `CONCURRENTLY` | Blocks; use `ONLINE = ON` (Enterprise, Azure SQL) |
| Add foreign key or CHECK | Full scan under lock; use `NOT VALID` then `VALIDATE` | Scan; `WITH NOCHECK` skips it but leaves the constraint untrusted |
| `SET NOT NULL` | Full scan, unless a validated CHECK already proves it (12+) | Scan |
| Drop column | Instant (marks it dropped) | Metadata-only, space reclaimed later |
| Rename column or table | Instant, but breaks running code | Instant via `sp_rename`, same problem |

Postgres examples of the safe forms:

```sql
CREATE INDEX CONCURRENTLY ix_orders_customer ON orders (customer_id);

ALTER TABLE orders
  ADD CONSTRAINT fk_orders_customer
  FOREIGN KEY (customer_id) REFERENCES customers (id) NOT VALID;
ALTER TABLE orders VALIDATE CONSTRAINT fk_orders_customer;
```

`NOT VALID` enforces the rule for new writes straight away and skips the scan;
`VALIDATE` then scans with a lock that allows normal reads and writes.
`CREATE INDEX CONCURRENTLY` cannot run inside a transaction block, so migration
tools need to be told to run it without one, and if it fails it leaves an
`INVALID` index you must drop and retry.

## Lock queues: the quick ALTER that freezes everything

Even an instant ALTER must acquire its lock. If a long-running report holds a
conflicting lock, the ALTER waits, and every query that arrives after the ALTER
queues behind it. A metadata-only change becomes a full outage for as long as
the report runs.

Guard every migration with a lock timeout and retry:

```sql
SET lock_timeout = '3s';
ALTER TABLE orders ADD COLUMN source text;
```

If the lock is not granted in three seconds, the statement fails and nothing
queues behind it for long; the migration runner retries a few times with a
pause. SQL Server's equivalent is `SET LOCK_TIMEOUT 3000`, and online index
operations accept `WAIT_AT_LOW_PRIORITY`. Also set `statement_timeout` for
migrations you expect to be quick, so a surprise rewrite fails instead of
running for an hour.

## Adding a required column to a big table

The interview classic. Suppose `orders` needs a `region` that is NOT NULL and
derived from the customer.

1. Add it nullable: `ALTER TABLE orders ADD COLUMN region text;` (instant).
2. Deploy code that sets `region` on every new or updated order.
3. Backfill old rows in batches, committing each one:

```sql
UPDATE orders o
SET region = c.region
FROM customers c
WHERE c.id = o.customer_id
  AND o.id >= $1 AND o.id < $1 + 10000
  AND o.region IS NULL;
```

   Loop over id ranges from a script or job, pausing between batches and
   watching replica lag. One giant UPDATE would lock millions of rows, bloat
   the WAL or transaction log, and stall replicas.
4. Enforce it without a long lock (Postgres 12+):

```sql
ALTER TABLE orders ADD CONSTRAINT region_not_null
  CHECK (region IS NOT NULL) NOT VALID;
ALTER TABLE orders VALIDATE CONSTRAINT region_not_null;
ALTER TABLE orders ALTER COLUMN region SET NOT NULL;  -- uses the check, no scan
ALTER TABLE orders DROP CONSTRAINT region_not_null;
```

If the value were a simple constant, step 1 alone with `NOT NULL DEFAULT
'uk'` would be instant on Postgres 11+.

## Dropping things safely

Dropping is the contract step, and order matters:

1. Deploy code that no longer reads or writes the column. With EF Core, remove
   the property from the model first; otherwise the generated SQL still names
   the column and fails the moment it disappears.
2. Wait until no old instances remain (and any rollback window has passed).
3. Drop the column in a later migration.

Dropping a table follows the same rule. Renaming a table can use a temporary
view with the old name while code migrates, in engines where simple views are
updatable.

## Operational habits

- **Run migrations as a pipeline step**, before the new version rolls out, not
  at app startup, where several instances race and the app login needs DDL
  rights. See [ci-cd-pipelines.md](ci-cd-pipelines.md).
- **Review the generated SQL.** ORMs happily emit a column rename as drop plus
  add, which loses data, or a type change that rewrites the table.
- **Roll forward.** A down migration cannot restore dropped data. Fix mistakes
  with a new migration.
- **Rehearse on production-sized data.** A staging database with 1,000 rows
  proves nothing about locks or rewrite time.
- **Test the new and old code against the new schema**, since both will run
  against it during the deploy.

## What you should be able to answer

- Why can renaming a column in one migration break a rolling deploy, and how does expand and contract avoid it?
- Which Postgres DDL changes are instant, and which rewrite or scan the table?
- Why can a millisecond `ALTER TABLE` take the whole app down, and what does `lock_timeout` do about it?
- How do you add a NOT NULL column derived from other data to a 50-million-row table?
- What do `CREATE INDEX CONCURRENTLY` and `NOT VALID` change, and what are their caveats?
- In what order do you remove a column that the ORM still maps?
