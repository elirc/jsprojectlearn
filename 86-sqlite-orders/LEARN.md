# 📘 Learning Guide: SQLite orders (real SQL, zero installs)

Read this before or alongside the README — the README assumes you know these concepts; this file teaches them.

## 1. What are we building?

A tiny shop backend with three tables — **customers**, their **orders**, and the **order items** inside each order — stored in a real relational database, SQLite. It creates customers, places orders, and prints a report:

```
== Recent orders ==
#  4  2026-03-04  paid          $22.00  Lin Chen
#  3  2026-03-03  pending       $34.50  Ada O'Brien
...
== Every customer (LEFT JOIN, zero-order customers included) ==
Sam Idle          0 orders       $0.00
```

**Why this project exists.** Every other project in this track fakes persistence: an array in memory, or a JSON file (project 55). None of them touches SQL. But a CRUD interview almost always does: *write a JOIN*, *what does an index do*, *what's an N+1*, *how do you stop SQL injection*. This project makes each of those real — you can run them, break them, and watch the tests catch you — using `node:sqlite`, which is built into Node. Nothing to install, works offline.

The original version works but is written the way most first attempts are. The refactor fixes it one interview question at a time.

## 2. Concepts you need first

### Tables, rows, columns, keys

A **relational database** stores data in **tables**. A table has fixed **columns** (like `name`, `email`) and any number of **rows** (one per customer). Each table has a **primary key** — a column whose value is unique per row and identifies it forever, here an integer `id`.

A **foreign key** is a column that points at another table's primary key. `orders.customer_id` holds a customer's `id`. With the foreign key enforced, the database refuses an order for customer 999 if no such customer exists.

```sql
CREATE TABLE orders (
  id           INTEGER PRIMARY KEY,
  customer_id  INTEGER NOT NULL REFERENCES customers(id)
);
```

### SQL, and running it from Node

**SQL** (Structured Query Language) is how you talk to the database. Four statements do nearly all CRUD work: `INSERT` (create), `SELECT` (read), `UPDATE`, `DELETE`.

```js
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync(':memory:');          // a database that lives in RAM
db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
db.prepare('INSERT INTO t (name) VALUES (?)').run('Ada');
console.log(db.prepare('SELECT * FROM t').all()); // [ { id: 1, name: 'Ada' } ]
```

`exec` runs SQL text with no inputs. `prepare` compiles a statement once; then `.run()` executes it (for writes), `.get()` returns the first row, `.all()` returns every row.

### Parameters: the `?`

The `?` is a **placeholder**. The value `'Ada'` is sent to the database *separately* from the SQL text, so the database never mistakes it for SQL — no matter what characters it contains. This is called a **parameterised query**, and it is the only real defence against **SQL injection** (tricking a program into running SQL written by an attacker).

### Constraints

A **constraint** is a rule the database enforces on every write, from every program:

- `NOT NULL` — the column must have a value.
- `UNIQUE` — no two rows may share this value (e.g. email).
- `CHECK (status IN ('pending', 'paid'))` — the value must pass this test.
- `PRIMARY KEY` / `REFERENCES` — the keys above.

If a write breaks a constraint, the statement **throws** and nothing is written.

### JOIN

A **JOIN** combines rows from two tables where a condition matches — usually a foreign key equalling a primary key:

```sql
SELECT o.id, c.name
FROM orders o
JOIN customers c ON c.id = o.customer_id;
```

`o` and `c` are short **aliases** for the table names. An **INNER JOIN** (plain `JOIN`) keeps only rows that match on both sides. A **LEFT JOIN** keeps *every* row from the left table; where nothing matches on the right, the right-hand columns are **NULL** (SQL's "no value").

### GROUP BY, aggregates, HAVING

**Aggregate functions** turn many rows into one number: `COUNT`, `SUM`, `AVG`. `GROUP BY c.id` makes one output row per customer. `WHERE` filters rows *before* grouping; `HAVING` filters the groups *after*.

```sql
SELECT customer_id, SUM(total_cents) FROM orders
GROUP BY customer_id HAVING SUM(total_cents) > 1000;
```

### Transactions

A **transaction** groups several statements into one all-or-nothing unit. `BEGIN` starts it, `COMMIT` makes everything permanent, `ROLLBACK` throws everything since `BEGIN` away. This is the **A** (Atomic) in **ACID**.

### Indexes

An **index** is a sorted copy of one or more columns, with pointers back to the rows. Like the index at the back of a book, it lets the database jump to "customer 42" instead of reading every row (a **full table scan**).

## 3. Walking through the original code

`original.js` creates a database file in your temp folder, builds tables, seeds data, prints a report, and deletes the file.

```js
db.exec(`
  CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, email TEXT);
  CREATE TABLE orders (... total REAL, ...);
```

Tables with almost no rules: no `UNIQUE` email, no `CHECK` on status, prices as `REAL` (floating point). And the foreign-key `REFERENCES` clause does nothing, because SQLite only enforces foreign keys after `PRAGMA foreign_keys = ON` — which the original never runs.

```js
db.exec("INSERT INTO customers (name, email) VALUES ('" + name + "', '" + email + "')");
```

The SQL is built by gluing strings. Customer names go *inside* the SQL text, between quote marks.

```js
var total = 0;
for (...) total += items[i].price * items[i].quantity;
db.exec("INSERT INTO orders ...");
for (...) db.exec("INSERT INTO order_items VALUES (...)");
```

Add up float prices, insert the order, then insert each item — every statement committing on its own.

```js
var orders = db.prepare("SELECT * FROM orders ORDER BY " + sortColumn +
  " DESC LIMIT 2 OFFSET " + (page * 2)).all();
for (...) {
  var customer = db.prepare("SELECT * FROM customers WHERE id = " + orders[i].customer_id).get();
  console.log(...);
}
```

Fetch a page of orders, then for each order fetch its customer and print a line. Querying and printing are woven together.

## 4. What's wrong with it (in beginner terms)

**String-built SQL.** The seed data uses "Ada Byron" — because "Ada O'Brien" crashes it: the apostrophe closes the quoted string early and the rest is a syntax error. That's the harmless version. A customer named `x'); DROP TABLE orders;--` isn't a syntax error; it's a second statement. That's SQL injection, and it's still one of the most exploited bugs on the web.

**Floats for money.** Computers store `1.10` and `2.20` in binary, where neither is exact. Their sum prints as `3.3000000000000003`. Across thousands of orders the drift reaches real cents, and your revenue report disagrees with the payment provider. Money belongs in integer **cents**: `110 + 220` is exactly `330`.

**The N+1 problem.** To print 2 orders the original runs 1 query for the orders plus 1 per order for the customer: 3. For a page of 100 orders, 101. Each query is a round trip to the database. Nothing in the code *looks* slow — it's a loop with a lookup — which is why it ships to production and gets found by a slow-page complaint.

**No transaction.** The order row is saved first, then the items one by one. If saving item 2 fails (bad data, disk full, crash), the order exists with one item and a total that claims two. Nobody can tell which orders are half-written.

**OFFSET pagination.** "Page 2" means "skip 2 rows, take 2". If someone places a new order while you're reading page 1, every row shifts down one position, and page 2 starts with the row you already saw.

**Check-then-insert.** `addCustomer` looks for the email and inserts if it's missing. Two signups for the same email arriving together both look, both see nothing, both insert. The check is not a guard; only the database can guard.

**INNER JOIN for "every customer".** Sam never ordered, so the join has nothing to match him with and he isn't in the counts at all.

**Printing tangled with querying.** You can't test "Lin spent $81.97" without capturing console output, and an API endpoint can't reuse the query.

## 5. Try it yourself first!

Try fixing the original before reading on. Hints, vague to specific:

1. Which rules about the data could the *database* enforce, so that no code path can break them? (Look at email, status, prices, and that `REFERENCES`.)
2. Could every value reach SQL as a `?` instead of inside the string? What about the sort column — can *that* be a `?`?
3. Could prices be whole numbers? What unit would make that work?
4. Could the orders *and* their customers come back from one statement?
5. What SQL makes "insert the order and all its items" all-or-nothing?
6. Instead of "skip N rows", could page 2 be described as "orders older than the last one I showed"?
7. Full recipe: `STRICT` tables with `UNIQUE`/`CHECK`/`PRIMARY KEY`, `PRAGMA foreign_keys = ON`, `?` for every value and an allowlist object for the sort column, integer cents, `JOIN customers` in the list query, `BEGIN`/`COMMIT` with `ROLLBACK` in a `catch`, and `WHERE (created_at, id) < (?, ?)` for the next page.

## 6. Understanding the refactored solution

The refactor is four files, each with one job.

**`db.js` — the schema and its history.** `MIGRATIONS` is an ordered list of SQL scripts. `migrate()` creates a `schema_migrations` table, looks up which versions are already applied, and runs only the newer ones — each inside its own transaction, recording its version when done. Run it twice and the second run does nothing (a test checks this). This is how every real project changes its schema: you never edit a shipped migration, you add the next one.

The schema pushes every rule it can into the database: `STRICT` tables (SQLite is loosely typed by default and would happily store `19.99` in an `INTEGER` column; `STRICT` refuses, like Postgres), `UNIQUE` email, a `CHECK` on status, a composite primary key `(order_id, sku)` on items, and two indexes — `orders(customer_id, created_at DESC)` for "a customer's orders, newest first", and `orders(created_at DESC, id DESC)` for the paginated list. `openDb()` switches foreign keys on before anything else.

`countingDb()` wraps a database and records every statement it executes. The repository only calls `db.prepare()` and `db.exec()`, so it can't tell the wrapper from the real thing. This is the "log your SQL" habit made testable.

**`repository.js` — every SQL statement, parameterised.** The interesting functions:

- `createCustomer` just inserts. If the `UNIQUE` constraint fires (SQLite error code 2067), it throws a `DuplicateEmailError` a web layer could turn into a 409. No check first — the constraint *is* the check.
- `createOrder` validates the items (integer cents, positive quantities), computes the total with integer maths, then:

```js
db.exec('BEGIN');
try {
  // insert order, insert each item
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  throw err;
}
```

If any insert throws, `ROLLBACK` removes the order row that was already inserted, and the error still reaches the caller.

- `listOrdersWithCustomer` is one `JOIN` — the customer's name and email arrive in the same row as the order. `listOrdersNaive` returns the identical result the N+1 way, and is kept only so the test can count both.
- The sort column can't be a `?` (placeholders are for *values*, not column names), so `ORDER_SORTS` maps allowed keys like `'newest'` to SQL we wrote. Anything else throws a `RangeError` before any SQL is built.
- `listOrdersPage` uses **keyset pagination**: the cursor holds the last row's `(created_at, id)`, and the next page is `WHERE (o.created_at, o.id) < (?, ?)` — "strictly older than the last row you saw". `id` is the **tiebreaker**, so two orders in the same millisecond still have one fixed order. The cursor is base64-encoded so clients treat it as an opaque token. `listOrdersByOffset` is the OFFSET version, kept for contrast.
- `customersWithOrderCount` uses `LEFT JOIN` so Sam appears, `COUNT(o.id)` so he scores 0 (not 1 — `COUNT(*)` would count his all-NULL row), and `COALESCE(SUM(...), 0)` because the `SUM` of no rows is NULL. Its optional status filter lives in the `ON` clause, not `WHERE`, for reasons the tests demonstrate.
- `topCustomers` shows `WHERE` (only paid/shipped rows) versus `HAVING` (only customers whose total reaches the threshold).

**`report.js` — pure formatting.** Rows in, text out. `formatCents(330)` gives `"$3.30"` using integer division and remainder, so a float never exists.

**`cli.js` — wiring.** Opens an in-memory database, seeds it (including "Ada O'Brien", who the original couldn't store), runs three queries through `countingDb`, and prints the report plus the statement count: 3, however many orders exist. `--log-sql` prints each statement as it runs.

**How the tests work.** Each test opens its own `:memory:` database, so tests can't affect each other and nothing touches disk. `assert.throws(fn, /regex/)` checks that `fn` throws an error whose message matches. The key tests:

- *N+1:* seed 12 orders, wrap the database in `countingDb`, call the JOIN version (count must be 1) and the naive version (count must be 13), and check both return identical rows.
- *Pagination:* take page 1 with both methods, insert a newer order, take page 2 with both. Keyset continues with `[3, 2, 1]`; OFFSET returns `[4, 3, 2]` — order 4 appears on both pages.
- *Rollback:* an order whose second item duplicates the first one's SKU violates the items' primary key; afterwards both tables are empty.
- *The LEFT JOIN trap:* the same query with `WHERE o.status = 'paid'` loses Lin and Sam; the repository's version with the condition in `ON` keeps them with a count of 0.

## 7. Words you learned (glossary)

- **Relational database** — data stored in tables linked by keys, queried with SQL.
- **Table / row / column** — the grid: one row per thing, one column per attribute.
- **Primary key** — a column whose value uniquely and permanently identifies a row.
- **Foreign key** — a column holding another table's primary key; enforced, it forbids dangling references.
- **Composite key** — a primary key made of several columns, like `(order_id, sku)`.
- **Constraint** — a rule the database checks on every write (`NOT NULL`, `UNIQUE`, `CHECK`, keys).
- **STRICT table** — SQLite mode that enforces column types, as most databases do by default.
- **Migration** — a versioned script that changes the schema; applied once, in order.
- **Schema** — the set of tables, columns, constraints and indexes.
- **Parameterised query** — SQL with `?` placeholders whose values are sent separately.
- **SQL injection** — input that ends up executed as SQL because it was glued into the query text.
- **Allowlist** — a fixed set of permitted values; everything else is rejected.
- **JOIN (INNER)** — combine rows from two tables where a condition matches on both sides.
- **LEFT JOIN** — keep every left-hand row; unmatched right-hand columns become NULL.
- **NULL** — "no value / unknown"; any comparison with it is not true.
- **Aggregate** — a function that collapses rows into a value (`COUNT`, `SUM`).
- **GROUP BY / HAVING** — make one row per group / filter those groups.
- **COALESCE** — returns its first non-NULL argument; `COALESCE(x, 0)` turns NULL into 0.
- **Transaction** — statements that commit together or not at all (`BEGIN`/`COMMIT`/`ROLLBACK`).
- **ACID** — Atomic, Consistent, Isolated, Durable: what transactions guarantee.
- **Index** — a sorted structure that lets the database seek instead of scanning.
- **Full table scan** — reading every row because no index helps.
- **N+1 problem** — one query for a list plus one per row for related data.
- **OFFSET pagination** — "skip N rows"; shifts when rows are inserted.
- **Keyset pagination** — "rows after this key"; stable under inserts, fast at any depth.
- **Tiebreaker** — an extra unique sort column that makes an order total.
- **Cursor** — an opaque token telling the server where the last page ended.
- **Minor units / cents** — storing money as integers of the smallest unit.

## 8. Experiments to try on the plane (no internet needed)

Everything here runs offline with `node`. Work on copies if you want to keep the originals pristine.

1. **Break the original with an apostrophe.** In a copy of `original.js`, change `"Ada Byron"` to `"Ada O'Brien"` and run it. Expected: it throws a SQL syntax error (`near "Brien"`). Then run `node 86-sqlite-orders/refactored/cli.js` — the refactor stores and prints her name fine.
2. **Watch the N+1 grow.** In a copy of `original.js`, add six more `addOrder(...)` calls and change `LIMIT 2` to `LIMIT 10` (and remove `printPage(1, ...)`). Expected: the statement counter rises by one per order printed. Run `node 86-sqlite-orders/refactored/cli.js --log-sql` and count its `SQL>` lines: 3, regardless of how many orders you seed in `seedDemo`.
3. **Remove the transaction.** In a copy of `repository.js`, delete the `BEGIN`, `COMMIT` and `ROLLBACK` lines, point the test import at the copy, and run the tests. Expected: the "all-or-nothing" test fails — `orders` has 1 row and `order_items` has 1 row after the "failed" order.
4. **Turn foreign keys off.** Comment out the `PRAGMA foreign_keys = ON` line in `db.js`. Expected: the foreign-key test fails — an order for customer 999 is accepted. Put it back.
5. **See the LEFT JOIN trap yourself.** In a scratch file, `openDb()`, create two customers, give one a `paid` order, then run the `broken` query from the trap test with `.all()`. Expected: one row. Move `o.status = 'paid'` from `WHERE` into the `ON` clause (`ON o.customer_id = c.id AND o.status = 'paid'`). Expected: both customers, the second with `n: 0`.
6. **Ask the planner.** In a scratch file, `openDb()` and run `db.prepare("EXPLAIN QUERY PLAN SELECT id FROM orders WHERE customer_id = ? ORDER BY created_at DESC").all(1)`. Expected: `SEARCH orders USING INDEX idx_orders_customer_created (customer_id=?)`. Now try `... ORDER BY total_cents` on the JOIN query: you'll see `USE TEMP B-TREE FOR ORDER BY` — a sort the index can't serve.
