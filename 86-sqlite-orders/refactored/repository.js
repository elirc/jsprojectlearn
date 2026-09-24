/**
 * The repository: every SQL statement the app runs lives in this file.
 *
 * House rules:
 *   - Values travel as PARAMETERS (?, :name), never inside the SQL text.
 *   - Identifiers that must be dynamic (ORDER BY) come from an allowlist.
 *   - Money is integer cents in and out. Timestamps are ISO UTC text.
 *   - Rows are mapped to plain camelCase objects at the boundary, so
 *     callers never see snake_case columns or SQLite's null-prototype rows.
 */

export class DuplicateEmailError extends Error {
  constructor(email) {
    super(`A customer with email ${email} already exists`);
    this.name = 'DuplicateEmailError';
  }
}

const now = () => new Date().toISOString();
const normalizeEmail = (email) => String(email).trim().toLowerCase();

const toCustomer = (r) => ({ id: r.id, name: r.name, email: r.email, createdAt: r.created_at });

const ORDER_WITH_CUSTOMER = `
  SELECT o.id, o.status, o.total_cents, o.created_at,
         c.id AS customer_id, c.name AS customer_name, c.email AS customer_email
  FROM orders o
  JOIN customers c ON c.id = o.customer_id`;

const toOrderRow = (r) => ({
  id: r.id,
  status: r.status,
  totalCents: r.total_cents,
  createdAt: r.created_at,
  customer: { id: r.customer_id, name: r.customer_name, email: r.customer_email },
});

// ---------------------------------------------------------------- customers

/**
 * UNIQUE(email) is the duplicate guard, not a SELECT beforehand.
 * "Check, then insert" has a gap between the two statements where a
 * second request can pass the same check; the constraint has no gap.
 * So: just insert, and translate the violation into a domain error.
 */
export function createCustomer(db, { name, email, createdAt = now() }) {
  const clean = normalizeEmail(email);
  try {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO customers (name, email, created_at) VALUES (?, ?, ?)')
      .run(name, clean, createdAt);
    return { id: Number(lastInsertRowid), name, email: clean, createdAt };
  } catch (err) {
    if (err.errcode === 2067) throw new DuplicateEmailError(clean); // SQLITE_CONSTRAINT_UNIQUE
    throw err;
  }
}

export function findCustomerByEmail(db, email) {
  const row = db.prepare('SELECT * FROM customers WHERE email = ?').get(normalizeEmail(email));
  return row ? toCustomer(row) : null;
}

// ------------------------------------------------------------------- orders

function assertItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new RangeError('An order needs at least one item');
  }
  for (const it of items) {
    if (typeof it.sku !== 'string' || it.sku === '') throw new TypeError('sku must be a non-empty string');
    if (!Number.isInteger(it.quantity) || it.quantity < 1) {
      throw new RangeError(`quantity must be a positive integer (sku ${it.sku})`);
    }
    // 19.99 is a float that can't be stored exactly; 1999 is exact.
    if (!Number.isInteger(it.unitPriceCents) || it.unitPriceCents < 0) {
      throw new TypeError(`unitPriceCents must be a non-negative integer (sku ${it.sku})`);
    }
  }
}

/**
 * Order + its items are ONE unit of work. Either every row lands or
 * none does: a constraint failure (or crash) halfway can't leave an
 * order with no items, or half of them, for the report to find.
 */
export function createOrder(db, { customerId, items, status = 'pending', createdAt = now() }) {
  assertItems(items);
  const totalCents = items.reduce((sum, it) => sum + it.quantity * it.unitPriceCents, 0);

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

    db.exec('COMMIT');
    return { id: orderId, customerId, status, totalCents, createdAt };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function getOrder(db, id) {
  const row = db.prepare(`${ORDER_WITH_CUSTOMER} WHERE o.id = ?`).get(id);
  if (!row) return null;
  const items = db
    .prepare('SELECT sku, quantity, unit_price_cents FROM order_items WHERE order_id = ? ORDER BY sku')
    .all(id)
    .map((r) => ({ sku: r.sku, quantity: r.quantity, unitPriceCents: r.unit_price_cents }));
  return { ...toOrderRow(row), items };
}

// ORDER BY can't take a parameter (it's an identifier, not a value), so
// user input picks a KEY and only our own strings reach the SQL. Every
// entry ends in o.id so ties have a stable order.
const ORDER_SORTS = {
  newest: 'o.created_at DESC, o.id DESC',
  oldest: 'o.created_at ASC, o.id ASC',
  total: 'o.total_cents DESC, o.id DESC',
  customer: 'c.name ASC, o.id ASC',
};
export const SORT_KEYS = Object.keys(ORDER_SORTS);

function orderByFor(sort) {
  // Object.hasOwn, not `in`: "constructor" and "toString" are not sorts.
  if (!Object.hasOwn(ORDER_SORTS, sort)) {
    throw new RangeError(`Unknown sort "${sort}". Allowed: ${SORT_KEYS.join(', ')}`);
  }
  return ORDER_SORTS[sort];
}

function clampLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('limit must be a positive integer');
  return Math.min(limit, 100);
}

/** Orders with their customer in ONE statement, however many orders. */
export function listOrdersWithCustomer(db, { sort = 'newest', limit = 50 } = {}) {
  return db
    .prepare(`${ORDER_WITH_CUSTOMER} ORDER BY ${orderByFor(sort)} LIMIT ?`)
    .all(clampLimit(limit))
    .map(toOrderRow);
}

/**
 * DELIBERATELY NAIVE: kept so the tests can count its statements.
 * 1 query for the orders + 1 per order for its customer = N+1.
 * Same result as listOrdersWithCustomer; 101 round trips for 100 rows.
 */
export function listOrdersNaive(db, { limit = 50 } = {}) {
  const orders = db
    .prepare('SELECT * FROM orders ORDER BY created_at DESC, id DESC LIMIT ?')
    .all(clampLimit(limit));
  const customerById = db.prepare('SELECT id, name, email FROM customers WHERE id = ?');
  return orders.map((o) => {
    const c = customerById.get(o.customer_id); // <- the "+1", once per order
    return toOrderRow({
      ...o,
      customer_id: c.id, customer_name: c.name, customer_email: c.email,
    });
  });
}

// ------------------------------------------------------------- pagination

// The cursor is opaque to clients: they hand back what we gave them.
// Encoding it means we can change what's inside without breaking them.
export const encodeCursor = (row) =>
  Buffer.from(JSON.stringify([row.createdAt, row.id])).toString('base64url');

export function decodeCursor(cursor) {
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof createdAt === 'string' && Number.isInteger(id)) return { createdAt, id };
  } catch { /* fall through to the one error below */ }
  throw new RangeError('Invalid cursor');
}

/**
 * Keyset ("seek") pagination, newest first. "Give me rows strictly
 * after the last one I saw": a position defined by DATA, so rows
 * inserted meanwhile can't shift the page boundary. id is the
 * tiebreaker: two orders in the same millisecond still sort one way.
 */
export function listOrdersPage(db, { limit = 20, cursor } = {}) {
  const n = clampLimit(limit);
  const params = [];
  let where = '';
  if (cursor !== undefined) {
    const after = decodeCursor(cursor);
    where = 'WHERE (o.created_at, o.id) < (?, ?)'; // row-value comparison
    params.push(after.createdAt, after.id);
  }
  // Fetch one extra row to learn whether a next page exists.
  const rows = db
    .prepare(`${ORDER_WITH_CUSTOMER} ${where} ORDER BY o.created_at DESC, o.id DESC LIMIT ?`)
    .all(...params, n + 1)
    .map(toOrderRow);
  const page = rows.slice(0, n);
  return { rows: page, nextCursor: rows.length > n ? encodeCursor(page.at(-1)) : null };
}

/**
 * OFFSET pagination, kept for contrast. "Skip the first 20 rows" is a
 * position defined by COUNTING: insert a newer row and everything
 * shifts down one, so page 2 repeats page 1's last row. It also slows
 * with depth, because the database still walks every skipped row.
 */
export function listOrdersByOffset(db, { limit = 20, offset = 0 } = {}) {
  return db
    .prepare(`${ORDER_WITH_CUSTOMER} ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?`)
    .all(clampLimit(limit), offset)
    .map(toOrderRow);
}

// ---------------------------------------------------------------- reports

/**
 * Customers whose paid/shipped spend reaches a threshold.
 * WHERE filters rows before grouping; HAVING filters the groups after.
 */
export function topCustomers(db, { minSpentCents = 0, limit = 5 } = {}) {
  return db
    .prepare(`
      SELECT c.id, c.name, COUNT(o.id) AS order_count, SUM(o.total_cents) AS spent_cents
      FROM customers c
      JOIN orders o ON o.customer_id = c.id
      WHERE o.status IN ('paid', 'shipped')
      GROUP BY c.id, c.name
      HAVING SUM(o.total_cents) >= ?
      ORDER BY spent_cents DESC, c.id ASC
      LIMIT ?`)
    .all(minSpentCents, clampLimit(limit))
    .map((r) => ({ id: r.id, name: r.name, orderCount: r.order_count, spentCents: r.spent_cents }));
}

/**
 * EVERY customer with their order count and spend, including those
 * with none. Three details, each a classic bug when missed:
 *   - LEFT JOIN keeps customers with no matching orders.
 *   - COUNT(o.id) skips the all-NULL row such a customer produces;
 *     COUNT(*) would count it and report 1.
 *   - SUM over zero rows is NULL, so COALESCE it to 0.
 * The optional status filter sits in ON, not WHERE: a WHERE on the
 * right-hand table throws away the NULL rows and quietly turns the
 * LEFT JOIN back into an INNER JOIN.
 */
export function customersWithOrderCount(db, { status = null } = {}) {
  return db
    .prepare(`
      SELECT c.id, c.name,
             COUNT(o.id)                     AS order_count,
             COALESCE(SUM(o.total_cents), 0) AS spent_cents
      FROM customers c
      LEFT JOIN orders o
        ON o.customer_id = c.id
       AND (:status IS NULL OR o.status = :status)
      GROUP BY c.id, c.name
      ORDER BY order_count DESC, c.name ASC`)
    .all({ status })
    .map((r) => ({ id: r.id, name: r.name, orderCount: r.order_count, spentCents: r.spent_cents }));
}
