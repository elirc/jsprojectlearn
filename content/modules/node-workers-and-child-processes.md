# worker_threads and child processes

Node runs your JavaScript on one thread. That is its strength for I/O and its
weakness for CPU work, and "what happens if a request does heavy computation?" is a
standard question for anyone claiming backend Node. This guide covers when to leave
the main thread, which of the three tools to use, and the mistakes that make things
worse rather than better.

## First, decide whether you need it

The event loop is blocked only by **synchronous JavaScript** that runs for a long
time: big `JSON.parse` calls, image or PDF generation in JS, heavy regexes, sorting
millions of items, hashing in a loop. It is not blocked by waiting for the database,
an HTTP call or the file system; those are already asynchronous.

| Work | Blocks the loop? | Move it off the main thread? |
|---|---|---|
| 50 concurrent SQL queries | No | No, it would only add overhead |
| `JSON.parse` of a 200 MB file | Yes | Yes, or stream-parse it |
| Resizing images with a pure-JS library | Yes | Yes |
| `crypto.pbkdf2` / `scrypt` (async form) | No, runs on libuv's pool | No |
| `crypto.pbkdf2Sync` in a handler | Yes | Use the async form |
| A nightly report that takes 10 minutes | Yes, if in-process | Better as a separate job process |

Wrapping CPU work in `async` or sprinkling `await` into it changes nothing: it still
runs on the one thread. Measure with `perf_hooks.monitorEventLoopDelay()` or a CPU
profile before and after (see [the debugging playbook](debugging-playbook.md)).

## Three tools

| | `worker_threads` | `child_process` | `cluster` |
|---|---|---|---|
| Unit | Thread in the same process | Separate OS process | Separate Node processes sharing a port |
| Memory | Own heap; can share `SharedArrayBuffer` | Fully separate | Fully separate |
| Talk via | `postMessage` (structured clone) | stdio, or IPC with `fork` | IPC, rarely needed |
| Start-up cost | Tens of ms, several MB | More: a whole process | Same as a process |
| Use for | CPU-heavy JS inside a service | Running other programs, isolating risky work | Using all cores for an HTTP server on one VM |

## worker_threads

```js
// hash-worker.js
import { parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';

let h = workerData.seed;
for (let i = 0; i < workerData.rounds; i++) h = createHash('sha256').update(h).digest('hex');
parentPort.postMessage(h);
```

```js
// main.js
import { Worker } from 'node:worker_threads';

export function runHash(seed, rounds) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./hash-worker.js', import.meta.url), {
      workerData: { seed, rounds },
    });
    worker.once('message', resolve);
    worker.once('error', reject);    // uncaught exception inside the worker
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`worker exited with ${code}`));
    });
  });
}
```

While the worker grinds, the main thread keeps serving requests. Things to know:

- **Messages are copied**, using the structured clone algorithm. Dates, Maps, Sets,
  typed arrays and plain objects survive; functions and class prototypes do not,
  and `postMessage` throws `DataCloneError` for a function. Send data, not behaviour.
- **Large binary data can be transferred** instead of copied by listing an
  `ArrayBuffer` in the transfer list; the sender loses access to it.
- **An uncaught exception kills only that worker.** The `Worker` object emits
  `error`, then `exit`. Without an `error` listener, the main thread crashes.
- **Each worker is a full V8 isolate** with its own event loop and heap, so creating
  one per request under load costs more than it saves and has no upper bound.

## Use a pool

In real services you run a fixed pool of workers, about one per core, and queue
tasks to them. [Piscina](https://github.com/piscinajs/piscina) is the common choice:

```js
import { Piscina } from 'piscina';
import os from 'node:os';

const pool = new Piscina({
  filename: new URL('./resize-worker.js', import.meta.url).href,
  maxThreads: Math.max(1, os.availableParallelism() - 1),
  maxQueue: 200,                       // reject rather than queue forever
});

app.post('/images', async (req, res) => {
  const thumb = await pool.run({ path: req.file.path, width: 320 });
  res.status(201).json({ thumb });
});
```

A bounded queue matters: when uploads arrive faster than cores can resize, an
unbounded queue turns a slowdown into an out-of-memory crash. Rejecting with a 503
and `Retry-After` is kinder. In a container, remember that
`os.availableParallelism()` reports the machine's CPUs, not a Kubernetes CPU limit,
so a pod limited to 2 CPUs on a 32-core node needs the size set from config.

Building your own pool is a good exercise: [js/84](../../84-worker-pool/) does exactly
that.

## child_process

Use a child process to run another program (ImageMagick, `pg_dump`, a Python
script) or to isolate work that might crash or leak.

| API | Shell? | Output | Use for |
|---|---|---|---|
| `spawn(cmd, args)` | No | Streams | Default choice; long or large output |
| `execFile(cmd, args)` | No | Buffered, 1 MiB `maxBuffer` | Short commands with small output |
| `exec(string)` | Yes | Buffered, 1 MiB `maxBuffer` | Almost never with user input |
| `fork(module)` | No | IPC channel plus stdio | Another Node script you talk to |

```js
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const child = spawn('pg_dump', ['--format=custom', dbName], { stdio: ['ignore', 'pipe', 'inherit'] });
child.stdout.pipe(uploadStream);
const [code] = await once(child, 'close');
if (code !== 0) throw new Error(`pg_dump exited with ${code}`);
```

Two rules. **Never build a shell command from input**: `` exec(`convert ${name} out.png`) ``
lets a filename like `x; rm -rf /` run anything. Use `spawn` or `execFile` with an
argument array, which never goes through a shell. And **stream large output**: `exec`
buffers everything and kills the child once output passes `maxBuffer`, which is how
backup scripts start failing when the database grows past a few MB.

Always handle `error` (the program is not installed) as well as a non-zero exit code,
and pass a `signal` or `timeout` so a hung child cannot hold a request forever.

## cluster, and why containers mostly replaced it

`cluster.fork()` starts several copies of your server that share one listening port;
the primary distributes connections. It was the classic answer to "how do you use all
the cores?". On Kubernetes, ECS or a PaaS, the platform already runs several replicas,
restarts crashed ones and balances traffic, so the usual setup is one Node process per
container and more replicas. That keeps memory limits, health checks and metrics
simple. `cluster` (or PM2, which uses it) still makes sense on a single VM.

## Workers and the libuv pool are different things

Node's own asynchronous file system, DNS lookup, zlib and crypto work runs on
libuv's thread pool, four threads by default (`UV_THREADPOOL_SIZE`). That pool is
invisible to your code and does not run JavaScript. `worker_threads` are threads you
create to run your JavaScript. Raising `UV_THREADPOOL_SIZE` helps when many
`fs` or `dns.lookup` calls queue up; it does nothing for a slow JavaScript loop.

## When not to do any of this

- If the work can wait, put it on a queue and run it in a separate worker process
  (see [background jobs and queues](background-jobs-and-queues.md)). That survives
  restarts and scales independently.
- If a library has a native implementation (sharp for images, the database for
  aggregation), use it; the heavy lifting then happens outside JavaScript anyway.
- If the JSON is huge, stream-parse it rather than parse it in a worker.

## What you should be able to answer

- An endpoint does heavy computation and every other endpoint slows down. Why, and what are your options?
- What are the differences between `worker_threads`, `child_process` and `cluster`?
- Why use a worker pool instead of `new Worker()` per request?
- Why is `exec` with a string built from user input dangerous, and what do you use instead?
- What is the libuv thread pool, and how is it different from worker threads?
- Why do most containerised Node services not use `cluster`?
