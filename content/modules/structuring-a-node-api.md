# Structuring a Node API that survives its second year

"Walk me through how you would structure this service" is asked in almost every
backend interview, and the answer shows more about your experience than any
trivia question. Express imposes no structure, so every team invents one. This
guide gives you a structure you can defend, explains the few rules that make it
work, and names the mistakes that make Node codebases rot.

## The goal: change one thing in one place

A structure is good if a typical change touches few files and a typical bug can be
found without reading everything. For a CRUD API the changes are almost always
"add a field", "add an endpoint" or "change a rule". Organise for those.

**Feature folders beat layer folders.** A `controllers/`, `services/`, `models/`
split scatters one feature across three directories; past a dozen resources you
open five folders to add a field. Group by feature, then layer inside:

```
src/
  app.ts                 builds the Express app from its dependencies
  server.ts              reads config, builds dependencies, calls listen()
  config.ts              parses and validates process.env once
  db.ts                  creates the pool or ORM client
  errors.ts              AppError, NotFoundError, ConflictError
  http/
    error-handler.ts
    validate.ts
  orders/
    orders.routes.ts     HTTP only: parse, call service, map response
    orders.schema.ts     request/response DTO schemas
    orders.service.ts    rules; no req, no res
    orders.repo.ts       the only place with SQL or ORM calls
    orders.test.ts
  customers/
    ...
```

## Three layers, one direction

| Layer | Knows about | Must not know about |
|---|---|---|
| Routes | HTTP, schemas, the service interface | SQL, the ORM |
| Service | Domain rules, repository interfaces, other services | `req`, `res`, status codes |
| Repository | The database | HTTP, business rules |

Dependencies point inward: routes call services, services call repositories.
A service that imports Express or returns a status code has leaked HTTP into the
place you most want to test in isolation. A route that runs a query has put
data access where nobody will look for it.

```ts
// orders.service.ts
export function makeOrdersService(deps: { orders: OrdersRepo; stock: StockRepo; clock: () => Date }) {
  return {
    async create(input: CreateOrder) {
      const missing = await deps.stock.findUnavailable(input.items);
      if (missing.length) throw new ConflictError(`Out of stock: ${missing.join(', ')}`);
      return deps.orders.insert({ ...input, status: 'pending', createdAt: deps.clock() });
    },
  };
}
```

The service throws domain errors. Only the error handler decides that a
`ConflictError` is a 409. That mapping lives in one file, so "what status do we
return for X" has one answer.

Do not add a layer because a diagram had one. A "controller" that only forwards to a
"service" that only forwards to a "repository" is three files of ceremony. If a route
really is "fetch by id and return it", calling the repository from the route is fine;
introduce the service when there is a rule to put in it.

## A composition root instead of import-time singletons

The most important structural decision in a Node app is **where objects are
created**. If `orders.service.ts` does `import { prisma } from '../db'`, every test
that loads the service gets a real database client, and swapping it means module
mocking. Instead, create everything in one place and pass it in:

```ts
// app.ts
export function buildApp(deps: AppDeps) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use('/orders', ordersRoutes(makeOrdersService(deps)));
  app.use(notFound);
  app.use(errorHandler(deps.logger));
  return app;
}

// server.ts
const config = loadConfig(process.env);
const db = createDb(config.databaseUrl);
const app = buildApp({ orders: ordersRepo(db), stock: stockRepo(db), clock: () => new Date(), logger });
const server = app.listen(config.port);
```

`buildApp` never calls `listen`, so tests can hand it fakes or a test database and
drive it with Supertest. This is dependency injection without a container: plain
functions and arguments. NestJS and awilix automate it for large codebases, but the
idea is the same (see [dependency injection explained](dependency-injection-explained.md)).

## Configuration: parse once, fail fast

```ts
import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.url(),
  JWT_SECRET: z.string().min(32),
});

export const loadConfig = (env: NodeJS.ProcessEnv) => Env.parse(env);
```

Read `process.env` in exactly one module, at startup. A missing secret then crashes
the deploy with a clear message instead of failing on the first request that needs
it at 3 a.m. Everything else receives a typed `config` object. See [configuration and
secrets](env-config-secrets.md) for where the values come from.

## Errors as a small hierarchy

```ts
export class AppError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) {
    super(message);
    this.name = new.target.name;
  }
}
export class NotFoundError extends AppError {
  constructor(what: string) { super(`${what} not found`, 404, 'not_found'); }
}
export class ConflictError extends AppError {
  constructor(message: string) { super(message, 409, 'conflict'); }
}
```

Expected failures become typed errors with a status; anything else is a bug and
becomes a 500 with the details logged but not returned. Some teams prefer returning
result objects from services instead of throwing; that also works, as long as the
whole codebase picks one.

## Transactions across repositories

When one use case writes to two tables, the transaction belongs to the service's
use case, not to either repository. Pass a transaction-scoped handle down:

```ts
await db.transaction(async (tx) => {
  const order = await ordersRepo(tx).insert(data);
  await stockRepo(tx).reserve(order.items);
});
```

Repositories that accept "a database or a transaction" keep this possible. A
repository that opens its own connection internally makes atomic multi-table writes
impossible without rewriting it.

## When the structure is wrong

| Symptom | Likely cause | Fix |
|---|---|---|
| Tests need `vi.mock` for half the imports | Singletons imported at module level | Composition root, pass dependencies |
| The same status mapping in every route | No central error handler | Domain errors + one handler |
| `utils/` with 40 unrelated functions | No home for feature logic | Move code to the feature that uses it |
| Circular import warnings | Services importing each other's modules | Depend on narrower interfaces, or merge features |
| A "service" file of 2,000 lines | One feature doing too much | Split by use case: `create-order.ts`, `refund-order.ts` |

Microservices are rarely the answer at this size. A well-structured modular
monolith, where each feature folder exposes a small public interface and does not
reach into another's repository, gets most of the benefit and none of the network.
See [application architecture](application-architecture.md) for when splitting
does pay.

## Where the practice projects fit

[js/65](../../65-rest-api/) is small enough to live in one file; restructure it into
the layout above once it has two resources and notice which tests become easier.
[js/86](../../86-sqlite-orders/) is a good place to practise the repository boundary
and a multi-table transaction.

## What you should be able to answer

- How would you lay out the folders of an Express API with ten resources, and why by feature?
- What belongs in a route handler, a service and a repository?
- Why split `app.ts` from `server.ts`, and what is a composition root?
- Where should `process.env` be read, and what happens if a variable is missing?
- How do you make two repository writes atomic without leaking the database into the service's callers?
- When is a separate service layer unnecessary ceremony?
