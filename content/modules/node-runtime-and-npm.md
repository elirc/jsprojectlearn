# The Node runtime and the npm ecosystem

Frontend developers moving to fullstack get caught by the same handful of
questions. This guide is those questions.

## What Node is

The same V8 engine as Chrome, plus libuv for asynchronous I/O, plus a standard
library for talking to the operating system.

**Node has, browsers do not:** filesystem, network *servers*, child processes,
environment variables, `process`, direct TCP/UDP.

**Browsers have, Node does not:** the DOM, `window`, `document`,
`localStorage`, `alert`. This is why server-side rendering blows up with
`window is not defined` — code written for one is running in the other.

**Both have:** V8, the event loop, promises, `fetch`, `URL`, `AbortController`,
timers, `console`.

## The event loop, Node flavour

Same core idea as the browser, with extra phases. What matters practically:

1. **JavaScript is single-threaded.** One long synchronous operation blocks
   every concurrent request on that process.
2. **I/O is not on that thread.** libuv handles file and network I/O in a thread
   pool or via OS primitives, and hands results back as callbacks. That is why
   Node handles thousands of concurrent connections happily.
3. **Microtasks (promises) drain before the loop moves on.** Node additionally
   has `process.nextTick`, whose queue is drained *before* promise microtasks.
   Recursive `nextTick` can starve everything else.

So: async database calls are fine. A tight loop over 10 million rows, a
synchronous `JSON.parse` of a 200MB payload, or bcrypt with a high work factor
on the main thread — those stall the whole process.

**"How would you handle a CPU-heavy endpoint?"** Move it to `worker_threads`,
push it onto a queue for a separate worker process, or accept that this
particular service should not be Node.

## Using more than one core

JavaScript runs on one thread per process. You get parallelism by running
multiple processes:

- **In practice:** N containers behind a load balancer. You get restarts,
  rolling deploys and isolation for free.
- **On one box:** the `cluster` module or PM2 forks one process per core.
- **In-process:** `worker_threads` for CPU-bound work, sharing memory via
  `SharedArrayBuffer` if needed.

## Modules: CommonJS and ESM

```js
// CommonJS — synchronous, dynamic, the historical default
const fs = require('node:fs');
module.exports = { thing };

// ESM — static, asynchronous, the standard
import fs from 'node:fs';
export { thing };
```

ESM is enabled by `"type": "module"` in package.json, or a `.mjs` extension.

Friction to expect:

- `__dirname` and `__filename` do not exist in ESM. Use
  `import.meta.dirname` (modern Node) or derive from `import.meta.url`.
- ESM can import CommonJS, and since Node 22.12 / 20.19 CommonJS can
  `require()` ESM too, unflagged (and warning-free in Node 24). The one
  exception: an ES module graph with top-level `await` still throws
  `ERR_REQUIRE_ASYNC_MODULE`, and needs dynamic `import()`.
- Static imports are what make tree shaking possible, and they enable top-level
  `await`.

Prefix built-ins with `node:` (`node:fs`, `node:path`). It is unambiguous and
cannot be shadowed by a package.

## What Node 24 does that used to need a package

- **`.env` files:** `node --env-file=.env server.js`, or
  `process.loadEnvFile()` in code. dotenv is no longer required.
- **TypeScript type stripping:** `node server.ts` runs by default in Node 24
  (and 22.18+). It erases annotations and does **no type-checking**, and it only
  handles erasable syntax: no `enum`, no parameter properties, no namespaces
  with runtime code. `tsc --noEmit` still runs in CI.
- **SQLite:** `node:sqlite` ships in the box (`DatabaseSync`), unflagged,
  still marked experimental — enough for scripts, tests and small tools.
- **`fetch`, `node --test` and `node --watch`** are built in, which covers what
  node-fetch, a test runner and nodemon used to.

## Streams

Reading a 2GB file with `readFile` puts 2GB in memory. Ten concurrent requests
doing that is an out-of-memory kill.

```js
import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';

await pipeline(
  createReadStream('big.log'),
  createGzip(),
  createWriteStream('big.log.gz'),
);
```

Constant memory regardless of file size, and bytes start moving immediately.

**Backpressure** is the consumer signalling it cannot keep up so the producer
should pause. `pipeline` handles it — and handles error propagation and cleanup,
which hand-rolled `.on('data')` loops usually get wrong.

## npm, and the parts that are actually asked about

**dependencies vs devDependencies.** Runtime versus build-and-test. `npm ci
--omit=dev` in a production image gives you a smaller, faster container with
less attack surface. TypeScript and test runners belong in dev.

**The lockfile.** `package.json` says `^1.2.0`; the lockfile pins the exact
resolved version of every package in the whole tree. Commit it. Without it, CI
can resolve a different 1.x than your machine did.

**`npm install` vs `npm ci`:**

| | install | ci |
|---|---|---|
| May update the lockfile | Yes | No — errors if it disagrees |
| Deletes node_modules first | No | Yes |
| Use in | Development | CI and Docker builds |

**Semver.** `^1.2.3` allows any 1.x at or above 1.2.3 (minor + patch).
`~1.2.3` allows patch only. `1.2.3` is exact. The promise that minors are
backwards compatible holds often enough to be useful and not always enough to
skip the lockfile.

**Supply chain.** Everything you install runs with your privileges, including
install scripts. Audit in CI, prefer fewer and better-maintained packages, and
consider `--ignore-scripts` in automated environments.

## Configuration

Environment variables, validated at startup:

```js
const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
};

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}
```

**Crash loudly at boot on missing config.** Discovering a missing
`DATABASE_URL` at 3am on the first request that needs it is much worse than
discovering it during the deploy.

## Errors and process lifecycle

An **uncaught exception** leaves your application state unknown. The right
response is to log it, flush, and exit — let the orchestrator start a clean
process. Using `process.on('uncaughtException')` to keep running produces a
zombie server that fails in confusing ways.

An **unhandled promise rejection** terminates the process by default since Node
15. That is a feature.

**Graceful shutdown** matters more than people expect:

```js
import { promisify } from 'node:util';

process.on('SIGTERM', async () => {
  // A stuck request must not block the rolling deploy forever
  setTimeout(() => process.exit(1), 10_000).unref();
  // Stop accepting; resolves once in-flight requests have finished
  const closed = promisify(server.close.bind(server))();
  server.closeIdleConnections();  // idle keep-alive sockets would hold it open
  await closed;
  await db.end();
  process.exit(0);
});
```

During a rolling deploy the orchestrator sends SIGTERM and waits. Exiting
immediately drops in-flight requests — which is why some teams see 502s on
every deploy and assume it is normal.

## Logging

Structured JSON to stdout, with levels and a correlation id per request. The
container runtime collects stdout; the application should not be managing log
files or rotation.

Never log passwords, tokens, or full request bodies that might contain them.

## Health checks

Two endpoints, not one:

- **Liveness** — is this process wedged and in need of a restart? Keep it
  trivial.
- **Readiness** — can it serve traffic right now (dependencies reachable,
  warm-up done)?

Conflating them means a two-second database blip restarts every instance
simultaneously.

## Things worth knowing exist

- `AbortController` — cancel a fetch, a stream, or your own async work
- `node --test` — a built-in test runner, no dependency required
- `node --watch` — restart on change, no nodemon required
- `worker_threads` — real parallelism for CPU work
- `structuredClone` — deep copy without the JSON round-trip
- `process.memoryUsage()` — first stop when memory grows unbounded
