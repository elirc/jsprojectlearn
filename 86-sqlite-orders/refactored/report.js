/**
 * Pure formatting: rows in, text out. No database, no console, so it
 * can be tested with literal arrays and reused by a CLI, an email job
 * or an HTTP handler alike.
 */

/** 123456 -> "$1,234.56". Integer math only; the float never exists. */
export function formatCents(cents) {
  if (!Number.isInteger(cents)) throw new TypeError(`cents must be an integer, got ${cents}`);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100).toLocaleString('en-US');
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, '0')}`;
}

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

export function formatOrders(rows) {
  if (rows.length === 0) return '(no orders)';
  return rows
    .map((o) =>
      `#${padL(o.id, 3)}  ${o.createdAt.slice(0, 10)}  ${pad(o.status, 9)} ` +
      `${padL(formatCents(o.totalCents), 10)}  ${o.customer.name}`)
    .join('\n');
}

export function formatCustomerCounts(rows) {
  return rows
    .map((c) => `${pad(c.name, 16)} ${padL(c.orderCount, 2)} orders  ${padL(formatCents(c.spentCents), 10)}`)
    .join('\n');
}

export function formatTopCustomers(rows) {
  if (rows.length === 0) return '(nobody over the threshold)';
  return rows
    .map((c, i) => `${i + 1}. ${pad(c.name, 16)} ${padL(formatCents(c.spentCents), 10)}  (${c.orderCount} orders)`)
    .join('\n');
}

export function formatReport({ orders, customers, top, statementCount }) {
  return [
    '== Recent orders ==',
    formatOrders(orders),
    '',
    '== Every customer (LEFT JOIN, zero-order customers included) ==',
    formatCustomerCounts(customers),
    '',
    '== Top customers (paid + shipped) ==',
    formatTopCustomers(top),
    '',
    `SQL statements executed for this report: ${statementCount}`,
  ].join('\n');
}
