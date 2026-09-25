# Cloud building blocks for a CRUD app

In a design round or a "how would you deploy this?" question, you are expected
to draw the path a request takes through the cloud and justify each box: why a
CDN, why a private subnet, why a queue, why the app has a role rather than a
key. The provider matters much less than the reasoning. This guide walks the
request path from DNS to database, then covers identity, storage, messaging,
reliability and cost, in provider-neutral terms.

[deployment-and-hosting](deployment-and-hosting.md) compares hosting options
and maps AWS to Azure names; this guide is about how the pieces fit together.

## The request path

```txt
browser
  │  DNS: app.example.com → CDN / load balancer
  ▼
CDN (static assets, cached GETs, TLS at the edge, WAF rules)
  ▼
Load balancer (public subnet, TLS termination, health checks, path routing)
  ▼
API instances or containers (private subnets, 2+ availability zones)
  │            │                  │
  ▼            ▼                  ▼
Managed DB   Object storage    Queue ──► workers (emails, exports, webhooks)
(private,    (uploads, via
 multi-AZ)    presigned URLs)
```

Every box answers a specific need:

| Box | Solves | Without it |
| --- | --- | --- |
| DNS | a stable name that can move between endpoints | clients hard-code IPs |
| CDN | latency for static files, origin offload, edge TLS | every asset crosses the world |
| Load balancer | spreads traffic, removes unhealthy instances | one instance is a single point of failure |
| Multiple instances | availability and horizontal scale | a deploy or crash is an outage |
| Managed database | backups, patching, failover | you run Postgres by hand at 3 a.m. |
| Object storage | durable, cheap file storage | uploads vanish with instance disks |
| Queue and workers | slow or unreliable work off the request path | requests time out on email sends |

## Networking: VPCs, subnets and firewalls

A **VPC** (VNet in Azure) is your private address space. Split it into subnets
across at least two availability zones:

- **Public subnets** have a route to an internet gateway. Only things that must
  accept traffic from the internet live here: load balancers, NAT gateways.
- **Private subnets** have no inbound route from the internet. App instances
  and databases live here.

Outbound calls from private subnets (a payment API, package downloads) leave
through a **NAT gateway**, which also gives you a stable egress IP for partners
that allow-list addresses. Calls to the provider's own services (object storage,
queues, secret manager) should use **private endpoints** instead: they stay on
the provider network and avoid NAT data-processing charges.

**Security groups** (network security groups in Azure) are stateful firewalls
attached to resources. Write them in terms of each other:

| Resource | Inbound allowed from |
| --- | --- |
| load balancer | internet on 443 (and 80 for redirects) |
| API instances | the load balancer's security group on 8080 |
| database | the API's security group on 5432 or 1433 |

Referencing groups rather than IP ranges means the rules keep working as
instances scale in and out. A database open to `0.0.0.0/0` is the classic
finding in every security review.

## Identity: roles, not keys

The app needs to read secrets, write to a bucket and send to a queue. The
wrong way is an access key in an environment variable: it never expires, it
leaks through logs and screenshots, and rotating it means a redeploy.

The right way is a **workload identity**: an IAM role for the instance or
task, an Azure managed identity, or a GCP service account. The platform injects
short-lived credentials, and the SDKs find them automatically:

```ts
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
// No keys in code or config: the SDK uses the task role's temporary credentials.
const s3 = new S3Client({ region: "eu-west-2" });
await s3.send(new PutObjectCommand({ Bucket: "acme-uploads-prod", Key: key, Body: body }));
```

```csharp
// Azure: DefaultAzureCredential uses the managed identity in production
// and your developer login locally.
var client = new BlobServiceClient(new Uri(blobUrl), new DefaultAzureCredential());
```

Scope each role to exactly what the app uses (least privilege): `PutObject` on
one bucket, not `s3:*` on everything. CI pipelines get the same treatment via
OIDC federation (see [github-actions-in-depth](github-actions-in-depth.md)).

## Object storage patterns

Object storage (S3, Blob Storage, GCS) is where files go. Three patterns cover
most CRUD needs:

- **Direct uploads with presigned URLs.** The API authorises the user, then
  returns a URL valid for one object for a few minutes. The browser uploads
  straight to storage, and your API never streams large bodies. Configure the
  bucket's CORS to allow your origin.
- **Private downloads with presigned GET URLs.** The bucket stays private; the
  API checks access and redirects to a short-lived URL.
- **Lifecycle rules** expire temporary exports after N days and move old
  objects to colder, cheaper tiers.

Turn on versioning for buckets holding user data (it protects against
overwrites and deletes) and block public access at the account level unless a
bucket is deliberately public.

## Managed databases

A managed database does the operational work, but you still make decisions:

| Feature | Protects against | Does not protect against |
| --- | --- | --- |
| Multi-AZ standby | a zone or host failure (automatic failover) | bad writes, which replicate faithfully |
| Read replicas | read load on the primary | replica lag; not a backup |
| Automated backups + point-in-time recovery | accidental `DELETE`, corruption | a restore you have never tested |
| Cross-region copy | a region-wide disaster | anything quickly; RTO is hours |

Also plan for: connection limits (every instance's pool counts, so 20 instances
× 20 connections exceeds a small instance's limit; use a pooler such as
PgBouncer or RDS Proxy), maintenance windows that cause brief failovers (your
app must reconnect and retry), and storage that fills up (enable storage
autoscaling and alert well before full).

## Queues and pub/sub

Use a managed queue when work can happen after the response: emails, PDF
exports, webhook deliveries, image processing. The mechanics are the same
everywhere:

- A consumer receives a message, which becomes invisible for a **visibility
  timeout** (or lock duration). It must delete or complete the message after
  successful processing; otherwise it reappears.
- Delivery is **at least once**, so handlers must be idempotent.
- After N failed attempts a message moves to a **dead-letter queue**. Alert on
  its depth.
- For fan-out (one event, several independent consumers) publish to a **topic**
  with a subscription per consumer, rather than having consumers compete on one
  queue.

[background-jobs-and-queues](background-jobs-and-queues.md) covers the
application side in depth.

## Reliability in numbers

Two figures drive disaster-recovery design: **RPO** (how much data you can
lose, measured back from the failure) and **RTO** (how long recovery may take).
Hourly snapshots cannot meet a five-minute RPO; a cold restore in another
region cannot meet a fifteen-minute RTO.

Availability of dependencies in series multiplies: three required services at
99.9% each give about 99.7%. The sensible default for a CRUD app is multi-AZ
everything in one region, tested backups, and infrastructure defined as code
(see [infrastructure-as-code-basics](infrastructure-as-code-basics.md)) so you
could rebuild elsewhere. Multi-region active-active is a large step up in cost
and complexity that few mid-size products need.

## Where the money goes

| Line item | Typical cause | Lever |
| --- | --- | --- |
| Compute | oversized or idle instances | right-size, autoscale, scale non-prod to zero at night |
| Database | provisioned for peak, storage and IOPS | right-size, reserved capacity for steady load |
| Data transfer out | large downloads from origin, cross-region calls | CDN, compression, keep traffic in-region |
| NAT gateway | traffic to cloud services through NAT | private or gateway endpoints |
| Logs and metrics | debug logging, high-cardinality labels | log levels, sampling, bounded labels |

Tag resources by environment and owner, and set budget alerts on every account.
A forgotten test database is the most common surprise bill.

## What you should be able to answer

- Draw the path of a request from the browser to the database, and justify
  each component.
- Why do app servers and databases go in private subnets, and how do they still
  make outbound calls?
- How does your API get permission to write to a bucket without an access key?
- How would you let users upload 200 MB videos without them passing through
  your API?
- What does a read replica protect you from, and what does it not?
- Your bill doubled last month. Where do you look first?
