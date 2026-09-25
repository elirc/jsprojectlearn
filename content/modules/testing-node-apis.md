# Testing Node APIs

"How do you test an API?" is asked in nearly every backend interview, and weak
answers either mock everything or test nothing below the UI. A strong answer names
the layers, explains what each test proves, and shows you can make tests fast and
reliable against a real database. This guide is the Node-specific companion to
[testing strategy](testing-strategy.md).

## What to test at which level

| Level | Drives | Real | Faked | Proves |
|---|---|---|---|---|
| Unit | A service function | The function | Repositories, clock | Business rules and edge cases |
| HTTP integration | The Express app in memory | Routing, middleware, validation, error handler | Often the repository | Status codes, response shapes, auth checks |
| Database integration | The repository | Postgres, migrations | Nothing | Queries, constraints, transactions |
| End-to-end | A deployed build | Everything | Third parties | The system is wired together |

Most of your confidence for a CRUD API comes from the middle two. Pure unit tests are
cheap but miss the bugs that live in SQL and middleware order; end-to-end tests
catch wiring but are slow and flaky, so keep a handful.

## Runner: node:test or Vitest

Node 24's built-in runner needs no install: `node --test` finds `*.test.*` files and
runs each file in its own process, in parallel. It has `describe`/`it`,
`before`/`after` hooks, `mock.fn`, `mock.method`, fake timers and coverage
(`--experimental-test-coverage`). Vitest is the other common choice: faster watch
mode, rich matchers, the same API as Jest, and first-class TypeScript. Either is a
fine answer; know one well. The examples below use `node:test`, and the Vitest
equivalents are `vi.fn`, `vi.spyOn` and `vi.useFakeTimers`.

## The seam: build the app from its dependencies

Tests are easy when the app is built by a function that takes its dependencies,
and hard when modules import singletons (see [structuring a Node
API](structuring-a-node-api.md)).

```js
import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.js';

describe('GET /orders/:id', () => {
  const orders = { findById: mock.fn(async (id) => (id === 1 ? { id: 1, status: 'paid' } : null)) };
  let server, base;

  before(async () => {
    server = buildApp({ orders }).listen(0);          // port 0: any free port
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((r) => server.close(r)));

  it('returns the order', async () => {
    const res = await fetch(`${base}/orders/1`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { id: 1, status: 'paid' });
  });

  it('404s for an unknown id', async () => {
    const res = await fetch(`${base}/orders/2`);
    assert.equal(res.status, 404);
  });
});
```

Port 0 lets parallel test files each start a server without `EADDRINUSE`. Supertest
does the same thing with less code: `await request(app).get('/orders/1').expect(200)`
starts and stops an ephemeral server for you, and `request.agent(app)` keeps cookies
between calls for login-then-fetch flows.

## What an HTTP test should assert

Test the contract a client relies on, not the implementation:

- **Status code and content type** for success and each failure.
- **The response body shape**, including that sensitive fields are absent.
- **Validation:** one test per rule category, checking the 400 names the field.
- **Auth:** no token is 401, wrong role is 403, another user's resource is 404 or 403.
- **Headers you promise:** `Location` on 201, `Retry-After` on 429, cache headers.

Authorization tests are the ones most often missing and the bugs most often
exploited. For each endpoint that takes an id, write "user A cannot read user B's
order".

## A real database, fast

Mocking Prisma or `pg` tells you your code calls the mock the way you wrote it. The
bugs that matter (a wrong join, a missing unique index, a transaction that is not
one) only show up against Postgres. Make that fast:

1. **Start Postgres once per run**, with Docker Compose in CI or Testcontainers from
   a global setup file.
2. **Apply migrations once**, exactly as production does (`prisma migrate deploy` or
   `drizzle-kit migrate`), so the tests also check that migrations work.
3. **Isolate each test** with one of these strategies:

| Strategy | How | Trade-off |
|---|---|---|
| Transaction per test | Begin before, roll back after | Fastest; code under test must use the same connection |
| Truncate between tests | `TRUNCATE ... RESTART IDENTITY CASCADE` | Simple; slower with many tables |
| Database per worker | Template database cloned per test process | Fully parallel; more setup |
| Unique data per test | Random emails and ids, no cleanup | Fast; tables grow, counts are unreliable |

Tests that pass alone and fail together almost always share rows. Never depend on
order, on ids being 1, or on a table being empty unless you guaranteed it.

## Faking the outside world

Faking is right at the boundary you do not own: payment providers, email, other
teams' APIs, time.

```js
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

const partner = setupServer(
  http.get('https://api.partner.test/rates', () => HttpResponse.json({ gbp: 1.17 })),
);
before(() => partner.listen({ onUnhandledRequest: 'error' }));
after(() => partner.close());
```

MSW intercepts Node's `fetch` at the network layer, so your real HTTP client code,
headers and error handling run. `onUnhandledRequest: 'error'` makes a forgotten stub
fail loudly instead of calling the real service. Also test the unhappy paths: a 500
from the partner, a timeout, malformed JSON.

For time, inject a clock (`() => new Date()`) or use fake timers:

```js
mock.timers.enable({ apis: ['setTimeout', 'Date'], now: new Date('2026-01-01') });
mock.timers.tick(60_000);   // runs anything due within the next minute, synchronously
mock.timers.reset();
```

## Spies, and when not to use them

`mock.fn()` records calls, so you can assert "the mailer was called once with this
address". Use that for effects you cannot observe any other way, such as sending
an email. Do not assert that a repository was called with particular arguments when
you could assert on the database state or the response instead; interaction
assertions break on every refactor without catching more bugs.

## Hanging runs and flaky tests

| Symptom | Likely cause | Fix |
|---|---|---|
| Runner never exits | Open server, pool or timer | Close them in `after()` |
| `EADDRINUSE` in CI | Hard-coded port | Listen on port 0 |
| Passes alone, fails together | Shared rows or module state | Isolate per test; build the app per file |
| Fails around midnight or month end | Real clock | Inject a clock or fake timers |
| Fails only in CI | Timing assumptions, missing env var | Await conditions, validate config at startup |

## In CI

Run lint and type-check, then unit and HTTP tests, then database tests against a
service container, with migrations applied from scratch. Fail on `.only` left in
code. Upload coverage as information, not a gate on a number; see [CI/CD
pipelines](ci-cd-pipelines.md).

## What you should be able to answer

- How do you structure an Express app so it can be tested without opening a real port or database?
- Why run repository tests against real Postgres, and how do you keep them isolated and fast?
- What would you assert in an HTTP test for `POST /orders`?
- How do you test code that calls a third-party API, including its failure modes?
- A test suite passes alone but fails when files run together. What do you look for?
- When is asserting on a spy's calls the right choice, and when is it brittle?
