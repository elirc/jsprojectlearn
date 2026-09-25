# Designing a booking system end to end

"Design a system for booking meeting rooms" (or appointments, or hotel rooms, or gym classes) is the most common mid-level design question, because it looks like plain CRUD and hides one hard problem: two people must never get the same slot. This guide works through it from requirements to API, and the same shape covers checkout, ticketing and anything else with limited stock.

## Pin down the requirements first

Spend the first five minutes asking questions, not drawing boxes. The answers change the design.

| Question | Why it matters |
| --- | --- |
| Fixed slots (09:00, 09:30) or arbitrary ranges (14:10 to 15:25)? | Fixed slots can use a plain unique constraint; ranges need overlap checks. |
| Is payment taken at booking time? | If so, you need a *hold* while the customer pays. |
| How many resources and bookings per day? | 50 rooms and 2,000 bookings a day is one Postgres instance with room to spare. |
| Can bookings be changed or cancelled, and up to when? | Drives the state machine and the cancellation rules. |
| Whose time zone is a booking in? | The resource's, almost always (see below). |

State the non-functional requirements out loud too: availability search should feel instant (say p95 under 300 ms), and double bookings must be impossible, not just unlikely. That second sentence is what the interviewer is waiting for.

## The data model

Keep it boring. Four tables carry most booking systems:

```sql
CREATE TABLE resource (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name      text NOT NULL,
  time_zone text NOT NULL          -- IANA name, e.g. 'Europe/London'
);

CREATE TABLE booking (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resource_id     bigint NOT NULL REFERENCES resource(id),
  customer_id     bigint NOT NULL REFERENCES customer(id),
  during          tstzrange NOT NULL,
  status          text NOT NULL CHECK (status IN ('held','confirmed','cancelled','expired')),
  hold_expires_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

Add `customer` and, if resources have opening hours, an `opening_hours` table keyed by resource and weekday. Store instants as `timestamptz` (UTC under the hood) and store the resource's IANA time zone so you can render local times. Do not store "local time without zone" for events that must be compared across resources.

## Stopping double bookings

This is the question behind the question. Walk through the options in order of strength:

| Approach | Safe under concurrency? | Notes |
| --- | --- | --- |
| `SELECT` for overlaps, then `INSERT` if none | No | Two requests both see "free", both insert. Classic check-then-act race. |
| Unique index on `(resource_id, slot_start)` | Yes, for fixed slots | Simple, works on every database, including SQL Server. |
| Lock the resource row (`SELECT ... FOR UPDATE`) then check | Yes | Serialises bookings per resource; fine at modest volume. |
| Exclusion constraint on the time range | Yes, for any ranges | Postgres only; the database rejects overlaps itself. |

The strongest answer on Postgres is the exclusion constraint, because it cannot be bypassed by a code path someone forgets to lock:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE booking ADD CONSTRAINT booking_no_overlap
  EXCLUDE USING gist (resource_id WITH =, during WITH &&)
  WHERE (status IN ('held', 'confirmed'));
```

A conflicting insert fails with SQLSTATE `23P01` (`exclusion_violation`), which your API maps to `409 Conflict` with a problem details body. On SQL Server, which has no exclusion constraints, use fixed slots with a unique index, or take an `UPDLOCK, HOLDLOCK` on the resource row inside the transaction before checking.

The point to make in the interview: **the database enforces the invariant; application code only translates the error.** Checking in C# or TypeScript first is fine for a friendly message, but it is never the guarantee.

## Holds, payment and the booking state machine

If payment happens at booking time, the slot must be reserved while the customer types their card number, or two people can pay for the same room. That is a *hold*:

```text
held ──(payment succeeds)──> confirmed ──(customer cancels)──> cancelled
  │
  └──(hold_expires_at passes)──> expired
```

- `POST /bookings` inserts a `held` row with `hold_expires_at = now() + interval '10 minutes'`. The exclusion constraint already covers held rows, so the slot is protected.
- The payment provider's webhook confirms it. Handle it idempotently: a unique constraint on the provider's event id, and an `UPDATE ... WHERE status = 'held'` that does nothing on a second delivery. [Calling other people's APIs](third-party-integrations.md) covers webhook verification.
- Expired holds must stop blocking the slot. A predicate in a partial constraint cannot use `now()`, so either run a sweeper job every minute that marks them `expired` (see [background jobs](background-jobs-and-queues.md)) or expire stale holds for that resource inside the booking transaction, just before the insert. Most teams do both.

Checkout for an online shop is the same pattern with a quantity instead of a time range: reserve stock with an expiring hold, confirm on payment, release on expiry. The constraint becomes `CHECK (stock_available >= 0)` on a decrement, rather than an overlap rule.

## Idempotent booking requests

Mobile networks retry. If the client sends `POST /bookings` twice because the first response was lost, the second attempt collides with the customer's own hold and they see a confusing "slot taken". Accept an `Idempotency-Key` header, store it with the booking under a unique constraint, and return the original response when the same key arrives again. This is the same mechanism Stripe uses, and interviewers like hearing that you know why it exists.

## Time zones

A booking happens *somewhere*. Show a room's 09:00 slot in the room's time zone and label it, even if the viewer's laptop is set to New York. Convert with the IANA name you stored, never a fixed offset, because offsets change with daylight saving: "Europe/London" is UTC+0 in January and UTC+1 in July. Recurring bookings ("every Monday at 09:00") must be expanded in local time and then converted, or they drift by an hour twice a year.

## The API

```http
GET  /resources/42/availability?date=2026-10-05
POST /bookings                     Idempotency-Key: 5c1f...
     { "resourceId": 42, "start": "2026-10-05T09:00:00+01:00", "end": "2026-10-05T10:00:00+01:00" }
     -> 201 Created | 409 Conflict (slot taken) | 422 (outside opening hours)
POST /bookings/981/cancel          -> 200 | 409 (too late to cancel)
```

Cancel is a POST to an action, not a `DELETE`, because the booking row stays (with status `cancelled`) for history, refunds and audit. See [REST API design](rest-api-design.md) for status-code choices.

## Availability search

Availability is "opening hours minus active bookings" for a date. Compute it with one query per resource per day rather than one per slot, and index `booking (resource_id, lower(during))`. It is read far more than bookings are written, so it is the natural thing to cache, with a short TTL (30 seconds) or eviction when a booking for that resource changes. The cache may briefly show a slot as free that has just gone; that is acceptable, because the constraint catches it on submit and the UI shows "just taken, pick another". Say this explicitly: **stale reads are fine when writes are protected.** [Caching strategies](caching-strategies.md) goes deeper.

## What changes at scale, and what does not

At a few thousand bookings a day, one API tier and one Postgres primary handle everything, and you should say so. The first things to add as traffic grows are read replicas or a cache for availability, and a queue for confirmation emails and calendar invites. Partitioning bookings by resource or date only comes up at real volume. What never changes is the invariant living in the database. For a full 45-minute interview structure, see [system design for CRUD](system-design-for-crud.md); to practise the schema side, [the SQLite orders project](../../86-sqlite-orders/) and [the kanban capstone API](../../csharp/28-capstone-kanban-api/) are good places to add a booking table.

## What you should be able to answer

- Two users click "book" on the same slot at the same moment. What stops both succeeding, and where does that check live?
- Why is "select, then insert if free" unsafe, and what would you use instead on Postgres and on SQL Server?
- How do you reserve a slot while the customer pays, and how do abandoned holds release it?
- A client retries `POST /bookings` after a timeout. How do you avoid a duplicate or a false "slot taken"?
- Which time zone do you display a booking in, and why must recurring bookings be expanded in local time?
- Where would you cache in this design, and why is a slightly stale availability view acceptable?
