// "Orders report" — a real SQLite database, written the way most first
// attempts are. It WORKS: run it and a report prints. Every comment
// marked Problem is a bug waiting for the wrong input or the wrong day.
//
//   node 86-sqlite-orders/original.js
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

var file = path.join(os.tmpdir(), "orders-original.db");
fs.rmSync(file, { force: true });
var db = new DatabaseSync(file);

// Problem 1: no PRAGMA foreign_keys = ON, so REFERENCES is decoration —
// SQLite accepts orders for customers that don't exist. No UNIQUE on
// email, no CHECK on status, no primary key on order_items, no index.
// And the schema is created by "whatever this script says today":
// no migrations, so an existing database never gets the next change.
db.exec(`
  CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT, email TEXT);
  CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id),
                       status TEXT, total REAL, created_at TEXT);
  CREATE TABLE order_items (order_id INTEGER, sku TEXT, quantity INTEGER, price REAL);
`);

function addCustomer(name, email) {
  // Problem 2: "check, then insert". Two signups for the same email that
  // arrive together both pass the check, then both insert.
  var existing = db.prepare("SELECT id FROM customers WHERE email = '" + email + "'").get();
  if (existing) return existing.id;
  // Problem 3: SQL built by string concatenation. A name like O'Brien
  // breaks the statement; a name like  x'); DROP TABLE orders;--
  // becomes part of the SQL. (Try it — see LEARN.md section 8.)
  db.exec("INSERT INTO customers (name, email) VALUES ('" + name + "', '" + email + "')");
  return db.prepare("SELECT id FROM customers WHERE email = '" + email + "'").get().id;
}

function addOrder(customerId, status, createdAt, items) {
  // Problem 4: money as floating point. 1.10 + 2.20 is 3.3000000000000003.
  var total = 0;
  for (var i = 0; i < items.length; i++) total += items[i].price * items[i].quantity;

  // Problem 5: no transaction. The order row commits on its own, then
  // each item commits on its own. If item 2 fails, the order exists
  // with half its items and a total that no longer matches them.
  db.exec("INSERT INTO orders (customer_id, status, total, created_at) VALUES (" +
    customerId + ", '" + status + "', " + total + ", '" + createdAt + "')");
  var orderId = db.prepare("SELECT MAX(id) AS id FROM orders").get().id; // Problem 6: races with other writers
  for (var j = 0; j < items.length; j++) {
    db.exec("INSERT INTO order_items VALUES (" + orderId + ", '" + items[j].sku + "', " +
      items[j].quantity + ", " + items[j].price + ")");
  }
}

var ada = addCustomer("Ada Byron", "ada@example.com");
var lin = addCustomer("Lin Chen", "lin@example.com");
addCustomer("Sam Idle", "sam@example.com");
addOrder(ada, "paid", "2026-03-01T10:00:00.000Z", [{ sku: "STICKER", quantity: 1, price: 1.10 }, { sku: "PEN", quantity: 1, price: 2.20 }]);
addOrder(lin, "shipped", "2026-03-02T10:00:00.000Z", [{ sku: "MUG", quantity: 3, price: 19.99 }]);
addOrder(ada, "pending", "2026-03-03T10:00:00.000Z", [{ sku: "BOOK", quantity: 1, price: 34.50 }]);
addOrder(lin, "paid", "2026-03-04T10:00:00.000Z", [{ sku: "PEN", quantity: 10, price: 2.20 }]);

// Problem 7: database access and printing are one tangle. You can't
// test the numbers without capturing console output, and you can't
// reuse the query for an API endpoint.
var queries = 0;
function printPage(page, sortColumn) {
  // Problem 8: OFFSET pagination. Insert an order while someone reads
  // page 1 and page 2 repeats a row. Also: the sort column is pasted
  // straight in — ?sort=anything becomes SQL.
  var orders = db.prepare("SELECT * FROM orders ORDER BY " + sortColumn +
    " DESC LIMIT 2 OFFSET " + (page * 2)).all();
  queries++;
  for (var i = 0; i < orders.length; i++) {
    // Problem 9: N+1. One query per order to fetch its customer. 2 orders
    // = 3 queries; 1,000 orders = 1,001. Invisible here, obvious in a SQL log.
    var customer = db.prepare("SELECT * FROM customers WHERE id = " + orders[i].customer_id).get();
    queries++;
    console.log("#" + orders[i].id + " " + orders[i].created_at.slice(0, 10) + " " +
      orders[i].status + " $" + orders[i].total + " " + customer.name);
  }
}

console.log("== Recent orders (page 1, page 2) ==");
printPage(0, "created_at");
printPage(1, "created_at");

// Problem 10: summing floats drifts, and the report prints the drift.
var revenue = db.prepare("SELECT SUM(total) AS s FROM orders WHERE status = 'paid'").get().s;
queries++;
console.log("Paid revenue: $" + revenue);

// Problem 11: "customers and their order counts" via INNER JOIN, so a
// customer with no orders (Sam) simply isn't in the list.
var counts = db.prepare("SELECT c.name, COUNT(*) AS n FROM customers c JOIN orders o " +
  "ON o.customer_id = c.id GROUP BY c.id").all();
queries++;
for (var k = 0; k < counts.length; k++) console.log(counts[k].name + ": " + counts[k].n + " orders");
console.log("SQL statements for this report: " + queries + " (grows with every order printed)");

db.close();
fs.rmSync(file, { force: true });
