// Every test gets its own in-memory database: fresh schema, no files,
// no cleanup, nothing shared between tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, migrate, countingDb } from './db.js';
import {
  DuplicateEmailError, createCustomer, findCustomerByEmail, createOrder, getOrder,
  listOrdersWithCustomer, listOrdersNaive, listOrdersPage, listOrdersByOffset,
  topCustomers, customersWithOrderCount, decodeCursor,
} from './repository.js';
import { formatCents } from './report.js';

const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const at = (minute) => `2026-03-01T10:${String(minute).padStart(2, '0')}:00.000Z`;
const oneItem = (cents = 1000) => [{ sku: 'SKU', quantity: 1, unitPriceCents: cents }];

/** n orders, round-robin over three customers, one minute apart. */
function seeded(n) {
  const db = openDb();
  const customers = ['Ada', 'Lin', 'Sam'].map((name) =>
    createCustomer(db, { name, email: `${name}@example.com` }));
  for (let i = 0; i < n; i++) {
    createOrder(db, {
      customerId: customers[i % 3].id, status: 'paid', createdAt: at(i), items: oneItem(100 * (i + 1)),
    });
  }
  return { db, customers };
}

test('migrations run in order, are recorded, and re-running is a no-op', () => {
  const db = openDb();
  const versions = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all()
    .map((r) => r.version);
  assert.deepEqual(versions, [1, 2, 3, 4]);
  assert.deepEqual(migrate(db), []); // nothing pending
});

test('foreign keys are enforced: no order for a customer that does not exist', () => {
  const db = openDb();
  assert.throws(
    () => createOrder(db, { customerId: 999, items: oneItem() }),
    /FOREIGN KEY constraint failed/,
  );
  assert.equal(count(db, 'orders'), 0);
});

test('UNIQUE(email) is the concurrency guard that check-then-insert is not', () => {
  const db = openDb();
  // Two signup requests interleave: both CHECK first, both see "free"...
  assert.equal(findCustomerByEmail(db, 'ada@example.com'), null); // request A
  assert.equal(findCustomerByEmail(db, 'ada@example.com'), null); // request B
  // ...both INSERT. Only the constraint stands between us and a duplicate.
  createCustomer(db, { name: 'Ada', email: 'ada@example.com' });
  assert.throws(
    () => createCustomer(db, { name: 'Ada again', email: '  ADA@example.com ' }), // normalised: same email
    DuplicateEmailError,
  );
  assert.equal(count(db, 'customers'), 1);
});

test('createOrder is all-or-nothing: a failing item rolls the whole order back', () => {
  const { db, customers } = seeded(0);
  assert.throws(
    () => createOrder(db, {
      customerId: customers[0].id,
      items: [
        { sku: 'MUG', quantity: 1, unitPriceCents: 1999 },
        { sku: 'MUG', quantity: 2, unitPriceCents: 1999 }, // duplicate (order_id, sku) -> PK violation
      ],
    }),
    /UNIQUE constraint failed: order_items/,
  );
  // The order row was inserted before the failure; ROLLBACK took it back out.
  assert.equal(count(db, 'orders'), 0);
  assert.equal(count(db, 'order_items'), 0);
  // And the connection is usable afterwards (not stuck inside a transaction).
  createOrder(db, { customerId: customers[0].id, items: oneItem() });
  assert.equal(count(db, 'orders'), 1);
});

test('CHECK constraint: status must be one of the allowed values', () => {
  const { db, customers } = seeded(0);
  assert.throws(
    () => createOrder(db, { customerId: customers[0].id, status: 'lost-in-post', items: oneItem() }),
    /CHECK constraint failed/,
  );
});

test('N+1: the JOIN runs 1 statement for N orders, the naive loop runs N+1', () => {
  const N = 12;
  const { db: raw } = seeded(N);
  const db = countingDb(raw);

  const joined = listOrdersWithCustomer(db, { limit: 50 });
  assert.equal(joined.length, N);
  assert.equal(db.count, 1);

  db.reset();
  const naive = listOrdersNaive(db, { limit: 50 });
  assert.equal(db.count, N + 1);

  assert.deepEqual(naive, joined); // same answer, 12x the round trips
});

test('keyset pages never overlap when a row is inserted between calls; OFFSET duplicates', () => {
  const { db, customers } = seeded(6); // orders at minutes 0..5, newest first: 6,5,4 | 3,2,1

  const keyset1 = listOrdersPage(db, { limit: 3 });
  const offset1 = listOrdersByOffset(db, { limit: 3, offset: 0 });
  assert.deepEqual(keyset1.rows.map((o) => o.id), [6, 5, 4]);
  assert.deepEqual(offset1.map((o) => o.id), [6, 5, 4]);

  // Someone places an order while the user is reading page 1.
  createOrder(db, { customerId: customers[0].id, createdAt: at(30), items: oneItem() });

  const keyset2 = listOrdersPage(db, { limit: 3, cursor: keyset1.nextCursor });
  const offset2 = listOrdersByOffset(db, { limit: 3, offset: 3 });

  assert.deepEqual(keyset2.rows.map((o) => o.id), [3, 2, 1]);        // continues exactly
  assert.deepEqual(offset2.map((o) => o.id), [4, 3, 2]);             // everything shifted by one
  assert.ok(offset1.some((o) => o.id === 4) && offset2.some((o) => o.id === 4),
    'OFFSET showed order 4 on both pages');
});

test('keyset breaks ties on id when timestamps collide, and ends with a null cursor', () => {
  const { db, customers } = seeded(0);
  for (let i = 0; i < 5; i++) createOrder(db, { customerId: customers[0].id, createdAt: at(0), items: oneItem() });
  const seen = [];
  let cursor;
  do {
    const page = listOrdersPage(db, { limit: 2, cursor });
    seen.push(...page.rows.map((o) => o.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.deepEqual(seen, [5, 4, 3, 2, 1]); // every row exactly once
  assert.throws(() => decodeCursor('not-a-cursor'), /Invalid cursor/);
});

test('ORDER BY comes from an allowlist: anything else throws before SQL is built', () => {
  const { db } = seeded(3);
  for (const bad of ['name; DROP TABLE customers', 'o.id', 'constructor', '']) {
    assert.throws(() => listOrdersWithCustomer(db, { sort: bad }), /Unknown sort/);
  }
  assert.equal(count(db, 'customers'), 3); // still here
  assert.deepEqual(listOrdersWithCustomer(db, { sort: 'oldest' }).map((o) => o.id), [1, 2, 3]);
});

test('parameters make hostile input plain data', () => {
  const db = openDb();
  const name = "Robert'); DROP TABLE customers;--";
  const c = createCustomer(db, { name, email: "o'brien@example.com" });
  assert.equal(findCustomerByEmail(db, "o'brien@example.com").name, name);
  assert.equal(c.id, 1);
  assert.equal(count(db, 'customers'), 1);
});

test('money round-trips as integer cents and sums exactly', () => {
  const { db, customers } = seeded(0);
  const order = createOrder(db, {
    customerId: customers[0].id,
    items: [
      { sku: 'STICKER', quantity: 1, unitPriceCents: 110 },
      { sku: 'PEN', quantity: 1, unitPriceCents: 220 },
    ],
  });
  assert.equal(order.totalCents, 330); // as floats: 1.1 + 2.2 = 3.3000000000000003
  const back = getOrder(db, order.id);
  assert.equal(back.totalCents, 330);
  assert.ok(back.items.every((it) => Number.isInteger(it.unitPriceCents)));
  assert.equal(formatCents(back.totalCents), '$3.30');

  // Floats are refused at the door, and the STRICT table refuses them too.
  assert.throws(
    () => createOrder(db, { customerId: customers[0].id, items: [{ sku: 'X', quantity: 1, unitPriceCents: 19.99 }] }),
    /unitPriceCents must be a non-negative integer/,
  );
  assert.throws(
    () => db.prepare('INSERT INTO order_items VALUES (?, ?, ?, ?)').run(order.id, 'RAW', 1, 19.99),
    /cannot store REAL value in INTEGER column/,
  );
});

test('LEFT JOIN + COUNT(o.id): a customer with no orders counts 0, not 1', () => {
  const { db, customers } = seeded(0);
  createOrder(db, { customerId: customers[0].id, items: oneItem(500) });

  const rows = customersWithOrderCount(db);
  const sam = rows.find((c) => c.name === 'Sam');
  assert.deepEqual(sam, { id: customers[2].id, name: 'Sam', orderCount: 0, spentCents: 0 }); // COALESCE -> 0, not null

  // The COUNT(*) version of the same query miscounts him:
  const star = db.prepare(`
    SELECT c.name, COUNT(*) AS n FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id
    WHERE c.name = 'Sam' GROUP BY c.id`).get();
  assert.equal(star.n, 1);
});

test('the LEFT JOIN trap: a WHERE on the right table drops the row; ON keeps it', () => {
  const { db, customers } = seeded(0);
  createOrder(db, { customerId: customers[0].id, status: 'paid', items: oneItem() });
  createOrder(db, { customerId: customers[1].id, status: 'pending', items: oneItem() });

  const broken = db.prepare(`
    SELECT c.name, COUNT(o.id) AS n
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id
    WHERE o.status = 'paid'
    GROUP BY c.id ORDER BY c.name`).all().map((r) => r.name);
  assert.deepEqual(broken, ['Ada']); // Lin and Sam vanished: NULL = 'paid' is not true

  const fixed = customersWithOrderCount(db, { status: 'paid' });
  assert.deepEqual(
    fixed.map((c) => [c.name, c.orderCount]),
    [['Ada', 1], ['Lin', 0], ['Sam', 0]],
  );
});

test('topCustomers: WHERE picks paid/shipped rows, HAVING picks big-enough groups', () => {
  const { db, customers } = seeded(0);
  const [ada, lin, sam] = customers;
  createOrder(db, { customerId: ada.id, status: 'paid', items: oneItem(6000) });
  createOrder(db, { customerId: ada.id, status: 'shipped', items: oneItem(5000) });
  createOrder(db, { customerId: lin.id, status: 'paid', items: oneItem(3000) });
  createOrder(db, { customerId: sam.id, status: 'cancelled', items: oneItem(90000) }); // not revenue

  assert.deepEqual(topCustomers(db, { minSpentCents: 10000 }), [
    { id: ada.id, name: 'Ada', orderCount: 2, spentCents: 11000 },
  ]);
  assert.deepEqual(topCustomers(db).map((c) => c.name), ['Ada', 'Lin']);
});

test('formatCents never touches floats', () => {
  assert.equal(formatCents(0), '$0.00');
  assert.equal(formatCents(5), '$0.05');
  assert.equal(formatCents(123456), '$1,234.56');
  assert.equal(formatCents(-250), '-$2.50');
  assert.throws(() => formatCents(1.5), TypeError);
});
