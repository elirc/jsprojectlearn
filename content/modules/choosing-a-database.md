# Choosing a database

"Why Postgres and not MongoDB?" and "would you use SQL or NoSQL for this?" come
up in design rounds and in any conversation about a project on your CV. The
interviewer is not looking for a favourite. They want to hear you reason from
the data's shape, its consistency needs and its access patterns to a choice,
and name what you gave up. This guide gives you that reasoning, with the
default a mid-level CRUD developer should start from.

## Start from the default

For a typical web application (users, orders, bookings, invoices, content
with an admin screen) the default is a **relational database**: Postgres, SQL
Server or MySQL. The reasons are concrete:

- **Your data is relational.** Customers have orders, orders have lines, lines
  reference products. Joins and foreign keys model that directly.
- **You need transactions.** Taking payment and decrementing stock must succeed
  or fail together.
- **Constraints protect you from your own bugs.** Unique emails, non-negative
  stock and valid references are enforced whatever code path writes the data.
- **Queries change.** Next month's report or admin filter is an ad hoc SQL query
  away, instead of a data migration.
- **The ecosystem is mature**: EF Core, Prisma, Drizzle, migrations tooling,
  managed hosting on every cloud, and people who know how to run it.

Postgres 17 also covers several "specialist" needs well enough (jsonb documents,
full-text search, geospatial with PostGIS, vectors with pgvector), which is why
"start with Postgres" is such common advice. You then add other stores when a
specific requirement demands it, not up front.

## Postgres, SQL Server, MySQL or SQLite?

The relational engines are more alike than different; the choice is usually
made by the stack and the team.

| Engine | Typical reasons to choose it |
| --- | --- |
| Postgres | Open source, rich types (jsonb, arrays, ranges), strong standards support, extensions; the default in Node and increasingly in .NET |
| SQL Server / Azure SQL | .NET shops, existing Microsoft licensing, excellent tooling (SSMS, Query Store), enterprise features |
| MySQL / MariaDB | Very common in PHP and hosted platforms; simple replication; fine for CRUD |
| SQLite | Embedded, one file, zero administration: tests, local tools, desktop and mobile apps, small single-server sites |

Differences that bite when you switch: default isolation implementation
(locking versus MVCC readers), case sensitivity of comparisons and collations,
NULLs in unique indexes, identity and paging syntax, and date types. See
[sql-isolation-and-locking.md](sql-isolation-and-locking.md) and
[sql-null-three-valued-logic.md](sql-null-three-valued-logic.md).

SQLite deserves a note: it handles a surprising amount of read-heavy traffic on
one server, but it allows one writer at a time and is not shared across app
instances, so it is the wrong choice for a horizontally scaled API. The
[../../86-sqlite-orders/](../../86-sqlite-orders/) project uses it because
it needs no server.

## When a document store fits

Document databases (MongoDB, Azure Cosmos DB, Couchbase) store JSON-like
documents and read or write a whole aggregate in one operation. They fit when:

- Each record is **self-contained and read as a unit**: a product catalogue
  entry with nested variants, a content page, an event payload.
- The **shape varies a lot** between records and changes often.
- Access is **by key or a few known patterns**, not ad hoc joins.
- You need **built-in horizontal scaling** across regions more than cross-record
  transactions.

The costs: relationships between documents are your code's problem (no
foreign keys, joins are limited), you must design documents around queries up
front, and multi-document transactions exist in MongoDB but are slower and
rarer. Denormalised copies must be kept in sync by application code. Many
teams that chose a document store for "flexibility" end up re-implementing
constraints and joins. A relational database with a jsonb column often gives
you both (see [json-in-relational-databases.md](json-in-relational-databases.md)).

## Key-value stores and caches

Redis (and Valkey), Memcached, and managed options such as Azure Cache for
Redis keep data in memory for sub-millisecond access by key. Use them for:

- Caching expensive query results or rendered fragments.
- Sessions, rate-limit counters and short-lived tokens.
- Simple queues, locks and pub/sub.

They are not a primary store for business data: persistence is optional and
eventually consistent with your database. Treat everything in them as
disposable. See [caching-strategies.md](caching-strategies.md).

DynamoDB is a different case: a durable, massively scalable key-value and
document store. It rewards designing every access pattern up front (single-table
design) and punishes new query patterns later. It is a strong fit for very high,
predictable-pattern workloads on AWS, and a poor fit for a CRUD admin app whose
queries keep changing.

## Specialist stores

| Need | Typical tool | Try first in Postgres |
| --- | --- | --- |
| Search with facets, typo tolerance | OpenSearch, Elasticsearch, Meilisearch | `tsvector` and `pg_trgm` |
| Time series metrics | TimescaleDB, InfluxDB, Prometheus | Partitioned tables, BRIN indexes |
| Graph traversals (friends of friends of friends) | Neo4j | Recursive CTEs |
| Vector similarity for AI features | Pinecone, Qdrant | pgvector |
| Analytics over billions of rows | ClickHouse, BigQuery, Snowflake | Read replica plus materialised views |
| Files and images | S3, Azure Blob Storage | Never in the database; store the key |

Each extra store is another system to deploy, secure, back up, monitor and keep
consistent. The right question is "what specific requirement does the database
we have fail to meet?"

## Questions to ask before choosing

1. **What are the entities and relationships?** Many-to-many and references
   between records point to relational.
2. **What must be consistent together?** Anything that must commit atomically
   should live in one database.
3. **What are the read and write patterns?** Key lookups, ad hoc filters,
   aggregates, full-text, time ranges.
4. **What volume, really?** A single Postgres server handles thousands of
   transactions per second and terabytes of data. Most apps never outgrow it;
   read replicas and caching come long before sharding.
5. **Who runs it?** A managed service your team knows beats a theoretically
   better engine nobody can operate at 3 a.m.
6. **What does the rest of the stack expect?** ORM support, hosting, and
   existing skills are legitimate inputs.

## Polyglot persistence, carefully

Real systems often combine stores: Postgres as the source of truth, Redis for
caching and sessions, object storage for files, a search engine fed from the
database. The rule that keeps this sane is **one system of record per piece of
data**. Everything else is a derived copy, rebuilt from the source, updated via
an outbox or change data capture, and allowed to be briefly stale. Writing the
same fact to two stores from application code, without a transactional outbox,
is how they drift apart (see
[background-jobs-and-queues.md](background-jobs-and-queues.md)).

## How to answer in an interview

Keep it short and structured: state the default, justify it from the data, and
name the trigger that would change your mind. For example: "Postgres, because
orders, customers and stock are relational and must change together; I'd store
product specs that vary by category in a jsonb column; I'd add Redis for
sessions and caching if profiling showed hot reads; and I'd only add a search
engine if we needed facets or typo tolerance that Postgres full-text cannot
give us." That answer shows judgement, trade-offs and restraint, which is what
the question tests. The broader design round is covered in
[system-design-for-crud.md](system-design-for-crud.md).

## What you should be able to answer

- Why is a relational database the default for a typical CRUD application?
- When would you choose a document database, and what do you give up?
- What is Redis good for, and why is it not a primary store for business data?
- How do Postgres, SQL Server and SQLite differ in when you would pick them?
- What does "one system of record per piece of data" mean when you use several stores?
- What requirement would make you add a dedicated search engine or analytics store?
