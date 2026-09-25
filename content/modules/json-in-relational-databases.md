# JSON in relational databases

Every modern relational database stores and queries JSON, and every team has a
debate about when to use it. Interviewers ask "when would you use a JSON
column?" to see whether you reach for it to avoid designing a schema or to
solve a real problem. This guide covers that judgement, then the syntax and
indexing in Postgres 17, SQL Server 2022 and SQLite, which is what you need
once you have decided. The modelling side is introduced in
[relational-data-modeling.md](relational-data-modeling.md).

## When JSON is the right tool

Good fits share one property: the database does not need to enforce rules
inside the document, and you rarely filter or join on its contents.

- **Payloads you store as received**: webhook bodies, third-party API
  responses, audit snapshots of an entity before and after a change.
- **Genuinely variable attributes**: product specs that differ per category,
  user preferences, feature-flag settings.
- **Data always read and written as a whole** with its parent row, such as a
  saved dashboard layout.

Poor fits:

- **Anything you join on.** Tag ids in a JSON array cannot have foreign keys, so
  deleted tags leave dangling ids, and "posts with tag 5" needs JSON functions
  instead of an indexed join. Use a junction table.
- **Core fields you filter, sort or aggregate constantly**, such as status,
  price or customer id. Make them columns.
- **Data with invariants**: required fields, types, ranges and uniqueness are
  far easier to enforce with columns and constraints.

A common, healthy hybrid: real columns for what you query and constrain, plus
one JSON column for the long tail.

## Postgres: use jsonb

Postgres has two types. `json` stores the original text and reparses it on
every access. `jsonb` stores a parsed binary form: key order and duplicate keys
are lost, but it is faster to query and supports indexes and containment
operators. Use `jsonb` unless you must preserve the exact input text.

| Operator | Returns | Example |
| --- | --- | --- |
| `->` | jsonb | `payload -> 'user'` |
| `->>` | text | `payload ->> 'type'` |
| `#>>` | text at a path | `payload #>> '{user,plan}'` |
| `@>` | boolean, containment | `payload @> '{"type":"signup"}'` |
| `?` | boolean, key exists | `payload ? 'refund'` |

The most common bug is comparing the wrong type. `->>` gives text, so numbers
need a cast: `(payload ->> 'amount')::numeric > 100`. Comparing `payload ->
'type' = 'signup'` fails, because the left side is jsonb.

For paths and filters inside arrays, SQL/JSON path is also available:
`jsonb_path_exists(payload, '$.items[*] ? (@.qty > 5)')`.

## Indexing JSON in Postgres

Two approaches, for two query shapes:

```sql
-- Containment queries on any key
CREATE INDEX ix_events_payload ON events USING gin (payload jsonb_path_ops);
SELECT id FROM events WHERE payload @> '{"type": "signup"}';

-- Equality or range on one specific field
CREATE INDEX ix_events_plan ON events ((payload #>> '{user,plan}'));
SELECT id FROM events WHERE payload #>> '{user,plan}' = 'pro';
```

A GIN index accelerates `@>` and jsonpath matches, not `->>` equality. The
default `jsonb_ops` class also serves `?` key-existence; `jsonb_path_ops` is
smaller and faster but does not.
The expression index serves exactly the expression it was built on, so the
query must use the same operators and path. If you find yourself creating
several expression indexes on one JSON field, promote that field to a real
column, possibly a generated one:

```sql
ALTER TABLE events
  ADD COLUMN event_type text GENERATED ALWAYS AS (payload ->> 'type') STORED;
```

## SQL Server: functions over text

SQL Server 2022 stores JSON in `nvarchar(max)` and queries it with functions.
(Azure SQL Database and SQL Server 2025 add a native `json` type; the functions
work on both.)

| Function | Purpose |
| --- | --- |
| `ISJSON(col)` | Validity check, typically in a CHECK constraint |
| `JSON_VALUE(col, '$.user.plan')` | Extract a scalar; NULL for objects or arrays |
| `JSON_QUERY(col, '$.tags')` | Extract an object or array |
| `JSON_MODIFY(col, '$.user.plan', 'team')` | Return an updated document |
| `OPENJSON(col, '$.tags')` | Table-valued: one row per element |

Mixing up `JSON_VALUE` and `JSON_QUERY` gives silent NULLs, the classic SQL
Server JSON bug. To index a field, add a computed column and index it:

```sql
ALTER TABLE Events ADD PlanCode AS JSON_VALUE(Payload, '$.user.plan');
CREATE INDEX IX_Events_PlanCode ON Events (PlanCode);
```

Queries that use the same `JSON_VALUE` expression can then seek the index.

## SQLite: handy for local work

SQLite's JSON functions are built in, and since 3.38 it supports `->` and
`->>` too. Paths use the SQL/JSON style (`$.a.b[0]`, zero-based):

```sql
CREATE TABLE events (id INTEGER PRIMARY KEY,
                     payload TEXT CHECK (json_valid(payload)));
SELECT payload ->> '$.user.plan' FROM events;             -- 'pro'
SELECT json_set(payload, '$.user.plan', 'team') FROM events;
CREATE INDEX ix_plan ON events (payload ->> '$.user.plan');
```

`EXPLAIN QUERY PLAN` confirms that `WHERE payload ->> '$.user.plan' = 'pro'`
searches that expression index.

## Turning arrays into rows

Reporting on arrays needs them as rows. Each engine has a table-valued function
you join to:

```sql
-- Postgres
SELECT e.id, t.tag
FROM events e
CROSS JOIN LATERAL jsonb_array_elements_text(e.payload -> 'tags') AS t(tag);

-- SQL Server
SELECT e.Id, t.[value]
FROM Events e
CROSS APPLY OPENJSON(e.Payload, '$.tags') t;
```

These behave as inner joins: a parent with an empty or missing array
disappears. Use `LEFT JOIN LATERAL ... ON true` or `OUTER APPLY` to keep it.

## Updating part of a document

Postgres `jsonb_set(payload, '{user,plan}', '"team"')` and SQL Server
`JSON_MODIFY` return a new document; the whole value is rewritten on disk
either way, so JSON columns are not cheaper to update than rows. Two writers
updating different keys of the same document in read-modify-write code will
overwrite each other (a lost update); do the change in one `UPDATE ... SET
payload = jsonb_set(payload, ...)` statement so the row lock serialises them.

## Validation belongs somewhere

The database will accept any valid JSON, so decide where the shape is
enforced:

- **At the boundary**, parse and validate with a schema library before writing
  (see [typescript-runtime-validation.md](typescript-runtime-validation.md)).
- **In the database**, add light checks: `CHECK (jsonb_typeof(payload -> 'tags')
  = 'array')` in Postgres, `CHECK (ISJSON(Payload) = 1)` in SQL Server.
- **Version the shape**: include a `"v": 2` field so old documents can be
  migrated or read differently.

ORMs help here too: EF Core maps owned types to JSON columns with `ToJson()`,
and Prisma exposes `Json` fields, but both leave the document's contents less
constrained than columns.

## What you should be able to answer

- When is a JSON column a good choice, and when should the data be real columns or a junction table?
- What is the difference between Postgres `json` and `jsonb`, and between the `->` and `->>` operators?
- How do you index a query on one field inside a jsonb column, and how does that differ from a GIN index?
- What is the difference between `JSON_VALUE` and `JSON_QUERY` in SQL Server, and how do you index a JSON field there?
- How do you turn a JSON array into rows for a report, and what happens to parents with empty arrays?
- Where do you validate the shape of JSON documents, given the database accepts any valid JSON?
