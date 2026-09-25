# Injection and safe queries

Every developer can say "use parameterised queries". Interviews and code
reviews test the cases where that sentence is not enough: a sortable column, a
search box with optional filters, a raw query inside an ORM, a JSON body going
straight into MongoDB, a file name from a URL. This guide covers the patterns
that keep each of those safe in Node and .NET.

The principle, from [The security basics](web-security-basics.md), is
**separation, not sanitisation**: data travels in a channel that can never be
parsed as code. Everything below applies that one idea.

## Why parameters work

With a parameterised query the SQL text and the values reach the database
separately. The database parses the text once, then binds the values into the
plan as data. There is no string for an attacker's quote to escape out of.

```js
// node-postgres: placeholders are $1, $2...
const { rows } = await pool.query(
  'SELECT id, email FROM users WHERE email = $1 AND tenant_id = $2',
  [email, tenantId],
);
```

```cs
// EF Core 9/10: the interpolated values become DbParameters, not text
var users = await db.Users
    .FromSql($"SELECT * FROM users WHERE email = {email}")
    .ToListAsync();
```

The EF Core line looks like string interpolation, but `FromSql` takes a
`FormattableString` and turns each hole into a parameter. The trap is its
sibling: `FromSqlRaw("... WHERE email = '" + email + "'")` is concatenation
with extra steps. Dapper, `Microsoft.Data.SqlClient` and `mysql2` all have the
same shape: placeholders in the text, values alongside.

| API | Safe form | Unsafe form |
|---|---|---|
| node-postgres | `query('... $1', [v])` | `query("... '" + v + "'")` |
| Prisma | `$queryRaw` as a tagged template | `$queryRawUnsafe('... ' + v)` |
| Knex | `whereRaw('total > ?', [v])` | `whereRaw('total > ' + v)` |
| EF Core | `FromSql($"... {v}")`, LINQ | `FromSqlRaw("... " + v)` |
| Dapper | `Query("... @Email", new { Email = v })` | `Query("... '" + v + "'")` |

Stored procedures are not automatically safe either: a procedure that builds
dynamic SQL with string concatenation inside itself is injectable too.

## When a value cannot be a parameter

Parameters stand for **values**. Table names, column names, `ASC`/`DESC` and
SQL keywords cannot be parameters, which is exactly where sortable tables get
injected. Map user input onto an allowlist you control; never pass it through:

```js
const SORTABLE = { created: 'created_at', total: 'total', customer: 'customer_name' };

export function buildOrderQuery({ status, minTotal, sort = 'created', dir = 'desc' }) {
  const where = [];
  const params = [];
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  if (minTotal != null) { params.push(minTotal); where.push(`total >= $${params.length}`); }
  const column = SORTABLE[sort] ?? 'created_at';
  const direction = dir === 'asc' ? 'ASC' : 'DESC';
  const sql = `SELECT id, total, status FROM orders${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY ${column} ${direction} LIMIT 50`;
  return { sql, params };
}
```

Given `sort: 'total; DROP TABLE orders'`, this produces
`ORDER BY created_at ASC`, because the lookup fails and falls back. The
optional filters show the other half of the pattern: build the SQL text from
fixed fragments you wrote, and push every user value into `params`. The API
side of this is in [Pagination, filtering and
sorting](api-pagination-filtering.md).

## Lists, LIKE and other awkward values

- **`IN` lists.** Do not join ids into a string. In Postgres, pass an array:
  `WHERE id = ANY($1)` with `[ids]`. In SQL Server, use a table-valued
  parameter, or let EF Core translate `ids.Contains(o.Id)`.
- **`LIKE` searches.** A parameter stops injection, but `%` and `_` in the
  user's text are still wildcards, so searching for `50%` matches too much, and
  a leading `%` defeats indexes. Escape them before adding your own wildcards:

```js
const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);
await pool.query('SELECT * FROM products WHERE name ILIKE $1', [`%${escapeLike(q)}%`]);
```

- **Second-order injection.** A value that was stored safely can still be
  dangerous when a later job reads it back and concatenates it into SQL. "It
  came from our own database" does not make it trusted.

## NoSQL injection

MongoDB queries are objects, so the attack is **operator injection**. If a
login handler does `users.findOne({ email: req.body.email, password: req.body.password })`
and the JSON body is `{ "email": "admin@x.com", "password": { "$ne": null } }`,
the query matches any password. The fix is the same as everywhere: validate the
shape at the boundary so a field that should be a string *is* a string, using
Zod or a similar schema library (see [Runtime validation at the type
boundary](typescript-runtime-validation.md)). Mongoose also offers a
`sanitizeFilter` option that neutralises `$` operators in query filters.

## Commands, paths and templates

**Shell commands.** `exec` hands a string to a shell, so `; rm -rf ~` in a file
name runs. Use `execFile` or `spawn` with an argument array and no shell; the
program receives the file name as a single argument whatever it contains:

```js
import { execFile } from 'node:child_process';
execFile('convert', [uploadPath, '-resize', '200x200', thumbPath], callback);
```

Also pass `--` before user-supplied arguments where the program supports it, so
a value starting with `-` cannot become an option.

**Path traversal.** `GET /files?name=../../.env` reads outside your uploads
folder if you join paths naively. Resolve the full path, then check it is still
inside the base directory:

```js
import path from 'node:path';

const UPLOADS = path.resolve('uploads');
export function resolveUpload(name) {
  const full = path.resolve(UPLOADS, name);
  if (!full.startsWith(UPLOADS + path.sep)) throw new Error('invalid path');
  return full;
}
```

Better still, never use the user's name at all: store uploads under a generated
id and keep the original name as data in the database.

**Template injection.** Rendering a user-supplied string *as a template* (for
example letting customers edit email templates in Handlebars or Razor) lets
them run template code. Treat templates as code: render user text *into* a
fixed template, or use a logic-less, sandboxed engine.

## Limiting the blast radius

Injection-proof code is the goal; these make the day you miss one survivable:

- **Least privilege.** The app's database login can read and write its own
  tables, and cannot `DROP`, create logins, or read other schemas. Run
  migrations with a separate, more powerful login.
- **Generic errors.** Do not return database error text to clients; it hands
  attackers the schema. Log it server-side with a correlation id instead.
- **Static analysis and review.** Code scanning tools flag string-built SQL and
  shell commands; in review, search for `Raw`, `Unsafe`, `exec(` and template
  literals that contain `SELECT`.

## Testing for injection

Unit test the builders that accept user-controlled identifiers: feed the
allowlist functions hostile sort keys and assert the output SQL. At the API
level, an integration test that sends `' OR '1'='1`, `{ "$ne": null }` and
`../../etc/passwd` to the relevant endpoints and asserts a `400` or an empty
result catches regressions cheaply. [The SQLite orders
project](../../86-sqlite-orders/) is a good place to practise both.

## What you should be able to answer

- Why do parameterised queries prevent SQL injection, rather than just making
  it harder?
- A table lets users sort by any column. How do you build the `ORDER BY`
  safely?
- What is the difference between EF Core's `FromSql` and `FromSqlRaw`?
- How does NoSQL operator injection work, and what stops it?
- Why is `execFile` safer than `exec`, and how do you prevent path traversal
  in a download endpoint?
- Which database permissions should a web app's connection string have?
