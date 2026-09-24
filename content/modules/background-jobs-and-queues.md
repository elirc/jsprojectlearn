# Background jobs, queues and the email you promised to send

Every CRUD app sends email, builds reports and runs something at night. The
mid-level interview question is some version of "the order commits, then the
confirmation email fails. What happens?" A good answer names at-least-once
delivery, idempotent consumers and the transactional outbox. This guide gets
you there.

## What must not happen inside a request

Keep work out of the request when it is:

- **slow:** PDF generation, image resizing, a report over a year of data
- **flaky:** a third-party API that times out once in a thousand calls
- **retryable:** anything you would want to try again in five minutes

The request records the intent and returns. For long work, return **202
Accepted** with a status URL (see [REST API design](rest-api-design.md)). The
user gets a fast response, and a failure in the email provider no longer turns
into a failed checkout.

## In-process queues and what you lose on restart

The simplest queue lives in memory. In .NET that is a `Channel<T>` read by a
`BackgroundService`:

```cs
builder.Services.AddSingleton(Channel.CreateBounded<int>(1_000)); // bounded: backpressure, not OOM
builder.Services.AddHostedService<EmailWorker>();

public class EmailWorker(Channel<int> queue, IServiceScopeFactory scopes) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        await foreach (var orderId in queue.Reader.ReadAllAsync(ct))
        {
            await using var scope = scopes.CreateAsyncScope();   // a fresh DbContext per job
            var sender = scope.ServiceProvider.GetRequiredService<OrderEmails>();
            await sender.SendConfirmationAsync(orderId, ct);
        }
    }
}
```

[csharp/32](../../csharp/32-background-work-queue/) builds this, and the [DI
guide](dependency-injection-explained.md) explains the scope. In Node the
equivalent is an array and a loop, or a library like `p-queue`.

It's fast and needs no infrastructure, and it has three problems: a deploy or
crash **loses everything in the channel**, there are no retries unless you write
them, and with three replicas you have three unrelated queues. Use it for work
you can afford to lose, like warming a cache. For an email a customer is owed,
you need a durable queue.

## Durable queues

A durable queue stores jobs outside your process, so they survive restarts, and
it gives you retries, scheduling and a dashboard.

**Hangfire** is the common .NET choice. It stores jobs in your existing SQL
Server (Postgres via a community package), so there is no new infrastructure:

```cs
BackgroundJob.Enqueue<OrderEmails>(e => e.SendConfirmationAsync(orderId, CancellationToken.None));
RecurringJob.AddOrUpdate<Reports>("nightly-sales", r => r.BuildDailyAsync(), Cron.Daily(2));
```

Failed jobs retry automatically (10 attempts by default, with growing delays,
configurable via `[AutomaticRetry]`). Hangfire.Core is LGPL, so it's free for
commercial use; Pro features are paid.

**pg-boss** is the Node equivalent on Postgres:

```js
const boss = new PgBoss(process.env.DATABASE_URL);
await boss.start();
await boss.createQueue('order-email');

await boss.send('order-email', { orderId }, {
  retryLimit: 5, retryBackoff: true,
  singletonKey: `order-email:${orderId}`,   // deduplicate on this key
});

await boss.work('order-email', async ([job]) => {
  await sendOrderConfirmation(job.data.orderId);
}); // throw and the job is retried; return and it's complete
```

Using the database you already have is a strong default. Reach for a broker
when you need high throughput, fan-out to several services, or cross-language
consumers:

| Option | Model | Notes |
|---|---|---|
| BullMQ | Redis-backed job queue (Node) | Fast, popular; Redis must be configured for persistence |
| RabbitMQ | Broker with exchanges and queues | Flexible routing; you run it or buy it |
| Amazon SQS | Managed queue | Visibility timeout, redrive to a DLQ; FIFO queues for ordering |
| Azure Service Bus | Managed broker | Peek-lock, dead-letter after max delivery count, sessions |
| Kafka | Distributed **log**, not a queue | Consumers track offsets; messages stay after reading; replayable |

In .NET, MassTransit is the usual abstraction over brokers; note that v9 moved
to a commercial licence, while v8 stays open source.

## Delivery semantics and idempotent consumers

- **At-most-once:** delete, then process. A crash loses the message.
- **At-least-once:** process, then acknowledge. A crash after processing but
  before the ack means the message is delivered **again**.
- **Exactly-once:** not achievable end to end across a network. Brokers that
  advertise it mean deduplication within a window, or exactly-once *within
  their own system*.

Every real queue is at-least-once, so every consumer must be **idempotent**:
processing the same message twice has the same effect as once. The usual tool
is a record of what you've done:

```sql
INSERT INTO sent_emails (order_id, kind) VALUES ($1, 'confirmation')
ON CONFLICT DO NOTHING
RETURNING order_id;   -- no row back: already sent, skip
```

Run that insert and the send in one transaction that commits only after the
provider accepts, so a failed send leaves no row and the retry tries again. A
crash between "accepted" and "commit" can still send twice, which is why a
provider-side idempotency key beats your own table when one is offered.

## Retries, poison messages and dead letters

Retry with **exponential backoff and jitter** (1s, 2s, 4s, ... plus a random
offset) so a recovering provider isn't hit by every retry at the same instant.
Separate transient errors (timeout, 503) from permanent ones (invalid address,
400): retrying a permanent error just wastes attempts.

A **poison message** fails every time. After N attempts it moves to a
**dead-letter queue**, where it stops blocking others and waits for a human.
Alert on DLQ growth; a DLQ nobody looks at is a bin.

Brokers like SQS use a **visibility timeout**: a received message is hidden for,
say, 30 seconds. If the consumer doesn't delete it in time, it reappears for
another consumer. Set the timeout longer than your slowest job, or two workers
will process the same message.

## The dual-write problem and the transactional outbox

```js
await db.orders.insert(order);            // 1. commit
await queue.send('order-email', { id });  // 2. crash here and the email never exists
```

Swapping the order doesn't help: send first and a failed commit means an email
for an order that doesn't exist. Two systems, no shared transaction.

The **transactional outbox** fixes it by writing the message into the same
database, in the same transaction, as the business data:

```sql
BEGIN;
INSERT INTO orders (...) VALUES (...);
INSERT INTO outbox (id, type, payload) VALUES (gen_random_uuid(), 'order-email', '{"orderId": 42}');
COMMIT;
```

A relay process polls the outbox, publishes each row to the queue or runs the
job, and marks it done. Several relays can share the work with
`SELECT ... FOR UPDATE SKIP LOCKED`. Either both rows commit or neither does,
so the email can't be lost. The relay can publish twice (crash before marking
done), which is why the consumer must be idempotent: the outbox and idempotent
consumers are a pair.

A Postgres-backed queue gives you this almost for free: pg-boss can enqueue
using your own transaction's connection, and Hangfire on the same SQL Server
can enlist in a `TransactionScope`.

## Scheduled work with several replicas

Put `node-cron` or a timer-based `BackgroundService` in an app with three
replicas and "the nightly job ran three times". Options, best first:

1. Let the job system schedule it. Hangfire recurring jobs and pg-boss
   `schedule()` use the database to make sure one instance runs each occurrence.
2. Run it outside the app: a Kubernetes `CronJob` or a cloud scheduler that
   calls an endpoint or starts a container.
3. Take a distributed lock first: `SELECT pg_try_advisory_lock(42)` returns
   true on one instance only.

Make the job idempotent anyway ("build the report for 2026-09-22", not
"build today's report"), so a rerun after a failure is safe.

## Worked example: the order-confirmation email

1. Checkout commits the order and an outbox row in one transaction, and returns 201.
2. The relay enqueues `order-email {orderId}`.
3. The worker loads the order, renders a template (versioned in the repo, not
   typed into a provider dashboard), and calls the provider's API with a
   timeout.
4. Idempotency: it sends the provider an idempotency key derived from the
   order id if the provider supports one, and otherwise uses the `sent_emails`
   check above.
5. Transient failure: throw, the queue retries with backoff. Permanent failure:
   log, mark the order, don't retry.
6. The provider's **bounce and complaint webhooks** mark the address as
   undeliverable, so you stop sending to it and protect your sender reputation.

## Observability for jobs

A queue fails silently: nothing errors, things just stop happening. Watch:

| Metric | Why |
|---|---|
| Queue depth | Growing steadily means consumers can't keep up |
| Age of the oldest message | The best single alert: "an email is 20 minutes late" |
| Failure and retry rate | A provider outage shows here first |
| Dead-letter count | Every entry is a customer who didn't get something |

Log the job id and a correlation id from the original request with every
attempt, so one support ticket can be traced from checkout to the provider's
response. The [observability guide](logging-and-observability.md) covers the
tooling.

## What you should be able to answer

- How do you guarantee the confirmation email is sent if the app crashes right after the order commits?
- What is an idempotent consumer, and why does at-least-once delivery require one?
- What happens to a message that fails five times?
- How do you stop a scheduled job running on every replica?
- What do you lose with a `Channel<T>` or in-memory queue, and when is that acceptable?
- Why is Kafka described as a log rather than a queue?
