# Data access in Node with Prisma and Drizzle

Most Node job specs name an ORM, and it is usually Prisma or Drizzle. Interviewers
ask which you have used, how you avoid N+1 queries, how migrations work in a team
and how you run a transaction. This guide covers both tools at the level you need
to answer those questions and to work in either codebase on day one. The
general ORM ideas are in [ORMs and EF Core](orm-and-ef-core.md); the short
comparison is in [the frameworks guide](node-api-frameworks.md).

## Two philosophies

| | Prisma | Drizzle |
|---|---|---|
| Schema | `schema.prisma`, its own language | TypeScript files |
| Types | Generated client (`prisma generate`) | Inferred directly from the TS schema |
| Queries | Object API: `findMany({ where, include })` | SQL-shaped builder plus a relational query API |
| Migrations | `prisma migrate` from schema diffs | `drizzle-kit generate` from schema diffs |
| Feels like | An ORM that hides SQL | Typed SQL |
| Good when | You want tooling, a schema file and quick CRUD | You think in SQL and want no hidden queries |

Neither is a wrong choice. What matters is that you know what SQL each call
produces.

## Prisma: setup and the client

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

model Order {
  id         Int         @id @default(autoincrement())
  customerId Int
  customer   Customer    @relation(fields: [customerId], references: [id])
  status     String      @default("pending")
  totalPence Int
  items      OrderItem[]
  createdAt  DateTime    @default(now())

  @@index([customerId, createdAt])
}
```

```ts
// src/db.ts: Prisma 7 connects through a driver adapter
import { PrismaClient } from './generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
```

In Prisma 7 the CLI reads the database URL for migrations from `prisma.config.ts`
rather than from the datasource block, and the runtime connection comes from the
adapter. Create **one** client per process and share it. Each client owns a connection pool,
so a client per request exhausts Postgres's connections within minutes. Call
`prisma.$disconnect()` in your shutdown handler (see [graceful
shutdown](node-graceful-shutdown.md)).

## Prisma queries you will write every day

```ts
// Only the columns you need, plus one related object: 2 queries total, not N+1
const orders = await prisma.order.findMany({
  where: { customerId, status: { in: ['pending', 'paid'] } },
  orderBy: { createdAt: 'desc' },
  take: 20,
  select: {
    id: true,
    status: true,
    totalPence: true,
    items: { select: { sku: true, qty: true } },
  },
});
```

- `include` loads relations with all their fields; `select` picks fields and
  relations explicitly. Prefer `select` for API responses so a new column is not
  returned by accident.
- `findUnique` needs a unique field; `findFirst` takes any filter.
- `update` throws when no row matches (error code `P2025`); map it to a 404.
- A unique-constraint violation is `P2002`; map it to a 409. Catch
  `Prisma.PrismaClientKnownRequestError` and switch on `code`.
- `Decimal` columns come back as `Prisma.Decimal` objects and `BigInt` columns as
  `bigint`; neither survives `res.json` unconverted.

The N+1 in Prisma looks innocent: `for (const o of orders) await
prisma.customer.findUnique(...)`. Use `include`/`select` on the relation, or one
`findMany({ where: { id: { in: ids } } })` and a Map.

## Prisma transactions

```ts
// Batch: fixed list of writes, one transaction
await prisma.$transaction([
  prisma.order.update({ where: { id }, data: { status: 'cancelled' } }),
  prisma.auditLog.create({ data: { orderId: id, action: 'cancel' } }),
]);

// Interactive: read, decide, write, with the tx client
await prisma.$transaction(async (tx) => {
  const product = await tx.product.findUniqueOrThrow({ where: { id: productId } });
  if (product.stock < qty) throw new ConflictError('Out of stock');
  await tx.product.update({ where: { id: productId }, data: { stock: { decrement: qty } } });
  await tx.orderItem.create({ data: { orderId, productId, qty } });
});
```

Inside the callback, use `tx`, not `prisma`; a query on the global client runs
outside the transaction. Keep the callback short and never call external APIs in it:
it holds a connection and row locks until it returns, and Prisma times it out after
five seconds by default. Note that the read-then-decrement above can still race
under Read Committed; an atomic `updateMany({ where: { id, stock: { gte: qty } } })`
that checks the affected count is safer.

## Drizzle: schema and queries

```ts
// src/db/schema.ts
import { pgTable, serial, integer, text, timestamp, index } from 'drizzle-orm/pg-core';

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  customerId: integer('customer_id').notNull(),
  status: text('status').notNull().default('pending'),
  totalPence: integer('total_pence').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('orders_customer_created').on(t.customerId, t.createdAt)]);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
```

```ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, desc, inArray } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from './schema';

export const db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL }), { schema });

const recent = await db
  .select({ id: orders.id, status: orders.status })
  .from(orders)
  .where(and(eq(orders.customerId, customerId), inArray(orders.status, ['pending', 'paid'])))
  .orderBy(desc(orders.createdAt))
  .limit(20);
```

The builder maps almost one-to-one onto SQL, so what you write is what runs. Joins
are explicit (`.innerJoin(customers, eq(orders.customerId, customers.id))`). Once
you declare `relations`, `db.query.orders.findMany({ with: { items: true } })` gives a
Prisma-like nested result.

Transactions take a callback: `await db.transaction(async (tx) => { ... })`, and as
with Prisma every query inside must use `tx`. Raw SQL goes through the `sql` tagged
template, which parameterises interpolated values; `sql.raw()` does not, so never
feed it input.

## Migrations in a team

Both tools diff your schema against the last migration and write a SQL file you
commit.

| Step | Prisma | Drizzle |
|---|---|---|
| Create a migration locally | `prisma migrate dev --name add_status` | `drizzle-kit generate` |
| Apply in CI/production | `prisma migrate deploy` | `drizzle-kit migrate` (or run at startup) |
| Prototype without history | `prisma db push` | `drizzle-kit push` |

Rules that prevent incidents:

- **Read the generated SQL.** Renaming a field can come out as drop-and-add, which
  deletes the column's data. Edit the migration to a `RENAME COLUMN`.
- **Never use `migrate dev` or `push` against production.** `migrate dev` can offer
  to reset the database.
- **Make changes backwards-compatible** for rolling deploys: add a nullable column,
  deploy code that writes it, backfill, then make it required in a later migration.
- **Merge conflicts in migrations** happen when two branches both add one. Rebase,
  delete your unapplied migration, regenerate it on top of main.

The same discipline for EF Core is in [EF Core migrations in teams](ef-core-migrations-in-teams.md);
it transfers directly.

## Connections and pooling

A Postgres connection costs memory on the server, and `max_connections` is often
100. Each Node process has a pool (node-postgres defaults to 10). Ten replicas with
pools of 20 is 200 connections, more than the database allows. Size pools from the
database's limit divided by instances, and put PgBouncer or a managed pooler in
front when you scale out or run serverless functions, which otherwise open a pool
per invocation.

## Testing the data layer

Mocking the ORM tests nothing that matters: the bugs are a wrong `where`, a missing
index, a constraint you forgot. Run a real Postgres in Docker or Testcontainers,
apply migrations once, and isolate tests by wrapping each in a rolled-back
transaction or by truncating tables between tests. See [testing Node
APIs](testing-node-apis.md).

Practise on [js/86](../../86-sqlite-orders/), which uses SQLite directly: rewrite its
repository with Drizzle's SQLite driver and compare the queries.

## What you should be able to answer

- How do Prisma and Drizzle differ, and when would you choose each?
- How do you avoid an N+1 query in Prisma?
- What is the difference between Prisma's batch and interactive transactions, and what must you avoid inside the callback?
- Which migration commands run in development and which in production, and why?
- Why should a process create one Prisma client, and how do you size connection pools across replicas?
- How do you run raw SQL safely in each tool?
