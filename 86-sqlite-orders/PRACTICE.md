# 🏋️ Practice: SQLite orders (real SQL, zero installs)

Do these after reading LEARN.md and the README. Solutions are at the bottom — try each exercise before peeking.

Work in a scratch folder: copy the four files from `refactored/` (not the test) there, and write your tests in a new `practice.test.js` beside them. Every exercise uses a fresh `:memory:` database. Exercises that add a table do it as a **new migration** — never by editing `MIGRATIONS` entries that already exist. To try one migration without the others, use this helper:

```js
import { DatabaseSync } from 'node:sqlite';
import { migrate, MIGRATIONS } from './db.js';

const withMigrations = (...extra) => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db, [...MIGRATIONS, ...extra]);
  return db;
};
const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const one = [{ sku: 'SKU', quantity: 1, unitPriceCents: 1000 }];
```

Run with `node --test practice.test.js`. Everything is offline.

## Exercises

### ⭐ 1. Prove the index is used (warm-up)

The README claims `idx_orders_customer_created` serves "a customer's orders, newest first". Don't trust it — ask SQLite. Write a test that runs `EXPLAIN QUERY PLAN` on `SELECT id, total_cents FROM orders WHERE customer_id = ? ORDER BY created_at DESC` and asserts the plan searches that index and needs no separate sort step. Then pin two counter-examples: filtering on `status` alone is a full scan, and ordering one customer's orders by `total_cents` needs a temporary sort.

What it practices: reading a query plan — the "how would you diagnose a slow query?" answer from `content/modules/sql-fundamentals.md`.
Expected: the plan's `detail` column reads `SEARCH orders USING INDEX idx_orders_customer_created (customer_id=?)`; the status query reads `SCAN orders`; the total-sorted query includes `USE TEMP B-TREE FOR ORDER BY`.
Hint: `db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...params)` returns rows; join their `detail` fields with `'\n'` and use `assert.match`.

### ⭐⭐ 2. Products, prices from the server, and stock that can't go negative

Add a `products` table (migration version 5): `sku` primary key, `name`, `price_cents`, `stock`, with `CHECK`s that price and stock are never negative. Then write `placeOrder(db, { customerId, lines: [{ sku, quantity }] })` that, in **one transaction**: decrements each product's stock, looks up its price from `products` (the client no longer sends prices), and inserts the order and its items. If any line can't be filled, throw `OutOfStockError` and leave *every* stock level and table unchanged.

What it practices: a multi-table write as one unit of work, and a check-and-decrement that has no gap between the check and the write.
Expected: with MUG stock 2, ordering 2 MUGs + 1 PEN succeeds and leaves MUG at 0; a following order for 5 PENs + 1 MUG throws `OutOfStockError`, and PEN stock is still 99 afterwards (its decrement was rolled back); an unknown SKU also throws; there is exactly one order.
Hint: `UPDATE products SET stock = stock - ? WHERE sku = ? AND stock >= ?` and check `.changes`. Zero rows changed means "not enough" (or "no such product"). Don't call `createOrder` from inside — it opens its own `BEGIN`, and SQLite has no nested `BEGIN`.

### ⭐⭐ 3. Soft delete with a partial unique index

Customers should be deletable without losing their order history: add `deleted_at TEXT` (NULL = live). A deleted customer's email must become reusable, so `UNIQUE(email)` has to become "unique among live customers" — a **partial unique index**: `CREATE UNIQUE INDEX ... ON customers(email) WHERE deleted_at IS NULL`.

The catch: SQLite can't drop an inline `UNIQUE` constraint. You must **rebuild** the table (create `customers_new`, copy rows, drop the old one, rename) — while `orders` points at it. Teach `migrate()` a `rebuild: true` flag that turns foreign-key enforcement off around that migration, runs `PRAGMA foreign_key_check` before committing, and turns enforcement back on afterwards. Write `softDeleteCustomer(db, id)`.

What it practices: partial indexes, the table-rebuild migration, and why FK enforcement and migrations interact.
Expected: the migration succeeds on a database that already has customers and orders; `createCustomer` with a live email still throws `DuplicateEmailError`; after `softDeleteCustomer`, the same email can sign up again; a second live duplicate still throws; `PRAGMA foreign_key_check` returns no rows; an order for customer 999 is still rejected.
Hint: `PRAGMA foreign_keys` is silently ignored inside a transaction, so it must run *before* `BEGIN`. `createCustomer` needs no change: a partial unique index violation has the same error code (2067) as a `UNIQUE` column.

### ⭐⭐ 4. Top 3 most recent orders per customer (window function)

Write `recentOrdersPerCustomer(db, { perCustomer = 3 })` returning each customer's newest N orders, grouped by customer, newest first within each group. `GROUP BY` can't do this — it collapses rows, and you want to keep them.

What it practices: `ROW_NUMBER() OVER (PARTITION BY ... ORDER BY ...)`, the "genuine mid-level marker" query from `content/modules/sql-fundamentals.md`.
Expected: a customer with 5 orders contributes only their 3 newest (ids 5, 4, 3); a customer with 1 order contributes it; a customer with none contributes nothing.
Hint: number the rows in a subquery, filter `rn <= ?` in the outer query (you can't use a window function's result in the same query's `WHERE`). Break timestamp ties with `id DESC`, same as the keyset query.

### ⭐⭐⭐ 5. Idempotency keys for createOrder

A phone on a bad connection sends "place order", gets no response, and retries. Without protection that's two orders and two charges. Add an `idempotency_keys` table (`key` primary key, `request_hash`, `order_id` referencing `orders`, `created_at`) and `createOrderIdempotent(db, { idempotencyKey, ...sameArgsAsCreateOrder })`:

- same key, same request → return the **original** order, insert nothing;
- same key, *different* request → throw `IdempotencyConflictError` (a client bug; a 422 in an API);
- the key row is written in the **same transaction** as the order, so a failed order leaves no key behind.

What it practices: making a non-idempotent POST safe to retry — the database, not memory, remembers what was done.
Expected: calling twice with the same arguments returns deep-equal orders and `orders` has 1 row; changing the quantity under the same key throws; a request that fails (unknown customer) leaves `idempotency_keys` without a row for its key.
Hint: hash the request with `createHash('sha256')` from `node:crypto` over `JSON.stringify({ customerId, items })`. Check for the key first (fast path for retries); if the key insert still hits the primary key (errcode 1555), another request won the race — roll back and return *its* order.

### ⭐⭐⭐ 6. Expand/contract: add a NOT NULL column to a live table

Orders need a `currency` column that must never be NULL. Adding it `NOT NULL` in one step fails (existing rows have no value) or forces a fake default. Do it the way production teams do, as **expand → backfill → contract**:

1. **Expand** (migration 5): `ALTER TABLE orders ADD COLUMN currency TEXT` — nullable. Old code keeps working because it doesn't mention the column.
2. **Backfill**: `backfillCurrency(db, { batchSize })` sets `'USD'` on NULL rows, a batch at a time, returning how many rows it changed. (Meanwhile, the new code writes `currency` on every insert.)
3. **Contract** (migration 6, `rebuild: true` from exercise 3): rebuild `orders` with `currency TEXT NOT NULL CHECK (length(currency) = 3)`, recreating both indexes.

What it practices: zero-downtime schema changes (`content/modules/orm-and-ef-core.md`, "Migrations") and a migration that refuses to run on bad data.
Expected: running the contract migration *before* the backfill throws `NOT NULL constraint failed: orders_new.currency`, rolls back, and `schema_migrations` still ends at version 5; after `backfillCurrency(db, { batchSize: 4 })` returns 6 (for 6 orders), the contract succeeds, `order_items` still has every row and still enforces its foreign key; an insert without `currency` is now rejected.
Hint: batch with `UPDATE orders SET currency = 'USD' WHERE id IN (SELECT id FROM orders WHERE currency IS NULL LIMIT ?)` and loop until a batch changes fewer rows than the batch size. Rebuilding a table drops its indexes — recreate them in the same migration.

## Solutions

### 1. Reading the plan

```js
test('customer order history is an index search with no extra sort', () => {
  const db = openDb();
  const plan = (sql, ...p) =>
    db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...p).map((r) => r.detail).join('\n');

  const history = plan('SELECT id, total_cents FROM orders WHERE customer_id = ? ORDER BY created_at DESC', 1);
  assert.match(history, /USING INDEX idx_orders_customer_created \(customer_id=\?\)/);
  assert.doesNotMatch(history, /TEMP B-TREE/);

  assert.match(plan('SELECT id FROM orders WHERE status = ?', 'paid'), /^SCAN orders$/m);
  assert.match(
    plan('SELECT id FROM orders WHERE customer_id = ? ORDER BY total_cents DESC', 1),
    /TEMP B-TREE FOR ORDER BY/,
  );
});
```

WHY: `SEARCH ... USING INDEX` means SQLite seeks straight to customer 1's entries; `SCAN` means it reads every row. Because the index stores `(customer_id, created_at DESC)`, one customer's entries are *already* in the requested order, so there's no sort step. Ask for a different order (`total_cents`) and SQLite must collect the rows and sort them in a temporary B-tree. This is also why "just add an index on status" is usually wrong: four distinct values means each one still matches a big slice of the table.

### 2. `placeOrder` with stock

```js
// db.js — appended to MIGRATIONS
{
  version: 5,
  name: 'create products',
  sql: `
    CREATE TABLE products (
      sku          TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      price_cents  INTEGER NOT NULL CHECK (price_cents >= 0),
      stock        INTEGER NOT NULL CHECK (stock >= 0)
    ) STRICT;
  `,
},
```

```js
// repository.js
export class OutOfStockError extends Error {
  constructor(sku) {
    super(`Not enough stock (or no such product) for ${sku}`);
    this.name = 'OutOfStockError';
  }
}

export function placeOrder(db, { customerId, lines, createdAt = now() }) {
  db.exec('BEGIN');
  try {
    const take = db.prepare('UPDATE products SET stock = stock - ? WHERE sku = ? AND stock >= ?');
    const priceOf = db.prepare('SELECT price_cents FROM products WHERE sku = ?');
    const items = lines.map(({ sku, quantity }) => {
      // Check and decrement in ONE statement: no gap for a second buyer.
      if (take.run(quantity, sku, quantity).changes === 0) throw new OutOfStockError(sku);
      return { sku, quantity, unitPriceCents: priceOf.get(sku).price_cents };
    });
    const totalCents = items.reduce((s, it) => s + it.quantity * it.unitPriceCents, 0);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO orders (customer_id, status, total_cents, created_at) VALUES (?, ?, ?, ?)')
      .run(customerId, 'pending', totalCents, createdAt);
    const orderId = Number(lastInsertRowid);
    const insertItem = db.prepare(
      'INSERT INTO order_items (order_id, sku, quantity, unit_price_cents) VALUES (?, ?, ?, ?)',
    );
    for (const it of items) insertItem.run(orderId, it.sku, it.quantity, it.unitPriceCents);
    db.exec('COMMIT');
    return { id: orderId, totalCents, items };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
```

Test:

```js
test('placeOrder decrements stock atomically and rolls back on shortage', () => {
  const db = withMigrations(PRODUCTS_MIGRATION); // the object above, exported from your copy
  const ada = createCustomer(db, { name: 'Ada', email: 'a@x.com' });
  db.prepare('INSERT INTO products VALUES (?, ?, ?, ?)').run('MUG', 'Mug', 1999, 2);
  db.prepare('INSERT INTO products VALUES (?, ?, ?, ?)').run('PEN', 'Pen', 220, 100);
  const stock = (sku) => db.prepare('SELECT stock FROM products WHERE sku = ?').get(sku).stock;

  const o = placeOrder(db, { customerId: ada.id, lines: [{ sku: 'MUG', quantity: 2 }, { sku: 'PEN', quantity: 1 }] });
  assert.equal(o.totalCents, 2 * 1999 + 220);
  assert.equal(stock('MUG'), 0);

  assert.throws(
    () => placeOrder(db, { customerId: ada.id, lines: [{ sku: 'PEN', quantity: 5 }, { sku: 'MUG', quantity: 1 }] }),
    OutOfStockError,
  );
  assert.equal(stock('PEN'), 99);             // the PEN decrement was rolled back
  assert.throws(() => placeOrder(db, { customerId: ada.id, lines: [{ sku: 'NOPE', quantity: 1 }] }), OutOfStockError);
  assert.equal(count(db, 'orders'), 1);
});
```

WHY: `SELECT stock` then `UPDATE` is check-then-act — two buyers can both read "1 left". The conditional `UPDATE ... WHERE stock >= ?` checks and writes in one statement, and `changes` tells you whether it happened. Wrapping every line in one transaction means a shortage on line 2 undoes line 1's decrement too. Taking the price from `products` instead of the request also closes a classic hole: a client that sends `unitPriceCents: 1`.

### 3. Soft delete + partial unique index

```js
// db.js — migrate() gains the rebuild flag; the loop body becomes:
for (const m of pending) {
  // A table rebuild drops a table other tables point at, so FK
  // enforcement must be off, and the PRAGMA is ignored inside a
  // transaction. Check the keys ourselves before committing instead.
  if (m.rebuild) db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(m.sql);
    if (m.rebuild) {
      const broken = db.prepare('PRAGMA foreign_key_check').all();
      if (broken.length > 0) throw new Error(`migration ${m.version} broke ${broken.length} foreign key(s)`);
    }
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
      .run(m.version, m.name, new Date().toISOString());
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    if (m.rebuild) db.exec('PRAGMA foreign_keys = ON');
  }
}
```

```js
// db.js — appended to MIGRATIONS
{
  version: 5,
  name: 'customers: soft delete, email unique among live rows only',
  rebuild: true,
  sql: `
    CREATE TABLE customers_new (
      id          INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      email       TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      deleted_at  TEXT
    ) STRICT;
    INSERT INTO customers_new (id, name, email, created_at)
      SELECT id, name, email, created_at FROM customers;
    DROP TABLE customers;
    ALTER TABLE customers_new RENAME TO customers;
    CREATE UNIQUE INDEX ux_customers_email_live ON customers(email) WHERE deleted_at IS NULL;
  `,
},
```

```js
// repository.js
export function softDeleteCustomer(db, id, at = new Date().toISOString()) {
  return db.prepare('UPDATE customers SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
    .run(at, id).changes === 1;
}
```

Test:

```js
test('a soft-deleted email can sign up again; live duplicates still cannot', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);                                          // old schema, with data in it
  const ada = createCustomer(db, { name: 'Ada', email: 'a@x.com' });
  createOrder(db, { customerId: ada.id, items: one });
  migrate(db, [...MIGRATIONS, SOFT_DELETE_MIGRATION]);  // rebuild under live data

  assert.equal(listOrdersWithCustomer(db)[0].customer.name, 'Ada');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.throws(() => createCustomer(db, { name: 'Dup', email: 'a@x.com' }), DuplicateEmailError);

  assert.equal(softDeleteCustomer(db, ada.id), true);
  createCustomer(db, { name: 'Ada 2', email: 'a@x.com' });
  assert.throws(() => createCustomer(db, { name: 'Dup', email: 'a@x.com' }), DuplicateEmailError);
  assert.throws(() => createOrder(db, { customerId: 999, items: one }), /FOREIGN KEY/);
});
```

WHY: A partial index only contains rows matching its `WHERE`, so uniqueness applies to live customers and deleted ones drop out of the check. The rebuild is SQLite's documented way to change a constraint. With FKs *on*, `DROP TABLE customers` checks the orders that point at it and fails; turning them off is only allowed outside a transaction, which is why the flag lives in `migrate()` and not in the SQL. `foreign_key_check` before `COMMIT` puts back the guarantee we switched off. (Postgres can just `ALTER TABLE ... DROP CONSTRAINT`; the partial index syntax is the same.) Remember every read that should hide deleted customers now needs `WHERE deleted_at IS NULL` — the real cost of soft delete.

### 4. Window function: newest N per customer

```js
export function recentOrdersPerCustomer(db, { perCustomer = 3 } = {}) {
  return db
    .prepare(`
      SELECT id, customer_id, total_cents, created_at FROM (
        SELECT o.*,
               ROW_NUMBER() OVER (
                 PARTITION BY o.customer_id
                 ORDER BY o.created_at DESC, o.id DESC
               ) AS rn
        FROM orders o
      )
      WHERE rn <= ?
      ORDER BY customer_id, rn`)
    .all(perCustomer)
    .map((r) => ({ id: r.id, customerId: r.customer_id, totalCents: r.total_cents, createdAt: r.created_at }));
}
```

Test:

```js
test('newest 3 orders per customer', () => {
  const db = openDb();
  const [ada, lin] = ['Ada', 'Lin', 'Sam'].map((n) => createCustomer(db, { name: n, email: `${n}@x.com` }));
  const at = (m) => `2026-03-01T10:0${m}:00.000Z`;
  for (let i = 0; i < 5; i++) createOrder(db, { customerId: ada.id, createdAt: at(i), items: one });
  createOrder(db, { customerId: lin.id, createdAt: at(9), items: one });

  assert.deepEqual(
    recentOrdersPerCustomer(db, { perCustomer: 3 }).map((r) => [r.customerId, r.id]),
    [[ada.id, 5], [ada.id, 4], [ada.id, 3], [lin.id, 6]],
  );
});
```

WHY: `PARTITION BY customer_id` restarts the numbering for each customer; `ORDER BY created_at DESC` makes number 1 the newest. The window function *annotates* rows instead of collapsing them, so the outer query can keep rows 1–3. The subquery is required because `WHERE` runs before window functions are computed (the execution-order table in the SQL guide). Sam has no orders, so he has no rows to number — this is an INNER-style result by design; LEFT JOIN from `customers` if you need him listed.

### 5. Idempotency keys

```js
// db.js — appended to MIGRATIONS
{
  version: 5,
  name: 'idempotency keys for createOrder',
  sql: `
    CREATE TABLE idempotency_keys (
      key           TEXT PRIMARY KEY,
      request_hash  TEXT NOT NULL,
      order_id      INTEGER NOT NULL REFERENCES orders(id),
      created_at    TEXT NOT NULL
    ) STRICT;
  `,
},
```

```js
// repository.js
import { createHash } from 'node:crypto';

export class IdempotencyConflictError extends Error {
  constructor(key) {
    super(`Idempotency key ${key} was already used with a different request`);
    this.name = 'IdempotencyConflictError';
  }
}

const hashRequest = (customerId, items) =>
  createHash('sha256').update(JSON.stringify({ customerId, items })).digest('hex');

export function createOrderIdempotent(db, { idempotencyKey, customerId, items, status = 'pending', createdAt = now() }) {
  assertItems(items);
  const requestHash = hashRequest(customerId, items);
  const replay = () => {
    const seen = db.prepare('SELECT request_hash, order_id FROM idempotency_keys WHERE key = ?').get(idempotencyKey);
    if (!seen) return null;
    if (seen.request_hash !== requestHash) throw new IdempotencyConflictError(idempotencyKey);
    return getOrder(db, seen.order_id);
  };

  const earlier = replay();
  if (earlier) return earlier;

  const totalCents = items.reduce((s, it) => s + it.quantity * it.unitPriceCents, 0);
  db.exec('BEGIN');
  try {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO orders (customer_id, status, total_cents, created_at) VALUES (?, ?, ?, ?)')
      .run(customerId, status, totalCents, createdAt);
    const orderId = Number(lastInsertRowid);
    const insertItem = db.prepare(
      'INSERT INTO order_items (order_id, sku, quantity, unit_price_cents) VALUES (?, ?, ?, ?)',
    );
    for (const it of items) insertItem.run(orderId, it.sku, it.quantity, it.unitPriceCents);
    // The key is written in the SAME transaction as the order: both or neither.
    db.prepare('INSERT INTO idempotency_keys (key, request_hash, order_id, created_at) VALUES (?, ?, ?, ?)')
      .run(idempotencyKey, requestHash, orderId, createdAt);
    db.exec('COMMIT');
    return getOrder(db, orderId);
  } catch (err) {
    db.exec('ROLLBACK');
    // Lost a race: another request committed this key between our check
    // and our insert. Its order is the answer.
    if (err.errcode === 1555) return replay(); // SQLITE_CONSTRAINT_PRIMARYKEY
    throw err;
  }
}
```

Test:

```js
test('a retried request returns the original order; a changed one is refused', () => {
  const db = withMigrations(IDEMPOTENCY_MIGRATION);
  const ada = createCustomer(db, { name: 'Ada', email: 'a@x.com' });
  const req = { idempotencyKey: 'k-1', customerId: ada.id, items: one };

  const first = createOrderIdempotent(db, req);
  assert.deepEqual(createOrderIdempotent(db, req), first);
  assert.equal(count(db, 'orders'), 1);

  assert.throws(
    () => createOrderIdempotent(db, { ...req, items: [{ ...one[0], quantity: 2 }] }),
    IdempotencyConflictError,
  );
  assert.throws(
    () => createOrderIdempotent(db, { idempotencyKey: 'k-2', customerId: 999, items: one }),
    /FOREIGN KEY/,
  );
  assert.equal(count(db, 'idempotency_keys'), 1); // no key left behind by the failure
});
```

WHY: The key is only meaningful if it's stored atomically with its effect — write it in a separate step and a crash between the two leaves either an order with no key (the retry creates a duplicate) or a key with no order. The upfront `SELECT` makes retries cheap; the primary key is the real guard, the same "constraint beats check-then-insert" idea as `UNIQUE(email)`. The hash catches a client reusing a key for a different order, which would otherwise silently return the wrong order. The hash is sensitive to item order in the array; sort items first if clients might reorder them. Real systems also expire old keys (a `created_at` cleanup job).

### 6. Expand, backfill, contract

```js
// db.js — appended to MIGRATIONS (needs the rebuild flag from exercise 3)
{
  version: 5,
  name: 'expand: orders.currency (nullable)',
  sql: `ALTER TABLE orders ADD COLUMN currency TEXT;`,
},
{
  version: 6,
  name: 'contract: orders.currency NOT NULL',
  rebuild: true,
  sql: `
    CREATE TABLE orders_new (
      id           INTEGER PRIMARY KEY,
      customer_id  INTEGER NOT NULL REFERENCES customers(id),
      status       TEXT NOT NULL
                   CHECK (status IN ('pending', 'paid', 'shipped', 'cancelled')),
      total_cents  INTEGER NOT NULL CHECK (total_cents >= 0),
      created_at   TEXT NOT NULL,
      currency     TEXT NOT NULL CHECK (length(currency) = 3)
    ) STRICT;
    INSERT INTO orders_new SELECT id, customer_id, status, total_cents, created_at, currency FROM orders;
    DROP TABLE orders;
    ALTER TABLE orders_new RENAME TO orders;
    CREATE INDEX idx_orders_customer_created ON orders(customer_id, created_at DESC);
    CREATE INDEX idx_orders_created_id ON orders(created_at DESC, id DESC);
  `,
},
```

```js
// repository.js
export function backfillCurrency(db, { batchSize = 1000 } = {}) {
  const step = db.prepare(`
    UPDATE orders SET currency = 'USD'
    WHERE id IN (SELECT id FROM orders WHERE currency IS NULL LIMIT ?)`);
  let total = 0;
  for (;;) {
    const { changes } = step.run(batchSize);
    total += changes;
    if (changes < batchSize) return total;
  }
}
```

Test (`EXPAND_CURRENCY` and `CONTRACT_CURRENCY` are the two migration objects above):

```js
test('expand -> backfill -> contract; contract refuses to run early', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  const ada = createCustomer(db, { name: 'Ada', email: 'a@x.com' });
  for (let i = 0; i < 5; i++) createOrder(db, { customerId: ada.id, items: one });

  migrate(db, [...MIGRATIONS, EXPAND_CURRENCY]);
  createOrder(db, { customerId: ada.id, items: one }); // old code, unaware of currency, still works

  const all = [...MIGRATIONS, EXPAND_CURRENCY, CONTRACT_CURRENCY];
  assert.throws(() => migrate(db, all), /NOT NULL constraint failed: orders_new.currency/);
  assert.equal(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v, 5);
  assert.equal(count(db, 'orders'), 6);                // rolled back, nothing lost

  assert.equal(backfillCurrency(db, { batchSize: 4 }), 6);
  migrate(db, all);
  assert.equal(count(db, 'order_items'), 6);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.throws(() => db.prepare("INSERT INTO order_items VALUES (999, 'X', 1, 1)").run(), /FOREIGN KEY/);
  assert.throws(() => createOrder(db, { customerId: ada.id, items: one }), /NOT NULL constraint failed: orders.currency/);
});
```

That last assertion is the point of the middle step: once the column is `NOT NULL`, code that doesn't write `currency` breaks. So between expand and contract you ship the code change — add `currency` to `createOrder`'s `INSERT` (and to the `orders` rows the repository maps) — and only contract once no running version still writes without it.

WHY: Each step is safe while old and new code run side by side, which is what a rolling deploy means. Expand only adds; old code ignores the new column. Backfill runs in batches so no single statement holds the write lock for the whole table (with millions of rows, one giant `UPDATE` blocks every writer until it finishes). Contract is the only strict step, and because it's a transaction, running it too early fails cleanly with nothing lost — the database enforces the order of operations for you. In Postgres the contract step is just `ALTER TABLE orders ALTER COLUMN currency SET NOT NULL`; SQLite needs the rebuild, and a rebuild drops the table's indexes, so they're recreated in the same migration.
