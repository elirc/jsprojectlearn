# System design, mid-level edition

The "design X" round at mid-level is not Netflix. It is a CRUD system with a
twist: a URL shortener, a booking system, a Twitter-lite. The interviewer wants
to see you ask before you draw, estimate before you scale, and name the one
place where two users can corrupt each other's data. This guide is the
structure and the handful of scaling moves that are actually expected.

## What the round tests, and what it does not

**Tested:** clarifying requirements, a sensible API, a data model with the
right keys and indexes, a read path and a write path you can walk through, and
the order in which you would scale. Above all, trade-offs said out loud.

**Not tested at this level:** sharding schemes, consensus algorithms, designing
your own database, or exact capacity maths. Reaching for Kafka and Kubernetes
in minute five is a red flag, not a strength.

## The structure

Say this order out loud at the start, then follow it:

1. **Requirements.** Functional (what users do) and non-functional (how many,
   how fast, how correct). Ask which matters more when they conflict:
   consistency or availability.
2. **Rough numbers.** Enough to know whether one database will do.
3. **API.** Five or six endpoints, in the style of the [REST
   guide](rest-api-design.md).
4. **Data model.** Tables, keys, and the indexes your queries need.
5. **Read and write paths.** Walk one request of each through the system.
6. **Scaling.** Only where the numbers say you must.
7. **Failure modes.** What happens when a dependency is slow, or two requests
   race.

## Back-of-envelope numbers

You need orders of magnitude, not arithmetic. Round a day to 100,000 seconds.

| Question | Example | Result |
|---|---|---|
| Requests per second | 1M daily users × 20 requests ÷ 100k s | ~200/s average; plan for ~5× at peak |
| Rows per day | 1M users × 1 post | 1M rows/day, ~365M a year |
| Storage per year | 365M rows × 1 KB | ~365 GB: one database, comfortably |
| Read/write ratio | Timelines are read far more than posted | Reads ≥ 100:1, so the read path gets the attention |

A useful anchor: a single well-indexed Postgres serves thousands of simple
queries per second and holds terabytes. Most systems in these rounds fit on one
primary database with room to spare, and saying so is the correct answer.

## Worked example: Twitter-lite

**Requirements:** post a short message, follow users, read a home timeline of
followed users' posts, newest first. Images optional.

**API:**

```
POST /posts                          { text }         -> 201
POST /users/{id}/follow                               -> 204
GET  /timeline?after=<cursor>&limit=20                -> 200 { data, page }
```

**Data model:**

```sql
CREATE TABLE posts (
  id BIGINT PRIMARY KEY, author_id BIGINT NOT NULL,
  text TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ix_posts_author ON posts (author_id, created_at DESC);
CREATE TABLE follows (
  follower_id BIGINT, followee_id BIGINT,
  PRIMARY KEY (follower_id, followee_id)
);
```

**The read path is the whole question.** There are two designs:

- **Fan-out on read.** Build the timeline when it is requested: posts whose
  `author_id` is in the user's follow list, newest first, limit 20. Simple,
  always fresh, and fine until users follow thousands of accounts.
- **Fan-out on write.** When someone posts, push the post id into each
  follower's precomputed timeline (a table, or a Redis list). Reads become one
  cheap lookup; writes become expensive for anyone with a million followers.

The mid-level answer: start with fan-out on read, keyset-paginated (see [the
pagination guide](api-pagination-filtering.md)). Move to fan-out on write when
reads dominate, and handle celebrity accounts on read, merged in. **Media**
never goes through your API: the client uploads straight to object storage
with a presigned URL, and a CDN serves it.

## Scaling a monolith, in order

When "the database is the bottleneck", these are the moves, cheapest first.
Naming them in this order earns most of the marks.

1. **Fix the queries.** Find the slow ones, `EXPLAIN` them, add the missing
   index, kill the N+1. This solves most real incidents.
2. **Cache** the hot, tolerant reads (see [caching](caching-strategies.md)),
   and put static assets and media on a CDN.
3. **Scale the app tier horizontally.** Several stateless instances behind a
   load balancer; sessions and files move out of the process.
4. **Read replicas** for read-heavy load. The cost is **replication lag**: a
   user saves a change, the next read hits a replica, and their change is
   missing. Fix read-your-writes by sending a user's reads to the primary for a
   few seconds after they write, or by always reading their own data from it.
5. **Queues** for slow or spiky work, so a request returns quickly and a worker
   catches up (see [background jobs](background-jobs-and-queues.md)).
6. Only then: partitioning, or splitting out a service.

## Correctness under concurrency

Every design question hides one race. Find it before the interviewer does.

- **Double booking.** Two users book the last slot at the same moment. The fix
  is a database constraint, not an `if`: a unique index on
  `(resource_id, slot_start)`, or a Postgres exclusion constraint for
  overlapping time ranges. The loser's insert fails, and you return 409.
- **Lost updates** on edits: an optimistic `version` column, 409 on mismatch.
- **Duplicate submissions and retries:** an idempotency key on the POST.
- **Counters** (stock, seats): `UPDATE items SET stock = stock - 1 WHERE id = $1
  AND stock > 0`, then check the affected row count. Never read, subtract and
  write back.

> "Two requests can both pass a check in application code. The database
> constraint is the only thing that serialises them, so that is where the rule
> lives."

## Multi-tenancy

If the system serves several customer organisations, say how their data is
separated: shared tables with a `tenant_id` on every row (cheapest, and the
usual answer), a schema per tenant, or a database per tenant (strongest
isolation, most operational work). Then say how the rule is enforced, so that
one forgotten `WHERE` cannot leak data: Postgres row-level security, or an EF
Core global query filter. The trade-offs are in [relational data
modelling](relational-data-modeling.md).

## Search, files and notifications

Treat these as bolt-ons, one sentence each, unless they are the question:

- **Search:** Postgres full-text search first; a search engine (OpenSearch,
  Meilisearch) only when relevance or scale demands it, fed from a queue.
- **Files:** object storage plus presigned URLs; the database stores the key.
- **Notifications and email:** a job on a queue after the transaction commits,
  never inside the request.

## What you would not build yet

Saying what you would defer sounds senior at any level:

- **Microservices.** One deployable until a team or scaling boundary forces a
  split (see [application architecture](application-architecture.md)).
- **Kafka.** A database-backed queue handles thousands of jobs per second.
- **Kubernetes.** A PaaS runs two instances and a managed database without it.
- **A cache before measuring.** It adds invalidation bugs to a system that may
  not need it.

## The 45-minute script

| Minutes | What you do |
|---|---|
| 0–5 | Clarify requirements; write the functional and non-functional lists |
| 5–8 | Rough numbers; conclude "one database is fine", or not |
| 8–15 | API endpoints, and the data model with indexes |
| 15–25 | Walk the read path and the write path |
| 25–35 | Scaling moves, in order, driven by your numbers |
| 35–42 | Failure modes: the race, a slow dependency, a lagging replica |
| 42–45 | What you deferred, and what you would build next |

Talk while you draw. Silence reads as being stuck, even when you are thinking.

## What you should be able to answer

- Design a URL shortener, a Twitter-lite, or an appointment booking system.
- How do you stop two users booking the same slot?
- The database is the bottleneck: what are your first three moves?
- What are the trade-offs of read replicas, and how do you handle
  read-your-writes?
- Fan-out on read or fan-out on write for a timeline, and why?
- How do you keep one tenant's data away from another's?
- What would you deliberately not build yet, and why?
