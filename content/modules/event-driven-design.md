# Queues and event-driven design

Once an application does more than answer requests (send an email, update a search index, tell the warehouse, charge a card), someone will propose "just put an event on a queue". Interviewers then ask what that event looks like, who listens, what happens if a listener is down, and how the user sees the result. This guide is about those design choices. The mechanics of running jobs, retries and dead letters are in [background jobs and queues](background-jobs-and-queues.md); read that first or alongside.

## Commands, events and why the difference matters

| | Command | Event |
| --- | --- | --- |
| Tense | Imperative: `SendInvoice` | Past: `OrderPlaced` |
| Receivers | Exactly one handler | Zero, one or many subscribers |
| Sender knows the receiver? | Yes | No |
| Can be refused? | Yes, it may fail validation | No, it already happened |
| Typical transport | A queue | A topic (pub/sub) |

A **command** asks one service to do something and expects it to be done. An **event** announces a fact and does not care who reacts. The distinction decides coupling: if the orders service publishes `OrderPlaced`, the email, loyalty and analytics features can subscribe without the orders code knowing they exist. If it sends `SendConfirmationEmail`, `AwardLoyaltyPoints` and `TrackPurchase`, it knows about all three and changes whenever they do.

Name events in the past tense after something meaningful in the business, not after a database change. `OrderPlaced` is useful to other teams; `OrderRowUpdated` is not.

## Queues and topics

- A **queue** delivers each message to one consumer out of a pool. Add workers to process faster; each message is handled once (at least once, strictly).
- A **topic** delivers a copy of each message to every subscription, and each subscription behaves like its own queue.

In RabbitMQ that is an exchange bound to several queues; in Azure Service Bus, a topic with subscriptions; in AWS, SNS fanning out to SQS queues; in Kafka, a topic read by several consumer groups. The shape is the same everywhere: publish once, and each interested service gets its own durable queue so a slow or broken subscriber does not affect the others.

## What goes in an event

Two styles, and interviewers like you to know both:

```json
{
  "type": "OrderPlaced",
  "id": "0f6c1c1e-5a0b-4d38-9d6c-3c3b8e0c9e11",
  "occurredAt": "2026-09-24T10:15:02Z",
  "version": 1,
  "data": { "orderId": "ord_812", "customerId": "cus_19", "total": 59.90, "currency": "GBP" }
}
```

- **Thin events** (just ids) force every subscriber to call back to the orders API for details, which couples them at runtime and adds load, and the data they fetch may already have changed.
- **Fat events** (the facts subscribers need) let them work without calling back, at the cost of a bigger contract to keep stable.

Most teams land in between: include what the known subscribers need for the fact itself, and always include a unique event `id` (for de-duplication), `occurredAt` and a `version`.

## Contracts and versioning

An event schema is a public API with consumers you may not know about. Treat changes the same way you treat REST changes:

- **Adding** an optional field is safe; consumers ignore what they do not read.
- **Renaming or removing** a field, or changing its meaning, is breaking. Publish a new version (`OrderPlaced` v2) alongside the old one until every consumer has moved, then retire v1.
- Write consumers as **tolerant readers**: read the fields you need and ignore the rest, so additions never break you.

For larger systems a schema registry or shared contract package (TypeScript types generated from JSON Schema, or a C# contracts project) catches breaking changes in CI.

## Consumers must be idempotent, and order is not guaranteed

Brokers deliver *at least once*. A consumer crashes after doing the work but before acknowledging, the message is redelivered, and the work happens twice. So every handler needs a guard:

```ts
async function onOrderPlaced(evt: OrderPlaced) {
  const inserted = await db.query(
    'INSERT INTO processed_event (consumer, event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    ['loyalty', evt.id],
  );
  if (inserted.rowCount === 0) return;         // already handled
  await awardPoints(evt.data.customerId, evt.data.total);
}
```

In production, run the insert and the work in one database transaction so they commit together.

Ordering is weaker than people assume. Most queues are roughly FIFO, but retries, several consumers and partitions mean `OrderCancelled` can be processed before `OrderPlaced`. Either design handlers that cope (store a version or timestamp and ignore older updates), or use a partition or session key (the order id) so events for the same entity go to one consumer in order. Do not promise global ordering; it removes your ability to scale consumers.

## Publishing reliably

The classic bug: save the order, then publish `OrderPlaced`, and the process dies in between. The order exists and nobody hears about it. Publishing first is worse: the event announces an order that then fails to save. The fix is the **transactional outbox**: write the event to an `outbox` table in the same transaction as the order, and let a relay publish from that table. It is covered step by step in [background jobs and queues](background-jobs-and-queues.md).

## Choreography, orchestration and sagas

When a business process spans several services (reserve stock, take payment, arrange shipping), there is no single database transaction to wrap it in. Two ways to coordinate:

| | Choreography | Orchestration |
| --- | --- | --- |
| How | Each service reacts to others' events | A coordinator sends commands and tracks state |
| Strength | Loose coupling, no central component | The whole flow is visible in one place |
| Weakness | Hard to see or change the overall flow | The coordinator knows about everyone |
| Good for | Two or three steps, independent reactions | Long flows with compensation and timeouts |

Either way, failures are handled with **compensating actions** rather than rollbacks: if shipping fails after payment succeeded, you issue a refund. That sequence of steps plus compensations is a **saga**. At mid-level, knowing the word and that compensation replaces rollback is usually enough.

## Eventual consistency in the UI

After `POST /orders` returns `202 Accepted`, the order history page may not show the order yet if it is built by a subscriber. Options, from simplest:

- Return the created resource from the command itself and render that, rather than re-reading a projection.
- Show a clear pending state ("Processing your order") and poll or push an update (see [the realtime projects](../../67-websocket-chat/)).
- Read your own writes from the primary store for the user who just wrote.

Say which you would choose. Interviewers are testing whether you notice that asynchrony is visible to users, not just to engineers.

## When not to use events

Events add a broker to run, messages to trace, and a class of bug (duplicates, reordering, lag) that a function call does not have. Inside one modular monolith, an in-process call or a domain event dispatched within the same transaction is often enough. Reach for a broker when the work is slow, must survive restarts, has several independent consumers, or crosses a service boundary. [The event-sourcing bank project](../../83-event-sourcing-bank/) is a good way to feel how events change your model, and [the worker queue project](../../csharp/32-background-work-queue/) shows the consumer side in .NET.

## What you should be able to answer

- What is the difference between a command and an event, and how does it change coupling between services?
- What is the difference between a queue and a topic, and why does each subscriber get its own queue?
- Would you put ids only or full details in an event? What are the trade-offs?
- A consumer processes the same `OrderPlaced` twice. What went wrong, and how do you make the handler safe?
- How do you publish an event and save the order without one happening without the other?
- The user places an order and the history page does not show it. Why, and what would you do?
