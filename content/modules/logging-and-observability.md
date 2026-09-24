# Logs, metrics and traces

"It works on my machine" is where a junior stops. Where a mid-level developer
starts is: what do the logs say, what changed, and how many users are affected.
Observability is what makes those questions answerable.

## The three signals

| Signal | Answers | Shape |
|--------|---------|-------|
| **Logs** | What happened in this specific case? | Discrete events, high detail |
| **Metrics** | How is the system behaving overall? | Numbers over time, aggregatable, cheap |
| **Traces** | Where did this request spend its time? | One request's path across services |

Logs tell you about *one* thing. Metrics tell you about *all* things. Traces
connect the two.

## Structured logging

Log objects, not sentences:

```js
// Unqueryable
console.log(`User ${id} failed to update order ${orderId}: ${err.message}`);

// Queryable
logger.warn({
  event: 'order.update.failed',
  userId: id,
  orderId,
  reason: err.code,
  requestId: ctx.requestId,
}, 'Order update failed');
```

The second one lets you ask "how many order.update.failed events for this
customer in the last hour, grouped by reason". The first one requires a regex
and hope.

In .NET the same rule is a classic interview question. `ILogger` takes a
**message template**, and each placeholder becomes a named, queryable property:

```csharp
logger.LogInformation("Order {OrderId} shipped to {CustomerId}", orderId, customerId);  // structured
logger.LogInformation($"Order {orderId} shipped to {customerId}");                      // a flat string
```

Interpolating throws the structure away and formats the string even when the
level is disabled. The usual tools: **pino** in Node, **Serilog** (or the
built-in JSON console logger) in .NET, and **OpenTelemetry** in both, whose
auto-instrumentation adds traces and metrics for HTTP, database and outgoing
calls without hand-written code.

**Write to stdout.** The container runtime, systemd or the platform collects it.
An application managing its own log files and rotation is solving a problem it
does not have.

## Levels, and what belongs at each

- **ERROR** — something failed that needs a human. An unhandled exception, a
  failed payment write. If ERROR fires routinely, it is not an error.
- **WARN** — recovered, or approaching a limit. A retry succeeded; a queue is at
  80%.
- **INFO** — significant business events. Request completed, order placed, user
  registered. This is your default production level.
- **DEBUG** — developer detail. Off in production, or sampled.

The test for ERROR: **would you want to be woken up for this?** A user typing a
bad email address is not an error — it is a 400 and an INFO line at most.
Logging expected failures at ERROR is how alerting gets ignored.

## Correlation ids

The single highest-value thing on this page.

Generate an id at the edge of every request, put it in the logging context so
every line carries it automatically, propagate it to downstream services in a
header, and return it to the client on errors.

```
2026-03-09T10:22:41Z INFO  req=8f3a2b user=42 GET /api/orders 200 34ms
2026-03-09T10:22:41Z DEBUG req=8f3a2b query took 12ms rows=20
2026-03-09T10:22:42Z ERROR req=8f3a2b payment gateway timeout after 5000ms
```

Without it, you cannot reconstruct one request's path through interleaved
concurrent traffic. With it, a user quoting "error 8f3a2b" gets you to the exact
lines in seconds.

## What you must never log

- Passwords, even hashed
- Tokens, session ids, API keys
- Card numbers, bank details
- Personal data beyond what you need — and check what your jurisdiction says
- **Whole request bodies**, which quietly contain all of the above

Redact centrally, at the logging layer, with a list of sensitive keys. Doing it
at each call site means forgetting one, and logs are usually retained longer and
accessed more widely than the database.

## Metrics worth having

Two standard framings:

**RED**, for services: **R**ate (requests/sec), **E**rrors (rate of failures),
**D**uration (latency distribution).

**USE**, for resources: **U**tilisation, **S**aturation, **E**rrors.

Track latency as **percentiles, never averages**. An average of 200ms hides that
5% of users wait four seconds. p50, p95 and p99 tell the real story — and p99 is
often your most valuable customer, because they have the most data.

Also worth counting: queue depth, connection pool usage, cache hit rate, and a
couple of business numbers (orders per minute) — a drop in those is often the
first sign of a problem no technical metric caught.

## Traces

In a system with more than one service, a trace shows one request's journey:
which service, which database call, how long each took, where it waited.

The mechanics: a trace id and span ids propagate in headers
(**OpenTelemetry** is the vendor-neutral standard). Each service records spans
against the same trace.

For a single monolith, good logging plus timing metrics usually gets you there.
Once you have three services calling each other, tracing stops being optional.

## Health checks

Two, not one:

- **Liveness** — is this process wedged? Should the orchestrator kill it? Keep
  it trivial; do not check dependencies here, or a database blip restarts every
  instance at once.
- **Readiness** — can it serve traffic right now? Dependencies reachable,
  warm-up done. Failing readiness takes an instance out of the load balancer
  without killing it.

## Alerting

**Alert on symptoms, not causes.** "Error rate above 2% for five minutes" is
actionable. "CPU above 80%" is often fine and will train people to ignore
alerts.

Every alert should have: a clear meaning, an obvious first action, and a real
consequence if ignored. An alert nobody acts on should be deleted — alert
fatigue is how the real one gets missed.

**SLIs, SLOs and error budgets** give "symptoms" a number. An **SLI** is a
measurement of what users experience: the share of requests that succeed in
under 500 ms, say. An **SLO** is the target for it: 99.9% over 30 days. The
**error budget** is what is left: 0.1%, about 43 minutes of failure a month.
Alert when the budget is burning fast, not on every blip; and when it is spent,
the team slows feature work and fixes reliability. 100% is never the target,
because every nine costs more than the last.

## Errors specifically

An error tracker (Sentry and similar) does what raw logs cannot: groups
identical exceptions, shows frequency and first/last seen, attaches release
version and user context, and de-duplicates.

Upload source maps so production stack traces are readable, and tag every event
with the release so "this started three deploys ago" is one click.

## What to instrument first

If you have nothing, add in this order:

1. Structured request logging with a correlation id
2. An error tracker
3. Request rate, error rate, and latency percentiles per endpoint
4. A readiness endpoint your platform actually uses
5. Two or three business metrics
6. Tracing, once there is more than one service

## The interview answers

**"How would you debug a bug that only happens in production?"**

> Find it in the logs by correlation id or user. Look at what is different about
> the failing cases — a tenant, a data shape, a time of day. Check whether it
> started with a deploy. If the logs cannot answer it, that is the actual
> finding: add the instrumentation, ship it, and wait for the next occurrence
> rather than guessing.

**"What would you log for a failed payment?"**

> Event name, correlation id, user and order ids, the gateway's error code,
> the attempt number, the duration. Not the card details, not the full request
> body, not the gateway credentials.
