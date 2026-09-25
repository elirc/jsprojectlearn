# Isolation levels, locking and deadlocks

Concurrency bugs pass every test on your laptop and then double-sell the last
ticket in production. Interviewers probe this with "two users buy the last item
at once" or "what isolation level does your database use?", and they want to
hear mechanisms and fixes, not definitions recited from a table. This guide
covers what each level actually prevents on Postgres 17 and SQL Server 2022,
how locks queue, and what to do about deadlocks.

## The anomalies, briefly

| Anomaly | What happens |
| --- | --- |
| Dirty read | You see another transaction's uncommitted change, which may roll back |
| Non-repeatable read | You read a row twice and get different values |
| Phantom | You run the same filter twice and get different rows |
| Lost update | Two read-modify-write cycles run together; one write silently wins |
| Write skew | Two transactions read overlapping data, then write different rows, together breaking a rule |

The standard levels, from weakest to strongest, are READ UNCOMMITTED, READ
COMMITTED, REPEATABLE READ and SERIALIZABLE. The standard only says what each
must prevent. What each engine actually does differs, and that is what matters.

## What your engine really does

**Postgres** uses MVCC (multi-version concurrency control): readers see a
snapshot and never block writers, and writers never block readers.

- READ COMMITTED (default): each **statement** gets a fresh snapshot. No dirty
  reads, ever. READ UNCOMMITTED behaves the same.
- REPEATABLE READ: one snapshot for the whole transaction. It also prevents
  phantoms. If you try to update a row someone else changed since your snapshot,
  you get a serialisation error (SQLSTATE 40001).
- SERIALIZABLE: repeatable read plus detection of dangerous read/write patterns
  (write skew). Conflicts abort one transaction with 40001.

**SQL Server** defaults to READ COMMITTED implemented with **locks**: a reader
waits for a writer's exclusive lock on the row. Two database options change
that:

- `READ_COMMITTED_SNAPSHOT ON` (RCSI) makes READ COMMITTED read the last
  committed version instead of waiting. It is on by default in Azure SQL
  Database and is the usual cure for readers blocking writers.
- `ALLOW_SNAPSHOT_ISOLATION ON` enables SNAPSHOT isolation, the equivalent of
  Postgres REPEATABLE READ.

SQL Server REPEATABLE READ and SERIALIZABLE hold shared and range locks until
commit, so they block rather than abort. `WITH (NOLOCK)` is READ UNCOMMITTED:
it can return rolled-back rows and miss or double-count rows during page
splits. It is not a performance switch; RCSI is.

## READ COMMITTED does not stop lost updates

The default level is fine for most CRUD, but this pattern is broken on it:

```js
const { rows } = await client.query('SELECT stock FROM products WHERE id = $1', [id]);
if (rows[0].stock < 1) throw new Error('Sold out');
await client.query('UPDATE products SET stock = $1 WHERE id = $2', [rows[0].stock - 1, id]);
```

Two requests read stock 1, both pass the check, both write 0: two sales, one
unit. The fixes, in order of preference:

1. **Do it in one statement.** `UPDATE products SET stock = stock - 1 WHERE id
   = $1 AND stock >= 1` and check the affected row count. The row lock makes
   the second request wait, then re-evaluate `stock >= 1` against the new value
   and match nothing.
2. **Constraints.** `CHECK (stock >= 0)` makes the database refuse the bad
   state whatever the code does.
3. **Pessimistic lock.** `SELECT ... FOR UPDATE` (SQL Server: `WITH (UPDLOCK,
   ROWLOCK)`) locks the row at read time so the second reader waits.
4. **Optimistic concurrency.** Add a `version` column, update `WHERE id = $1
   AND version = $2`, and treat zero affected rows as a conflict (HTTP 409 or
   412). Best when a user edits a form for minutes; you cannot hold a lock that
   long.

## Write skew and when to use SERIALIZABLE

Rule: at least one doctor must stay on call. Two doctors each run "count
on-call doctors; if more than one, take myself off". Under snapshot-based
levels both see two on call, both update their **own** row, and nobody is on
call. No row was written twice, so row locks never conflicted.

SERIALIZABLE catches this: one transaction fails with 40001. Using it means
every transaction at that level must be wrapped in a **retry of the whole
transaction**, because its reads are now stale. Alternatives are locking the
rows you read (`FOR UPDATE` on the on-call rows) or modelling the rule as a
constraint.

## Locks: who waits for whom

Row locks are taken by `UPDATE`, `DELETE`, `SELECT ... FOR UPDATE` and inserts
into unique indexes, and are held **until the transaction ends**. That single
fact drives most blocking problems:

- A transaction that calls a payment API or sends email before committing holds
  its row locks for the whole call. Keep network I/O out of transactions.
- An `idle in transaction` session (a code path that forgot to commit) holds
  locks indefinitely and, in Postgres, stops vacuum cleaning up. Set
  `idle_in_transaction_session_timeout`.
- DDL such as `ALTER TABLE` needs a strong table lock. While it waits behind a
  long query, every new query queues behind it. See
  [zero-downtime-schema-migrations.md](zero-downtime-schema-migrations.md).
- SQL Server escalates to a table lock once a statement holds about 5,000
  locks on one object, so big `UPDATE`s are batched.

Postgres gives you three choices when a row is already locked:

| Clause | Behaviour | Good for |
| --- | --- | --- |
| (none) | Wait for the lock | Normal writes |
| `NOWAIT` | Error at once (55P03) | "Someone else is editing this" |
| `SKIP LOCKED` | Skip locked rows | Job queues with many workers |

`lock_timeout` sets a maximum wait for any statement in the session.

## Deadlocks

A deadlock is a cycle: transaction A holds row 1 and wants row 2 while B holds
row 2 and wants row 1. Neither can finish, so the engine detects the cycle
(Postgres after `deadlock_timeout`, 1 s by default; SQL Server's monitor every
few seconds), aborts one transaction as the victim and lets the other proceed.
The victim gets Postgres SQLSTATE 40P01 or SQL Server error 1205.

The classic source is two transfers in opposite directions:

```sql
-- A: transfer 1 -> 2         -- B: transfer 2 -> 1
UPDATE accounts ... id = 1;    UPDATE accounts ... id = 2;
UPDATE accounts ... id = 2;    UPDATE accounts ... id = 1;  -- deadlock
```

Prevention:

- **Lock in a consistent order.** Update the lower id first, whatever the
  direction of the transfer. Most application deadlocks disappear.
- **Keep transactions short** and touch as few rows as possible.
- **Index foreign keys and filter columns.** Without an index, an `UPDATE ...
  WHERE` may scan and lock far more rows than it changes.
- **Lock up front.** `SELECT ... FOR UPDATE` on everything you will change, in
  order, before making changes.

Some deadlocks will still happen under load, so the data layer should retry
the whole transaction on deadlock and serialisation errors, and nothing else:

```js
const RETRYABLE = new Set(['40P01', '40001']);

export async function withRetry(pool, work, attempts = 3) {
  for (let i = 1; ; i++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (!RETRYABLE.has(err.code) || i >= attempts) throw err;
      await new Promise((r) => setTimeout(r, 20 * 2 ** i + Math.random() * 20));
    } finally {
      client.release();
    }
  }
}
```

A unique violation (23505) is not retryable: it will fail identically. In EF
Core, `EnableRetryOnFailure` plus an execution strategy does the equivalent
(see [orm-and-ef-core.md](orm-and-ef-core.md)).

## Diagnosing blocking in production

When requests hang but the database CPU is idle, something is waiting on a
lock.

- **Postgres:** `SELECT pid, state, wait_event_type, query,
  pg_blocking_pids(pid) FROM pg_stat_activity WHERE wait_event_type = 'Lock';`
  shows who is blocked and by whom. Deadlocks are written to the server log
  with both statements.
- **SQL Server:** `sys.dm_exec_requests` has a `blocking_session_id` column;
  the built-in `system_health` Extended Events session records deadlock graphs.

The fix is almost never "kill the blocker" as a routine. It is finding the code
path that holds a transaction open too long.

## What you should be able to answer

- What is the default isolation level in Postgres and SQL Server, and how do their implementations differ for readers?
- Why is "read stock, check, write stock minus one" broken at READ COMMITTED, and what are three fixes?
- What is write skew, and why does it need SERIALIZABLE or explicit locking?
- Why is `WITH (NOLOCK)` a bad fix for blocking in SQL Server, and what is the better one?
- What causes a deadlock, what does the application see, and how do you prevent most of them?
- Which database errors should a retry loop retry, and which should it not?
