# Logging with pino

When production breaks, logs are usually the first thing you read, and a pile of
`console.log('here')` lines tells you nothing. pino is the default structured
logger for Node services and what Fastify uses internally. Interviewers ask how you
would find one failing request among thousands, what you log and what you never log.
[Logs, metrics and traces](logging-and-observability.md) covers the principles;
this guide is the concrete Node setup.

## Why structured, and why pino

A structured log line is a JSON object, not a sentence:

```json
{"level":30,"time":1790000000000,"pid":1,"reqId":"f3a1","orderId":812,"msg":"order created"}
```

Your log platform (Loki, Elasticsearch, CloudWatch, Datadog) can then filter on
`orderId = 812` or count `level >= 50` per minute, which it cannot do reliably with
free text.

pino's design goal is low overhead on the main thread: it serialises to JSON with
minimal work and writes to stdout, and anything slow (pretty-printing, shipping to a
service) runs elsewhere. Since logging happens on every request, that matters.

## A production setup

```ts
// src/logger.ts
import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: 'orders-api', version: process.env.APP_VERSION },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) },   // "info" instead of 30
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token', 'card.number'],
    censor: '[redacted]',
  },
});
```

| Level | Number | Use for |
|---|---|---|
| `fatal` | 60 | The process is about to exit |
| `error` | 50 | A request or job failed and someone may need to act |
| `warn` | 40 | Something unexpected that was handled: a retry, a fallback |
| `info` | 30 | Business events and one line per request |
| `debug` | 20 | Detail for diagnosing; off in production by default |
| `trace` | 10 | Very noisy internals |

Calls below the configured level cost almost nothing, so leaving `debug` lines in the
code is fine. Make the level configurable per environment so you can turn it up
during an incident without a code change.

## Logging well: the call shape

```ts
logger.info({ orderId: order.id, totalPence: order.totalPence }, 'order created');
logger.error({ err, orderId }, 'payment capture failed');
```

The object comes first and the message second. Put variable data in fields, not in
the message: `'order created'` is the same string every time, so you can count it,
while `` `order ${id} created` `` is a different string per order. Pass errors under
the key `err`, which pino's default serializer turns into `type`, `message` and
`stack`; a bare `logger.error(err.message)` loses the stack.

## Request logging and correlation ids

`pino-http` logs one line per completed request, with method, URL, status and
duration, and attaches a child logger to each request as `req.log`:

```ts
import { pinoHttp } from 'pino-http';
import { randomUUID } from 'node:crypto';

app.use(pinoHttp({
  logger,
  genReqId: (req, res) => {
    const id = req.headers['x-request-id'] ?? randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  },
  customLogLevel: (req, res, err) =>
    err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
  autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
}));

router.post('/', async (req, res) => {
  req.log.info({ customerId: req.body.customerId }, 'creating order');
});
```

Every line from `req.log` carries the same `reqId`, so one search shows everything
that happened in one request. Reusing an incoming `x-request-id` from the gateway ties
your lines to the gateway's and to other services'. With OpenTelemetry installed,
add the `traceId` too, which links logs to traces.

## Context without passing the logger everywhere

Services and repositories should not take `req`. A child logger is fine to pass as a
dependency, but for deep call chains `AsyncLocalStorage` carries the request context
across `await`s, and pino's `mixin` adds it to every line:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

export const context = new AsyncLocalStorage<{ reqId: string; userId?: number }>();

export const logger = pino({
  mixin: () => context.getStore() ?? {},
});

app.use((req, res, next) => context.run({ reqId: req.id, userId: req.user?.id }, next));
```

Now `logger.info('stock reserved')` anywhere in the call chain includes the request's
id, and concurrent requests never see each other's values, which a module-level
variable could not guarantee.

## What never goes in a log

- Passwords, tokens, API keys, session ids, full `Authorization` or `Cookie` headers.
- Card numbers and other payment data; full request bodies on payment or login routes.
- More personal data than you need: prefer a user id to an email address.

Redaction is a safety net for the paths you know about; the real defence is logging
chosen fields rather than whole objects. `logger.info({ user })` publishes whatever
columns the row has today and gains new ones silently tomorrow.

## Transports, pretty output and performance

In production, write JSON to stdout and let the platform collect it; the process
should not manage files or network shipping. In development, use pino-pretty through
a transport:

```ts
const logger = pino(
  process.env.NODE_ENV === 'development'
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : {},
);
```

Transports run in a **worker thread**, so formatting or shipping never blocks
requests. pino-pretty is slow and its output is not machine-readable, which is why it
stays out of production.

By default pino writes to stdout synchronously, which is safest: a crash cannot lose
the line that explains it. `pino.destination({ sync: false })` buffers for higher
throughput, at the risk of losing the last lines on a crash; call `logger.flush()`
during shutdown if you use it (see [graceful shutdown](node-graceful-shutdown.md)).

## Logging errors once

A common smell is the same failure logged at every layer: the repository logs it, the
service logs it and rethrows, the route logs it, and the error handler logs it again.
Log where you handle an error, not where you pass it on. Usually that means the
central error handler for request failures, with `req.log` so the line has the
request id, and the job runner for background failures. Add context when rethrowing
with `new Error('capturing payment', { cause: err })` instead of logging twice.

## Testing and local use

In tests, set `level: 'silent'` or pass a logger that writes to an array, and assert
on important events (such as "audit line written on role change") only where the
log is itself a requirement. For reading JSON logs locally, pipe them through
`pino-pretty`: `node server.js | npx pino-pretty`.

Practise on [js/36](../../36-log-analyzer/), which parses log lines: point it at
pino's JSON output and notice how much simpler parsing becomes.

## What you should be able to answer

- Why log structured JSON rather than text, and why pino over `console.log`?
- How do you find every log line for one failing request, across services?
- How does `AsyncLocalStorage` help logging, and why is a module-level variable unsafe?
- What must never appear in logs, and how do you enforce it?
- Why are transports run in a worker thread, and why is pino-pretty kept out of production?
- Where in the call chain should an error be logged, and why only once?
