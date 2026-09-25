# Scaling a monolith before you split it

"Traffic has grown ten times. What do you do?" The weak answer is "move to microservices". The strong answer measures, then works through a sequence of cheap, reversible moves that take a single well-built application a very long way. [System design for CRUD](system-design-for-crud.md) lists that sequence in one paragraph; this guide explains each step, the traps in it, and how to tell when splitting really is the answer.

## Find the bottleneck before touching anything

Scaling the wrong tier costs money and changes nothing. Before proposing a fix, say what you would look at:

| Symptom | Likely constraint | First check |
| --- | --- | --- |
| App CPU near 100%, database relaxed | App tier compute | Profile hot endpoints; serialisation and logging are frequent culprits |
| App CPU low, requests slow, many waiting | Database or a downstream call | Slow-query log, `pg_stat_statements`, trace spans |
| Errors like "timeout acquiring connection" | Connection pool exhausted | Pool size vs database `max_connections`; long transactions |
| Latency spikes every few minutes | GC pauses, cron jobs, cache expiry stampedes | Runtime metrics, scheduled job logs |

Distributed tracing (OpenTelemetry, covered in [logging and OpenTelemetry in .NET](dotnet-logging-opentelemetry.md)) turns "the API is slow" into "this endpoint spends 900 ms in one SQL query", which is the sentence you want to be able to say.

## Step 1: make the database do less work

Most real scaling incidents end here. In order:

- **Fix the worst queries.** Take the top five by total time from `pg_stat_statements` or SQL Server's Query Store, read the plans, add the missing composite index, rewrite the N+1 into a join or a batched `IN` query. See [EF Core query performance](ef-core-query-performance.md) for the ORM side.
- **Stop fetching what you do not show.** Project to DTOs with only the columns needed, and paginate every list (keyset pagination for deep pages).
- **Shorten transactions.** A transaction that calls a payment API while holding row locks turns a slow third party into a database problem.

Scaling up the database server (more CPU and RAM) is also legitimate and underrated: it is one configuration change, needs no code, and buys months. Say that out loud; interviewers like pragmatism.

## Step 2: cache what tolerates staleness

Cache reads that are hot and can be a little old: product listings, reference data, rendered pages for anonymous users. Put static assets and user uploads behind a CDN, which removes a large share of requests from your servers entirely. In ASP.NET Core, output caching and `HybridCache` cover most needs ([caching in .NET](dotnet-caching.md)); the general rules on keys and invalidation are in [caching strategies](caching-strategies.md). Do not cache your way around a query that is slow because of a missing index; fix the index.

## Step 3: run several app instances

Horizontal scaling means N identical, stateless instances behind a load balancer. The work is in making them stateless, and every item here is a real bug teams hit on their first scale-out:

| State that hides in a process | What breaks with two instances | Fix |
| --- | --- | --- |
| In-memory sessions | Users are logged out when they hit the other instance | Cookie-based auth or a shared session store (Redis) |
| Uploaded files on local disk | File exists on one instance only | Object storage (see [file uploads](file-uploads-object-storage.md)) |
| In-memory cache | Instances disagree; invalidation reaches one | Short TTLs, or a distributed/hybrid cache |
| ASP.NET Core Data Protection keys | Auth cookies and antiforgery tokens fail on the other instance | Persist keys to a shared store (database, blob storage) |
| Scheduled jobs in the web process | The nightly job runs N times | A distributed lock, or a separate single worker |
| WebSocket or SignalR connections | Messages only reach clients on the same instance | A backplane (Redis) or a managed service |

Sticky sessions (pinning a user to one instance) hide the first problem but make deploys and failures uneven; treat them as a stop-gap, not a design.

## Step 4: connection pools and the database's limits

More app instances means more database connections. Each Npgsql or `pg` pool defaults to around 100 connections; ten instances can ask Postgres for a thousand, and Postgres handles that badly because each connection is a process. Size pools deliberately (instances × pool size must stay below `max_connections` with headroom), and put **PgBouncer** in transaction-pooling mode in front of Postgres when you have many instances. SQL Server copes with more connections, but the same arithmetic applies.

## Step 5: read replicas

Replicas take read traffic off the primary: reports, search pages, API reads. The cost is **replication lag**, usually milliseconds but sometimes seconds under load. The classic bug is a user saving their profile, being redirected, and seeing the old version because the read hit a replica. Mitigations:

- Route a user's reads to the primary for a short window after they write.
- Always read "my own data" pages from the primary; send lists and reports to replicas.
- Never send reads inside a write transaction to a replica.

In EF Core that usually means two `DbContext` registrations (or two connection strings) and choosing per query. Be explicit about which endpoints tolerate lag.

## Step 6: move slow work out of the request

Anything slow, spiky or retryable (email, PDFs, image processing, webhooks to partners) goes onto a durable queue and a worker process, so requests return quickly and traffic spikes turn into a backlog rather than timeouts. The worker is the same codebase deployed as a different process, which keeps the monolith's simplicity. [Background jobs and queues](background-jobs-and-queues.md) covers the mechanics.

## The modular monolith

Performance is rarely why teams split a system; team structure is. When many developers trip over each other in one codebase, the first move is to draw boundaries **inside** it: modules (orders, catalogue, billing) that own their tables, expose a small public interface, and do not reach into each other's internals. Enforce it with project references in .NET or lint rules for imports in TypeScript. This gives most of the organisational benefit of services with none of the network, and it makes a later extraction a cut along an existing line. [Structuring an application](application-architecture.md) covers the shapes.

## When splitting out a service is justified

Extract a service when you can name the reason, and it is one of these:

- **Different scaling profile:** image processing needs GPUs or bursts to fifty workers while the API needs two instances.
- **Different release cadence or ownership:** a separate team deploys it daily and is blocked by the monolith's release.
- **Isolation of failure or risk:** payment code under PCI scope that you want away from everything else.
- **Different technology** that genuinely fits better (a Python ML model beside a .NET API).

And name the cost: network calls that can fail, data that is no longer in one transaction, distributed tracing, versioned contracts, and another thing to deploy and page someone about. "We will split out the reporting module when its queries start hurting the primary, and move it to a replica first" is the kind of staged answer that scores well.

## What you should be able to answer

- Traffic has grown ten times and the site is slow. What do you measure before changing anything?
- What must change in an application before you can run two instances behind a load balancer?
- Why can adding app instances make a database fall over, and what does PgBouncer do about it?
- A user saves a change and the next page shows the old value. What is happening, and how do you fix it?
- What is a modular monolith, and why is it often a better next step than microservices?
- Give two good reasons, and one bad one, for splitting a service out of a monolith.
