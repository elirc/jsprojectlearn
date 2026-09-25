# Express 5 in depth

Most Node job specs still say "Express", and most Express interview questions are
about the parts people copy without reading: where a request goes, why `req.body`
is undefined, why the error handler never fires, and what changed in version 5.
This guide goes one level below [the frameworks overview](node-api-frameworks.md)
so you can explain the behaviour rather than recite it.

## The request's journey

An Express app is a list of layers. Each `app.use`, `app.get` or `router.post`
appends one. For every request Express walks the list in registration order and
runs each layer whose method and path match. A layer either ends the response or
calls `next()` to hand on to the next matching layer.

```js
import express from 'express';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));   // 1. parse JSON bodies
app.use(requestId);                          // 2. every request
app.use('/api/orders', ordersRouter);        // 3. only /api/orders/*
app.use((req, res) => res.status(404).json({ title: 'Not Found' })); // 4. nothing matched
app.use(errorHandler);                       // 5. four arguments: errors only
```

Three consequences follow, and each is a common interview question:

- **Order is behaviour.** A route registered before `express.json()` sees
  `req.body` as `undefined`. Auth registered after a router does not protect it.
- **The 404 handler is just the last normal middleware.** If nothing earlier
  responded, it runs.
- **Error handlers are recognised by arity.** A function with four parameters
  `(err, req, res, next)` is skipped during normal flow and only runs after
  `next(err)` or a thrown error. Drop the unused `next` and it silently becomes
  ordinary middleware.

`app.use('/api/orders', router)` matches by prefix and strips it: inside the
router, `req.path` is `/42`, while `req.originalUrl` keeps `/api/orders/42?x=1`.
`app.get('/api/orders')` matches the exact path only.

## What changed in version 5

| Area | Express 4 | Express 5 |
|---|---|---|
| Async handlers | A rejected promise hung the request | Rejections go to `next(err)` automatically |
| Wildcards | `/files/*` | Named: `/files/*splat`, value is an array of segments |
| Optional segments | `/users/:id?` | `/users{/:id}` |
| Regex in path strings | Allowed | Removed; use a real `RegExp` or validate the param |
| `req.query` | Plain property | Getter; reassigning it throws in strict mode |
| `req.body` with no parser match | `{}` | `undefined` |
| `express.urlencoded` | `extended: true` default | `extended: false` default |
| `res.status(999)` | Sent anyway | Throws for codes outside 100–999 |
| Node support | 0.10+ | 18+ |

The async change is the one that matters most. In Express 4 you needed an
`asyncHandler` wrapper or the `express-async-errors` patch; delete both when you
upgrade. Only the promise the handler *returns* is caught, though. A promise you
start and do not return or await is still an unhandled rejection that can crash
the process.

```js
app.post('/orders', async (req, res) => {
  const order = await orders.create(req.body);   // a rejection here reaches errorHandler
  sendConfirmation(order);                       // not awaited: a rejection here is NOT caught
  res.status(201).json(order);
});
```

## Routing details that bite

```js
app.get('/users/me', me);          // must come first...
app.get('/users/:id', getUser);    // ...or /users/me matches here with id = 'me'

app.get('/files/*splat', (req, res) => {
  res.json(req.params.splat);      // GET /files/a/b/c.txt -> ["a","b","c.txt"]
});

const items = express.Router({ mergeParams: true });
items.get('/', (req, res) => res.json({ order: req.params.orderId }));
app.use('/orders/:orderId/items', items);   // without mergeParams, orderId is undefined
```

Route params are always strings. `Number('abc')` is `NaN`, and `NaN` in a query
is either a database error or a mysterious empty result, so validate params like
any other input (see [validation and DTOs](node-validation-and-dtos.md)).

`app.route('/orders').get(list).post(create)` groups handlers for one path and
lets Express answer other methods with a 404 by default; add an explicit 405 with
an `Allow` header if your API promises one.

## Body parsers

`express.json()` only parses requests whose `Content-Type` matches
`application/json`. A client sending `text/plain` gets `req.body === undefined`
with no error, which is why it is worth rejecting wrong content types explicitly
on write routes.

| Option | Default | Why you change it |
|---|---|---|
| `limit` | `100kb` | Raise it for one route that needs more, never globally |
| `type` | `application/json` | Accept `application/vnd.api+json` or `application/merge-patch+json` |
| `strict` | `true` | Leave it: only objects and arrays are accepted |
| `verify` | none | Capture the raw bytes for webhook signature checks |

Oversized bodies produce a 413 and malformed JSON a 400, both passed to your error
handler as errors with a `status` (or `statusCode`) and a `type` such as
`entity.too.large` or `entity.parse.failed`. Make the handler honour that status
instead of turning everything into a 500.

For a webhook that must verify a signature over the exact bytes, mount
`express.raw({ type: 'application/json' })` on that route only, before the global
JSON parser can consume the stream.

## A proper error handler

```js
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);          // let Express close the socket

  const status = err.status ?? err.statusCode ?? 500;
  if (status >= 500) req.log.error({ err }, 'request failed');

  res.status(status).type('application/problem+json').json({
    type: 'about:blank',
    title: status >= 500 ? 'Internal Server Error' : err.message,
    status,
    instance: req.originalUrl,
  });
}
```

Four things to notice. `headersSent` handles a failure halfway through a streamed
response, where you can no longer change the status. The status comes from the
error, so 4xx errors raised by parsers or your own `NotFoundError` class keep
their meaning. Internal messages are not leaked for 5xx responses. And the
`type()` call happens before `json()`, because `json()` only sets
`application/json` when no content type is set yet, which gives you RFC 9457
problem details (see [REST API design](rest-api-design.md)).

"Cannot set headers after they are sent" almost always means a handler responded
twice: a missing `return` before `res.status(404).json(...)`, or calling `next()`
after sending.

## req and res, the useful parts

| You want | Use | Note |
|---|---|---|
| Client IP behind a proxy | `req.ip` with `app.set('trust proxy', 1)` | Without it you see the balancer's address |
| A header | `req.get('x-request-id')` | Case-insensitive |
| Per-request data for later middleware | `res.locals` or a typed `req.user` | Not module-level variables |
| JSON response | `res.json(obj)` | Sets Content-Type, serialises, handles `null` |
| Redirect after a form POST | `res.redirect(303, url)` | 303 forces a GET |
| No body | `res.sendStatus(204)` | Sets the status and ends |
| Download | `res.download(path, name)` | Sets `Content-Disposition` |

`res.json` calls `JSON.stringify`, so a `BigInt` from a BIGINT column throws a
`TypeError`, and a `Date` becomes an ISO string. Map rows to response objects
before sending, which also stops you leaking columns you did not mean to expose.

## Typing Express in TypeScript

```ts
import type { Request, Response } from 'express';

type Params = { id: string };
type Body = { qty: number };

app.patch('/items/:id', (req: Request<Params, unknown, Body>, res: Response) => {
  req.params.id;   // string
  req.body.qty;    // number, but only because you said so
});
```

The generics describe what you expect, they do not check it. The body is still
whatever the client sent until a schema has parsed it. For `req.user`, augment
`Express.Request` in a `.d.ts` file with a global declaration rather than casting
in every handler.

## Settings worth knowing

- `trust proxy`: set it to the number of proxies in front of you. `true` trusts
  any `X-Forwarded-For`, which lets clients spoof their IP and dodge rate limits.
- `query parser`: `simple` by default in Express 5, so `?a[b]=1` stays a flat
  key. Switch to `extended` only if you need nested objects, and validate them.
- `etag`: weak ETags are generated for `res.send` bodies, and a matching
  `If-None-Match` gets a 304 for free. That is useful for GETs and irrelevant
  for mutations.
- `env`: derived from `NODE_ENV`. In production Express caches view templates and
  its default error handler stops printing stack traces.

The practice project [js/65](../../65-rest-api/) builds a router and middleware
chain by hand; rebuild its routes in Express 5 afterwards and compare.

## What you should be able to answer

- Why is `req.body` undefined in this route, and what are the two usual causes?
- How does an error in an async handler reach the error handler in Express 5, and which errors still escape?
- How do you declare optional and wildcard route segments in Express 5?
- Why does an error handler check `res.headersSent`, and why does it need four parameters?
- What does `trust proxy` do, and why is `true` a bad value behind one load balancer?
- How would you accept a raw body for one webhook route while the rest of the API parses JSON?
