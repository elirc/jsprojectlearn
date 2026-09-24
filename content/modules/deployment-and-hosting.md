# Getting it onto the internet

A project that only runs on your laptop is half a portfolio piece. Deploying it
teaches you things no tutorial does, and "walk me through how your project is
deployed" is a normal interview question.

## The pieces of a deployed CRUD app

```
Browser
  -> DNS
  -> CDN / static host          (the React bundle)
  -> Load balancer / TLS
  -> API instances (N of them)  (Node or ASP.NET Core)
  -> Managed database
  -> Object storage, cache, queue
```

Two deployables — a static frontend and a stateful backend — with very different
needs. The frontend is files on a CDN. The backend is processes that must be
kept alive, scaled and connected to a database.

## Hosting options, honestly

| Option | Good for | Trade-off |
|--------|----------|-----------|
| **Static host + serverless** (Vercel, Netlify, Cloudflare) | SPAs, Next.js, low-traffic APIs | Cold starts; long-lived connections and background work are awkward |
| **PaaS** (Render, Railway, Fly.io, Azure App Service, Azure Container Apps) | A container with a managed database | Least operational work for a real backend; the sweet spot for most projects |
| **Container orchestration** (ECS, Kubernetes) | Multiple services, real scale | Substantial operational overhead |
| **A VM you manage** | Full control, cheap | You now own patching, TLS renewal, backups, monitoring |

For a portfolio project or a first product, **a PaaS with a managed Postgres** is
the right answer and saying so shows judgement rather than inexperience.

## Frontend deployment

A built SPA is static files. Two requirements beyond "upload them":

**1. SPA fallback routing.** `/orders/7` is a client-side route; the server has
no such file. Configure the host to serve `index.html` for any unmatched path,
or your app 404s on refresh and on any deep link.

**2. Cache headers that match the build.** Hashed assets get
`max-age=31536000, immutable`; `index.html` gets a short max-age or
`no-cache`. Otherwise users keep the old HTML, which references chunks the new
deploy deleted — a blank page and a "failed to load chunk" error.

## Backend deployment

**Run more than one instance.** Two is dramatically better than one: you survive
a crash, and you can deploy without downtime. It also forces you to be stateless,
which is the real benefit.

**Stateless means:** no in-memory sessions, no uploads on local disk, no
in-process scheduler assuming it is the only one. Sessions go to Redis or the
database, files go to object storage, and scheduled work needs a lock or a
single dedicated worker — otherwise your "nightly job" runs once per replica.

**Health endpoints** are how the platform knows what to do:

- **Liveness** — restart me if this fails. Keep it trivial and dependency-free.
- **Readiness** — send me traffic only when this passes.

Conflating them means a brief database blip restarts every instance at once.

**Graceful shutdown** on SIGTERM: stop accepting connections, finish in-flight
requests, close the pool, exit. Without it, every rolling deploy drops requests
and users see intermittent 502s.

**Trust the proxy's forwarded headers.** On every PaaS a load balancer
terminates TLS and forwards plain HTTP, so your app sees `http` and the proxy's
IP. Redirects go to `http://`, `Secure` cookies misbehave, and rate limiting
treats every user as one IP. The proxy sends the truth in `X-Forwarded-For` and
`X-Forwarded-Proto`; you have to opt in to reading it:

```csharp
// ASP.NET Core: first in the pipeline, or set ASPNETCORE_FORWARDEDHEADERS_ENABLED=true
builder.Services.Configure<ForwardedHeadersOptions>(o =>
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto);
app.UseForwardedHeaders();
```

```js
// Express: trust exactly one hop, the platform's load balancer
app.set('trust proxy', 1);
```

Trust only as many hops as you actually have: trusting everything lets any
client spoof its IP with a header.

## The database

**Use a managed one.** Backups, patching, failover and point-in-time recovery
are solved problems you should not re-solve.

Things to get right:

- **Connection pooling.** Managed Postgres has a connection limit (often ~100).
  Ten instances with a pool of 20 each is 200 connections and an outage. Size
  pools deliberately, and consider a pooler like PgBouncer.
- **Backups you have actually restored.** An untested backup is a hope.
- **Migrations run by the pipeline**, not by three replicas racing at startup.
- **Never expose it publicly.** Private network, or IP allowlist at minimum.

## TLS and domains

Certificates are free and automatic now — Let's Encrypt via your platform or
Caddy. There is no excuse for a project on plain HTTP.

Set `Strict-Transport-Security` once you are confident, and redirect HTTP to
HTTPS.

For DNS: understand `A` (to an IP), `CNAME` (to another name) and TTL. When you
change a record, the old value is cached for the TTL — lower it *before* a
planned migration.

## Zero-downtime deploys

The ingredients, all of which you already have if you followed the above:

1. More than one instance
2. Readiness probes, so a starting instance receives no traffic
3. Graceful shutdown, so a stopping instance finishes its work
4. **Backwards-compatible database changes**, because old and new run at once

The fourth is the one that catches people. During a rolling deploy both versions
are live, so a renamed column breaks whichever version has not caught up. Use
expand/contract: add nullable, backfill, dual-write, migrate reads, then drop —
across several releases.

## Rollback

**Fast, safe rollback is worth more than careful deploys**, because it converts a
crisis into an inconvenience.

Deploy by immutable image tag, keep the previous tag available, and make
rolling back a single command or button. Practise it once when nothing is wrong,
so you are not learning during an incident.

Note that a rollback does not undo a migration. That is another reason schema
changes must be compatible with the previous version.

## Cloud vocabulary

.NET jobs usually assume Azure, JS jobs often AWS. The services map closely
enough that one table covers the interview:

| Need | AWS | Azure |
|---|---|---|
| Run a container without managing servers | ECS on Fargate, App Runner | Container Apps, App Service |
| Functions (serverless) | Lambda | Azure Functions |
| Managed Postgres / SQL Server | RDS, Aurora | Azure Database for PostgreSQL, Azure SQL |
| Files and uploads | S3 | Blob Storage |
| Queue | SQS | Storage Queues, Service Bus |
| Secrets | Secrets Manager | Key Vault |
| Identity for your app | IAM roles | Managed identity (Entra ID) |
| CDN | CloudFront | Azure Front Door |

The idea that matters most is the last-but-one row: in the cloud your app
should get its permissions from an identity the platform gives it, not from a
key in an environment variable.

## Cost, briefly

Portfolio projects have a habit of generating surprise bills. Sanity checks:

- Free tiers that sleep are fine for a demo — mention the cold start rather
  than hoping the interviewer does not notice
- Set a budget alert on any cloud account
- Object storage egress is the classic surprise line item
- Turn off what you are not using

## What to have ready for an interview

Be able to answer, about your own project:

- Where is it hosted, and why that choice?
- How does a change get from your machine to production?
- How many instances, and what happens if one dies?
- Where does the database live, and how is it backed up?
- How do schema changes reach production?
- How would you know if it broke right now?
- How would you roll back?

"It is on Render, deployed from GitHub Actions on merge to main, two instances
behind their load balancer, managed Postgres with daily backups, migrations run
as a pipeline step before the rollout, errors go to Sentry" is a complete answer
and takes twenty seconds.

Having deployed *anything* end to end puts you ahead of a large share of
candidates, because most bootcamp portfolios stop at `npm run dev`.
