/**
 * Open + migrate. The schema is the first line of defence: every rule
 * the database can enforce (types, keys, uniqueness, allowed values)
 * is enforced HERE, so no code path — ours, a script, a teammate's
 * hotfix — can write a row that breaks it.
 *
 * Uses Node's built-in node:sqlite (unflagged since Node 22.13). No npm install.
 */
import { DatabaseSync } from 'node:sqlite';

// Ordered, append-only. A shipped migration is never edited — you add
// the next version. That's what lets every copy of the database (your
// laptop, CI, production) converge on the same schema.
export const MIGRATIONS = [
  {
    version: 1,
    name: 'create customers',
    sql: `
      CREATE TABLE customers (
        id          INTEGER PRIMARY KEY,
        name        TEXT NOT NULL,
        email       TEXT NOT NULL UNIQUE,  -- the real duplicate guard (see repository.createCustomer)
        created_at  TEXT NOT NULL          -- ISO-8601 UTC; sorts correctly as text
      ) STRICT;
    `,
  },
  {
    version: 2,
    name: 'create orders and order_items',
    sql: `
      CREATE TABLE orders (
        id           INTEGER PRIMARY KEY,
        customer_id  INTEGER NOT NULL REFERENCES customers(id),
        status       TEXT NOT NULL
                     CHECK (status IN ('pending', 'paid', 'shipped', 'cancelled')),
        total_cents  INTEGER NOT NULL CHECK (total_cents >= 0),
        created_at   TEXT NOT NULL
      ) STRICT;

      CREATE TABLE order_items (
        order_id          INTEGER NOT NULL REFERENCES orders(id),
        sku               TEXT NOT NULL,
        quantity          INTEGER NOT NULL CHECK (quantity > 0),
        unit_price_cents  INTEGER NOT NULL CHECK (unit_price_cents >= 0),
        PRIMARY KEY (order_id, sku)          -- one line per product per order
      ) STRICT;
    `,
  },
  {
    version: 3,
    name: 'index orders by customer, newest first',
    // Serves "orders for customer X, newest first" and the JOIN on
    // customer_id. SQLite does NOT index foreign keys for you.
    sql: `CREATE INDEX idx_orders_customer_created ON orders(customer_id, created_at DESC);`,
  },
  {
    version: 4,
    name: 'index orders by (created_at, id) for keyset paging',
    // Matches listOrdersPage's ORDER BY and its (created_at, id) < (?, ?)
    // exactly, so each page is a seek into the index, not a sort.
    sql: `CREATE INDEX idx_orders_created_id ON orders(created_at DESC, id DESC);`,
  },
];

/** Apply every migration newer than what the database has recorded. */
export function migrate(db, migrations = MIGRATIONS) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TEXT NOT NULL
    ) STRICT;
  `);
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version),
  );
  const pending = [...migrations]
    .sort((a, b) => a.version - b.version)
    .filter((m) => !applied.has(m.version));

  for (const m of pending) {
    // One transaction per migration: a failed script leaves no half-built
    // tables AND no version row, so fixing it and re-running just works.
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(m.version, m.name, new Date().toISOString());
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return pending.map((m) => m.version);
}

/** Open (':memory:' by default), switch FKs on, migrate. */
export function openDb(file = ':memory:') {
  const db = new DatabaseSync(file);
  // SQLite ships with FK enforcement OFF, per connection. Without this
  // line every REFERENCES clause above is decoration.
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
}

/**
 * Wrap a database so every statement EXECUTED (not merely prepared) is
 * recorded. This is the "log your SQL" habit in 20 lines: N+1 is
 * invisible in code and obvious in a query log.
 *
 * The repository only ever calls db.prepare(...) and db.exec(...), so
 * it can't tell the wrapper from the real thing.
 */
export function countingDb(db, { onQuery } = {}) {
  const log = [];
  const record = (sql) => {
    log.push(sql);
    onQuery?.(sql);
  };
  return {
    log,
    get count() { return log.length; },
    reset() { log.length = 0; },
    exec(sql) {
      record(sql);
      return db.exec(sql);
    },
    prepare(sql) {
      const stmt = db.prepare(sql);
      const track = (method) => (...args) => {
        record(sql);
        return stmt[method](...args);
      };
      return { run: track('run'), get: track('get'), all: track('all') };
    },
    close: () => db.close(),
  };
}
