# Graceful shutdown in Node

Every deploy, scale-down and node drain stops your process. If it stops badly,
users see 502s on every release, jobs are half done and database connections
linger. "What happens to in-flight requests when you deploy?" is a favourite
mid-level question because the answer shows whether you have operated a service or
only written one. The short version is in [the Node runtime
guide](node-runtime-and-npm.md); this is the full picture.

## What the platform does

Kubernetes, ECS, Fly, Render and systemd all follow the same pattern:

1. Decide to stop the instance (a new version is ready, or scaling in).
2. Stop routing new traffic to it. This is **asynchronous**: load balancers and
   kube-proxy take a few seconds to notice.
3. Send **SIGTERM** to the process.
4. Wait a **grace period** (Kubernetes: `terminationGracePeriodSeconds`, 30 s by
   default).
5. Send **SIGKILL**, which cannot be caught.

Your job is to use the time between 3 and 5 well: finish what you started, accept
nothing new, release resources, and exit before the kill.

## Receiving the signal at all

Node only runs your SIGTERM handler if Node actually receives the signal.

- If Node is PID 1 in a container with no handler, SIGTERM is ignored (PID 1 gets no
  default signal behaviour), so the platform waits the full grace period and kills
  it. Always install a handler, or run under `tini` / `docker run --init`.
- `CMD npm start` puts npm in front of Node. Signal forwarding through npm and
  shell wrappers has been unreliable across versions; use `CMD ["node", "server.js"]`
  in exec form so Node is the process that gets the signal.
- Locally, Ctrl+C sends SIGINT; handle both.

## The sequence

```js
import http from 'node:http';

let shuttingDown = false;

app.get('/health/ready', (req, res) => res.sendStatus(shuttingDown ? 503 : 200));
app.get('/health/live', (req, res) => res.sendStatus(200));

const server = app.listen(config.port);

async function shutdown(signal) {
  if (shuttingDown) return;                     // second Ctrl+C or signal
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');

  // Watchdog: if anything below hangs, exit before SIGKILL does it for us
  setTimeout(() => {
    logger.error('shutdown timed out');
    process.exit(1);
  }, 25_000).unref();

  await sleep(5_000);                           // let load balancers stop sending traffic

  await new Promise((resolve, reject) =>        // stop accepting, drain in-flight requests
    server.close((err) => (err ? reject(err) : resolve())),
  );
  await worker.stop();                          // stop taking jobs, finish the current one
  await db.end();                               // or prisma.$disconnect()
  await redis.quit();
  logger.flush?.();
  process.exitCode = 0;                         // let the event loop empty naturally
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
```

The order is the whole point:

| Step | Why here |
|---|---|
| Fail readiness | Tells the load balancer to stop sending you traffic |
| Short delay | Routing updates are not instant; requests still arrive for a few seconds |
| `server.close()` | Stops accepting, waits for in-flight requests to finish |
| Stop background consumers | They may be mid-job; let them finish or hand the job back |
| Close pools and clients | Only after nothing needs them; closing first fails in-flight work |
| Flush logs and exit | Buffered log lines are otherwise lost |

Closing the database pool before the server has drained is the most common mistake:
the requests you were trying to protect fail anyway.

## What server.close() does and does not do

`server.close()` stops listening and calls back once every connection has ended.
Since Node 19 it also closes **idle keep-alive** connections immediately, which used
to be the main reason it never returned. It still waits for:

- requests that are still running (what you want),
- **WebSocket and SSE connections**, which never end on their own,
- slow clients mid-upload.

For long-lived connections, tell clients to go away: send WebSocket close frames with
code 1001 ("going away") so they reconnect to another instance, and end SSE streams,
whose `EventSource` clients reconnect automatically. After a grace period,
`server.closeAllConnections()` ends whatever remains. See [WebSockets and SSE in
Node](websockets-and-sse-in-node.md).

## Keep-alive and the load balancer

During the drain, once an in-flight response finishes, Node closes that now-idle
keep-alive socket. A client that races a new request onto the socket as it closes
gets a connection reset, which is one more reason for the delay before `close()`:
by then the balancer has stopped picking this instance. Separately,
set `server.keepAliveTimeout` above your load balancer's idle timeout (AWS ALB: 60 s),
or the balancer will occasionally reuse a socket Node has just closed and report a
502 even when nobody is shutting down.

## Background work

A queue consumer should stop fetching new jobs as soon as shutdown starts, finish the
job in hand if it can within the grace period, and otherwise let it go back to the
queue. That only works if jobs are **idempotent** and acknowledged after completion,
so a job that is interrupted and redelivered does no harm. Timers and `setInterval`
loops should check `shuttingDown` or be cleared. See [background jobs and
queues](background-jobs-and-queues.md) for delivery semantics.

## Crashes are shutdowns too

On an uncaught exception or unhandled rejection, the process state is unknown. Log,
attempt a short best-effort cleanup at most, and exit non-zero so the platform starts
a fresh instance:

```js
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'uncaught exception');
  process.exit(1);
});
```

Do not keep serving after an uncaught exception. Do make sure the platform restarts
the process and that you would notice a crash loop (see [logging and
observability](logging-and-observability.md)).

## Exiting cleanly

- `process.exit()` stops immediately, which can truncate log output still buffered
  for a pipe. Prefer setting `process.exitCode` and letting the loop empty, with the
  unref'd watchdog as the backstop.
- An `exit` event handler can only do synchronous work; timers and promises started
  there never run.
- If the process does not exit after cleanup, something is still holding the event
  loop: an open socket, an interval, a pool. `process.getActiveResourcesInfo()` lists
  what is keeping it alive.

## Testing it

Start the app, fire a slow request, send SIGTERM, and check the slow request still
gets its 200 and the process exits with code 0 within the grace period. Also check
that `/health/ready` returns 503 immediately after the signal. A deploy with zero
errors in the load balancer's logs is the real acceptance test; see [deployment and
hosting](deployment-and-hosting.md).

## A checklist

- SIGTERM and SIGINT handlers installed; Node is the process that receives them.
- Readiness fails first; a few seconds' delay before closing the listener.
- `server.close()`, then consumers, then pools and clients, then exit.
- Long-lived connections told to reconnect elsewhere.
- A watchdog shorter than the grace period, with `.unref()`.
- `keepAliveTimeout` above the load balancer's idle timeout.
- Jobs idempotent, so an interrupted job can safely run again.

## What you should be able to answer

- What happens to in-flight requests when Kubernetes replaces your pod, and what should your code do?
- In what order do you stop accepting traffic, drain, and close the database pool, and why?
- Why might `server.close()` never call its callback?
- Why can a Node process in a container ignore SIGTERM, and how do you fix it?
- What is the difference between readiness and liveness during shutdown?
- Why do some services see 502s from an AWS load balancer, and which Node setting fixes it?
