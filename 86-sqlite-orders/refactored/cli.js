/**
 * Thin entry point: open, seed, query, print. Every decision lives in
 * db.js / repository.js / report.js; this file only wires them.
 *
 *   node 86-sqlite-orders/refactored/cli.js           # in-memory
 *   node 86-sqlite-orders/refactored/cli.js --log-sql # print every statement
 */
import { openDb, countingDb } from './db.js';
import {
  createCustomer, createOrder, listOrdersWithCustomer, customersWithOrderCount, topCustomers,
} from './repository.js';
import { formatReport } from './report.js';
import { pathToFileURL } from 'node:url';

export function seedDemo(db) {
  const ada = createCustomer(db, { name: "Ada O'Brien", email: 'ada@example.com' }); // the apostrophe the original chokes on
  const lin = createCustomer(db, { name: 'Lin Chen', email: 'lin@example.com' });
  createCustomer(db, { name: 'Sam Idle', email: 'sam@example.com' }); // never orders

  const at = (day) => `2026-03-${String(day).padStart(2, '0')}T10:00:00.000Z`;
  createOrder(db, {
    customerId: ada.id, status: 'paid', createdAt: at(1),
    items: [{ sku: 'STICKER', quantity: 1, unitPriceCents: 110 }, { sku: 'PEN', quantity: 1, unitPriceCents: 220 }],
  });
  createOrder(db, {
    customerId: lin.id, status: 'shipped', createdAt: at(2),
    items: [{ sku: 'MUG', quantity: 3, unitPriceCents: 1999 }],
  });
  createOrder(db, {
    customerId: ada.id, status: 'pending', createdAt: at(3),
    items: [{ sku: 'BOOK', quantity: 1, unitPriceCents: 3450 }],
  });
  createOrder(db, {
    customerId: lin.id, status: 'paid', createdAt: at(4),
    items: [{ sku: 'PEN', quantity: 10, unitPriceCents: 220 }],
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const logSql = process.argv.includes('--log-sql');
  const raw = openDb(':memory:');
  seedDemo(raw);

  const db = countingDb(raw, { onQuery: logSql ? (sql) => console.log('SQL>', sql.replace(/\s+/g, ' ').trim()) : undefined });
  const report = formatReport({
    orders: listOrdersWithCustomer(db, { sort: 'newest', limit: 10 }),
    customers: customersWithOrderCount(db),
    top: topCustomers(db, { minSpentCents: 1000 }),
    statementCount: db.count,
  });
  console.log(report);
  raw.close();
}
