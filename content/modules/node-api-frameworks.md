# Express, Fastify, NestJS and the database layer

[js/65](../../65-rest-api/) has you build a router and a middleware chain from
nothing, which is the best way to understand one. Job postings, though, name
Express, NestJS and Prisma, and the interview question is "which have you used,
and how did you structure it?" This guide maps what you built onto the real
thing and gives you an opinion to defend.

## What js/65 built, mapped to real frameworks

| You built | Express 5 | Fastify | NestJS |
|---|---|---|---|
| Route table matching method + path | `app.get('/orders/:id', ...)` | `app.get(...)` with a schema | `@Get(':id')` on a controller |
| `next()` chain | middleware | hooks (`onRequest`, `preHandler`) | middleware, guards, interceptors, pipes |
| Catch-all error handler | 4-argument middleware | `setErrorHandler` | exception filters |
| `JSON.parse` of the body | `express.json()` | built in | built in |

Every framework is the same onion: a request goes in through layers, hits a
handler, and the response comes back out. The differences are how much
structure they impose and what they validate for you.

## Express 5

Express 5 became the npm `latest` in 2025 after a decade on 4.x. Three changes
matter in interviews.

**Async errors are forwarded.** In Express 4 a rejected promise inside a
handler was an unhandled rejection and the request hung. You wrapped every
handler in `asyncHandler` or `express-async-errors`. In Express 5 a rejected
promise is passed to `next(err)` for you.

```js
import express from 'express';

const app = express();
app.use(express.json({ limit: '100kb' }));

app.get('/orders/:id', async (req, res) => {
  const order = await orders.findById(Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'not found' });
  res.json(order);
}); // a throw here reaches the error handler in Express 5, not in 4

// Four arguments is how Express recognises an error handler. Drop `next`
// and it becomes ordinary middleware that never sees errors.
app.use((err, req, res, next) => {
  req.log?.error(err);
  res.status(err.status ?? 500).json({ error: 'internal error' });
});
```

**New path syntax.** Express 5 uses path-to-regexp v8. A bare `*` is gone;
wildcards need a name (`/files/*splat`), optional segments use braces
(`/users{/:id}`), and regex characters in path strings are no longer allowed.

**Order is behaviour.** Middleware runs in registration order. Body parsing must
come before routes that read `req.body`; authentication before the routes it
protects; the error handler last. "Why is `req.body` undefined?" is almost
always a parser registered after the route, or missing entirely.

## Project structure that stays testable

```
src/
  app.js              builds and returns the app, never calls listen()
  server.js           imports app, calls listen()
  orders/
    orders.routes.js      paths and middleware only
    orders.schema.js      Zod schemas
    orders.service.js     business rules, no req/res
    orders.repository.js  the only file that talks to the database
```

Routes translate HTTP into function calls. Services hold the rules and know
nothing about Express, so you can test them with plain arguments. Repositories
are the one place SQL or Prisma lives. Validation happens at the edge, before
the service runs, and the error handler turns a `ZodError` into a 400:

```ts
const CreateOrder = z.object({
  customerId: z.number().int().positive(),
  items: z.array(z.object({ sku: z.string(), qty: z.number().int().min(1) })).min(1),
});

router.post('/', async (req, res) => {
  const input = CreateOrder.parse(req.body); // throws ZodError on bad input
  res.status(201).json(await ordersService.create(input));
});

// In the error handler, before the 500 fallback:
if (err instanceof ZodError) return res.status(400).json({ error: 'validation', issues: err.issues });
```

Splitting `app.js` from `server.js` is what lets a test import the app without
opening a port.

## Fastify and NestJS

**Fastify** is schema-first. You declare JSON Schema (or a TypeBox/Zod type
provider) for the body, params and response; Fastify validates input with Ajv and
serialises output with a compiled stringifier, which is a large part of why it
benchmarks well ahead of Express. The response schema also strips fields you did
not declare, so a password hash cannot leak by accident. Plugins are
**encapsulated**: a decorator registered inside one plugin is invisible to its
siblings, which keeps large apps modular.

**NestJS** is an opinionated layer on top of Express or Fastify. You write
modules, controllers and `@Injectable()` providers, and a built-in DI container
wires them. Guards handle auth, pipes handle validation, interceptors wrap
handlers. If you know ASP.NET Core, Nest will feel familiar: it is controllers,
DI and a pipeline, in TypeScript. The cost is decorators, ceremony and a steeper
first week. See [the DI guide](dependency-injection-explained.md) for what the
container is actually doing.

## The database layer

```ts
// Prisma 7: the query engine is TypeScript now; you pass a driver adapter
import { PrismaClient } from './generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

export function findOrderWithItems(id: number) {
  return prisma.order.findUnique({
    where: { id },
    include: { items: true, customer: { select: { name: true } } },
  });
}
```

Create one client per process and import it. A new `PrismaClient` per request
opens a new pool per request and exhausts the database's connections.

| Layer | Examples | You write | Watch out for |
|---|---|---|---|
| Driver | `pg`, `mysql2` | SQL strings with `$1` parameters | No types; string concatenation is SQL injection |
| Query builder | Kysely, Knex | Typed, composable SQL | You still design every join yourself |
| ORM | Prisma, Drizzle, TypeORM | A model; queries as objects | Hidden queries, N+1 in loops |

Drizzle sits between the last two rows: SQL-shaped, typed from a TypeScript
schema, no generate step. Kysely is the pure typed query builder. TypeORM is the
decorator-heavy, Hibernate-style option and the one with the most legacy.

The N+1 looks the same in each: load 50 orders, then fetch each customer in a
loop. With `pg` you write the join. With Prisma you use `include` or `select`.
With Drizzle you use its relational queries or a join. The [ORM
guide](orm-and-ef-core.md) covers the pattern in depth; it transfers directly.

## Production middleware

```js
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';

app.set('trust proxy', 1);                      // behind one load balancer: real client IP
app.use(helmet());                              // security headers
app.use(cors({ origin: ['https://app.example.com'], credentials: true }));
app.use(rateLimit({ windowMs: 60_000, limit: 100 }));
app.use((req, res, next) => {
  req.id = req.get('x-request-id') ?? randomUUID();
  res.set('x-request-id', req.id);
  next();
});
app.use(express.json({ limit: '100kb' }));
```

Without `trust proxy`, every request appears to come from the load balancer and
the rate limiter blocks everyone at once. An in-memory rate limiter is per
instance; with several replicas, back it with Redis.

## Testing an API

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildApp } from '../src/app.js';

test('POST /orders rejects an empty basket', async () => {
  const res = await request(buildApp()).post('/orders').send({ customerId: 1, items: [] });
  assert.equal(res.status, 400);
});
```

Supertest drives the app in memory; Fastify's `app.inject()` does the same
without a library. For the repository layer, run a real Postgres with
Testcontainers rather than mocking Prisma: the bugs you care about (constraints,
migrations, a wrong `where`) live in the database.

## Which framework for which team

| Situation | Pick | Why |
|---|---|---|
| Small team, CRUD API, lots of existing examples | Express 5 | Everyone knows it; the ecosystem is enormous |
| Throughput matters, you like schemas | Fastify | Validation and serialisation built in, faster |
| Large team, many modules, .NET or Java background | NestJS | Enforced structure and DI |
| Data layer, want types and migrations quickly | Prisma | Best tooling, schema file, migrations |
| Data layer, want to stay close to SQL | Drizzle or Kysely | Typed SQL with no hidden queries |

The strongest interview answer is not a favourite. It is "Express with a
routes/services/repositories split and Zod at the edge; I'd reach for Nest when
the team is big enough that conventions pay for themselves."

## What you should be able to answer

- How does Express middleware work, and why does registration order matter?
- How does an error thrown in an async handler reach your error handler in Express 4, and in Express 5?
- Prisma, Drizzle or raw SQL: what are the trade-offs?
- How do you structure an Express app so its business logic can be tested without HTTP?
- Why must you set `trust proxy` behind a load balancer?
- Why should a process create one `PrismaClient`, not one per request?
