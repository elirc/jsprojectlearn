# Mocking the network with MSW

Mock Service Worker has become the default way to fake an API in React tests,
Storybook and local development. Interviewers ask about it because it
separates people who mock their own `fetch` wrapper from people who test the
real request code. [Testing React apps](frontend-testing.md) explains why to
mock at the network layer; this guide covers MSW v2 well enough to run a real
suite on it.

## Handlers: `http` and `HttpResponse`

A handler pairs a method and a path with a resolver that returns a response.
MSW v2 uses the standard Fetch API `Request` and `Response` classes:

```ts
// src/mocks/handlers.ts
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('/api/orders', () =>
    HttpResponse.json([{ id: 1, ref: 'ORD-1', status: 'open' }]),
  ),

  http.get('/api/orders/:id', ({ params }) =>
    HttpResponse.json({ id: Number(params.id), ref: `ORD-${params.id}`, status: 'open' }),
  ),

  http.post('/api/orders', async ({ request }) => {
    const body = (await request.json()) as { ref: string };
    return HttpResponse.json({ id: 99, ...body, status: 'open' }, { status: 201 });
  }),

  http.delete('/api/orders/:id', () => new HttpResponse(null, { status: 204 })),
];
```

`HttpResponse.json` sets the `Content-Type` header for you; `HttpResponse.text`
and `HttpResponse.xml` exist too. The resolver also receives `cookies`. A
request body can only be read once, so read it with `await request.json()`
(or `.text()`, `.formData()`) and keep the result.

If you remember MSW v1's `rest.get((req, res, ctx) => res(ctx.json(...)))`,
that API is gone. Code written against it needs migrating.

## Wiring it into Vitest

In tests, MSW intercepts requests inside the Node process with `setupServer`.
Start it once in a setup file, so every test file gets the same lifecycle:

```ts
// src/mocks/node.ts
import { setupServer } from 'msw/node';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
```

```ts
// src/test/setup.ts
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from '../mocks/node';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'jsdom', setupFiles: ['./src/test/setup.ts'] },
});
```

- **`onUnhandledRequest: 'error'`** makes any request without a handler fail
  loudly. The default only warns, which lets a test pass while quietly hitting
  (or failing to hit) a real URL.
- **`resetHandlers()`** removes handlers added during a test and restores the
  initial set, so one test's error scenario can't leak into the next.
- **`close()`** restores the original request modules when the run ends.

## Per-test overrides with `server.use`

The default handlers describe the happy path. A test that needs a different
answer prepends its own handler; the most recently added matching handler wins:

```tsx
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/node';

test('shows an empty state', async () => {
  server.use(http.get('/api/orders', () => HttpResponse.json([])));
  render(<Orders />);
  expect(await screen.findByText(/no orders yet/i)).toBeInTheDocument();
});

test('recovers when the first save fails', async () => {
  server.use(
    http.post('/api/orders', () => new HttpResponse(null, { status: 503 }), { once: true }),
  );
  // first submit gets 503, the retry falls back to the default handler
});
```

`{ once: true }` makes a handler respond a single time and then stop matching,
which is the cleanest way to test "fails, then succeeds on retry".

A resolver that returns nothing (`undefined`) doesn't respond: MSW falls
through to the next matching handler. That lets you write a handler that only
observes, or only overrides some requests:

```ts
http.get('/api/orders', ({ request }) => {
  if (new URL(request.url).searchParams.get('status') === 'cancelled') {
    return HttpResponse.json([]);
  }
  // no return: the default /api/orders handler answers
});
```

To let a request reach the real network deliberately, return `passthrough()`
(also exported from `msw`).

## Errors, delays and loading states

There are two different kinds of failure, and your UI should handle both:

| Scenario | Handler | What your code sees |
|---|---|---|
| Server error, validation error, 404 | `HttpResponse.json(problem, { status: 422 })` | `fetch` resolves; `response.ok` is `false` |
| Network failure: offline, DNS, CORS, connection reset | `HttpResponse.error()` | `fetch` rejects with a `TypeError` |

A client that only checks for rejections will treat a 500 as success, and one
that only checks `response.ok` will crash on a network error. Test both. For
error bodies, return the same problem-details shape your API really sends
([API error design](api-error-design.md)).

To test loading UI, add a delay with `delay` from `msw`:

```ts
import { delay, http, HttpResponse } from 'msw';

http.get('/api/orders', async () => {
  await delay();              // a short, realistic server delay
  return HttpResponse.json([]);
});

http.get('/api/orders', async () => {
  await delay('infinite');    // never responds: assert on the spinner
});
```

`delay(1500)` waits an exact number of milliseconds. `delay('infinite')` is the
reliable way to assert on a loading state or test a timeout and abort path,
because the spinner can't disappear before you check it. Keep real delays out
of the default handlers used by tests, or the whole suite slows down.

## Paths, params and query strings

Path parameters come from the handler's path pattern: `/api/orders/:id` gives
`params.id` as a string. Query strings are **not** part of the match. Write the
handler for the path alone and read the query from the request URL:

```ts
http.get('/api/orders', ({ request }) => {
  const url = new URL(request.url);
  const page = Number(url.searchParams.get('page') ?? '1');
  const status = url.searchParams.get('status');
  return HttpResponse.json(paginate(filterByStatus(allOrders, status), page));
});
```

Putting `?page=2` in the handler path doesn't do what you'd expect, and MSW
warns about it. Matching one handler per path and branching on the query keeps
handlers few and readable.

## The relative-URL pitfall in Node

In the browser, `fetch('/api/orders')` resolves against the page's origin. In
Vitest, `fetch` is Node's own implementation (jsdom doesn't provide one), and
Node's `fetch` has no page to resolve against: a relative URL throws
`TypeError: Failed to parse URL from /api/orders` before MSW ever sees it.

The robust fix is to have your API client build absolute URLs from a
configured base, which you need for deployment anyway:

```ts
const API_BASE = import.meta.env.VITE_API_BASE ?? window.location.origin;

export function apiUrl(path: string) {
  return new URL(path, API_BASE).toString();
}
```

Then match handlers on the same base, or on any origin with a leading wildcard:
`http.get('*/api/orders', ...)`. Mixing absolute handlers with a different
origin in the client is the other common cause of "why is my handler not
matching?". [Fetch in depth](fetch-in-depth.md) covers URL building.

## MSW in the browser for development

The same handlers can run in the browser through a real Service Worker. Generate
the worker script into your static folder once:

```sh
npx msw init public --save
```

That copies `mockServiceWorker.js` into `public/` and records the folder in
`package.json` so upgrades can update it. Then start the worker only in
development, before rendering:

```ts
// src/main.tsx
async function enableMocking() {
  if (!import.meta.env.DEV || import.meta.env.VITE_MOCKS !== 'on') return;
  const { worker } = await import('./mocks/browser'); // setupWorker(...handlers) from 'msw/browser'
  await worker.start({ onUnhandledRequest: 'bypass' });
}

enableMocking().then(() => createRoot(document.getElementById('root')!).render(<App />));
```

The dynamic import keeps MSW out of the production bundle, and awaiting
`start()` avoids a race where the first requests fire before the worker is
ready. Requests appear in the Network tab as normal, which makes the mocked
app debuggable. `'bypass'` lets images, fonts and real third-party calls
through in development.

## One set of handlers, three consumers

Keep handlers in one module and reuse them everywhere:

- **Tests:** `setupServer(...handlers)`, plus `server.use` overrides.
- **Storybook:** the community `msw-storybook-addon` lets each story declare
  handlers, so "error" and "empty" stories use the same scenarios as tests.
- **Development:** `setupWorker(...handlers)` to build UI before the backend
  endpoint exists.

The risk is **drift**: the real API changes and the mocks don't, so tests pass
against an API that no longer exists. Handlers accept type parameters for path
params, request body and response body, so you can tie them to types generated
from the OpenAPI spec (for example with `openapi-typescript`):

```ts
import type { components } from './generated/api';
type Order = components['schemas']['Order'];

http.get<{ id: string }, never, Order>('/api/orders/:id', ({ params }) =>
  HttpResponse.json({ id: Number(params.id), ref: 'ORD-1', status: 'open' }),
);
```

When the spec changes and the types regenerate, stale handlers stop compiling.
[Contract-first APIs with OpenAPI](openapi-contract-first.md) covers generating
those types. Contract tests against the real API, and a few Playwright journeys
([End-to-end testing with Playwright](playwright-e2e.md)), catch what types can't.

## What you should be able to answer

- Why is mocking at the network layer with MSW better than mocking `fetch` or your API client?
- What do `onUnhandledRequest: 'error'` and `server.resetHandlers()` protect against?
- How do you test "the first request fails and the retry succeeds"?
- What is the difference between returning a 500 and returning `HttpResponse.error()`, and why test both?
- How do you read query-string parameters in an MSW handler, and why can't you match on them in the path?
- How do you stop MSW handlers drifting from the real API?
