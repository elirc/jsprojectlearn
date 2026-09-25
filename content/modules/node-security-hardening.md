# Hardening a Node service

[Web security basics](web-security-basics.md) covers the attacks every web app
faces. This guide is about the ones that are specific to Node and npm, or that
Node makes unusually easy: a regex that freezes the whole server, a merge that
changes every object in the process, a `postinstall` script that steals your CI
tokens. Interviewers for backend Node roles ask about these because they separate
people who have run Node in production from people who have only built on it.

## One thread means one bad request can stop everyone

In a thread-per-request server, a slow request hurts itself. In Node, any
synchronous work blocks every request on that instance. That turns some ordinary
bugs into denial-of-service holes.

**ReDoS.** Backtracking regexes with nested quantifiers, such as `/^(a+)+$/` or a
careless email pattern, take exponential time on crafted input. Thirty characters
can block the loop for seconds.

```js
// Bad: nested quantifier, attacker controls input length
const EMAIL = /^([a-zA-Z0-9]+\.?)+@example\.com$/;

// Better: bound the input first, then use a linear pattern or a real parser
if (email.length > 254) return badRequest();
```

Defences: cap input lengths before matching, avoid nested quantifiers, use a
validator library for emails and URLs, and lint with a ReDoS checker. Node has no
regex timeout.

**Unbounded work.** Every limit you do not set is one an attacker sets for you:

| Limit | Where | Typical value |
|---|---|---|
| JSON body size | `express.json({ limit })` | 100 KB, raised per route |
| Upload size and count | multer `limits`, busboy | Per feature, streamed to disk |
| Array and string lengths | Zod `.max()` | Whatever the UI can produce |
| Page size | `limit` query param | 100 |
| Header/request time | `server.headersTimeout`, `server.requestTimeout` | Defaults 60 s / 300 s; lower behind no proxy |
| Outbound calls | `AbortSignal.timeout(ms)` on `fetch` | A few seconds |

A 50 MB JSON body is parsed synchronously by `JSON.parse`, which is why the default
100 KB limit exists.

## Prototype pollution

Every plain object inherits from `Object.prototype`. A recursive merge that copies a
key called `__proto__` (or `constructor.prototype`) writes onto that shared prototype,
and suddenly every object in the process has the property:

```js
function merge(target, src) {
  for (const k in src) {
    if (typeof src[k] === 'object') merge((target[k] ??= {}), src[k]);
    else target[k] = src[k];
  }
}
merge({}, JSON.parse('{"__proto__": {"isAdmin": true}}'));
({}).isAdmin; // true, for every object, until the process restarts
```

`JSON.parse` itself is safe: it creates an ordinary own property named `__proto__`.
The damage happens in code that walks keys and assigns them. Defences, in order of
preference: validate bodies with a schema that strips unknown keys, so `__proto__`
never survives; avoid hand-written deep merges; use `Object.create(null)` or `Map`
for dictionaries keyed by user input; and keep dependencies such as lodash patched.
Starting Node with `--disable-proto=delete` removes the `__proto__` accessor
altogether.

## Injection, the Node flavours

- **SQL:** parameters (`$1` in node-postgres, tagged `$queryRaw` in Prisma), never
  template literals. `$queryRawUnsafe` is exactly what its name says.
- **NoSQL:** a body of `{ "password": { "$ne": null } }` passed into a MongoDB filter
  matches any user. Validate that fields are strings.
- **Command:** `exec` runs a shell. Use `execFile` or `spawn` with an argument array;
  see [workers and child processes](node-workers-and-child-processes.md).
- **Code:** `eval`, `new Function` and `node:vm` with user input. The Node docs are
  explicit that `vm` is not a security boundary.
- **Path traversal:** resolve the path, then check it is inside the base directory:

```js
const base = path.resolve('uploads');
const full = path.resolve(base, req.params.name);
if (!full.startsWith(base + path.sep)) return res.sendStatus(404);
```

## SSRF: your server as the attacker's proxy

Any feature that fetches a URL a user supplied (link previews, webhooks you call,
"import from URL") can be pointed at `http://169.254.169.254/` (cloud metadata with
credentials) or internal admin services. Checking the hostname string is not enough,
because a public name can resolve to a private IP and a redirect can go anywhere.
Resolve the name, reject private, loopback and link-local ranges, pin the connection
to the checked IP, disable or re-check redirects, and where possible send such
requests through an egress proxy that enforces the rules.

## Secrets and comparisons

- Compare tokens and signatures with `crypto.timingSafeEqual`, after checking the
  lengths match (it throws otherwise). `===` returns early and leaks timing.
- Generate tokens with `crypto.randomBytes(32).toString('base64url')` or
  `crypto.randomUUID()`, never `Math.random()`.
- Hash passwords with `crypto.scrypt` or argon2, never a fast hash; see [auth,
  sessions and JWT](auth-sessions-jwt.md).
- Read secrets once at startup from the environment or a secret manager; never log
  `process.env` or whole request headers. pino's `redact` option exists for this.

## The supply chain

A typical API installs hundreds of transitive packages, any of which can run code at
install time and at runtime.

| Control | What it stops |
|---|---|
| Committed lockfile + `npm ci` | Silent version drift between machines and CI |
| `npm ci --ignore-scripts`, allow-listing packages that need build scripts | Malicious `postinstall` scripts reading CI secrets |
| `npm audit` / Dependabot / Renovate | Known vulnerabilities staying unpatched |
| `npm audit signatures` | Tampered packages; checks registry signatures and provenance |
| Few, well-maintained dependencies | Less attack surface; `left-pad` risk |
| `overrides` in package.json | Forcing a patched transitive version before the parent updates |

Typosquats (`expresss`, `lodahs`) and compromised maintainer accounts are the common
attack paths. Reviewing what a new dependency pulls in before adding it is a habit
worth mentioning in interviews.

## Least privilege for the process

- **Run as a non-root user.** Official Node images ship a `node` user; add
  `USER node` in the Dockerfile. A code-execution bug then is not root in the
  container.
- **Read-only filesystem** where the platform supports it, with a writable temp
  directory only if needed.
- **Node's permission model.** `node --permission` denies file-system reads and
  writes, child processes, worker threads and native addons unless granted with
  `--allow-fs-read=/app`, `--allow-child-process` and similar. It is stable in
  Node 24 but does not restrict network access, so it complements, rather than
  replaces, container isolation.
- **Production mode.** `NODE_ENV=production` stops Express's default error handler
  sending stack traces. Your own error handler must not send them either.

## HTTP-level hardening in Express

```js
app.disable('x-powered-by');
app.set('trust proxy', 1);                    // exactly the number of proxies you have
app.use(helmet());                            // CSP, HSTS, nosniff, frame-ancestors...
app.use(cors({ origin: ['https://app.example.com'], credentials: true }));
app.use('/auth', rateLimit({ windowMs: 15 * 60_000, limit: 20, store: redisStore }));
```

`trust proxy` set to `true` lets any client spoof `X-Forwarded-For` and dodge the rate
limiter. A memory rate-limit store is per instance, so with four replicas the real
limit is four times what you configured; back it with Redis.

## A review checklist

- Every input validated with bounds; unknown keys stripped.
- No `exec`, `eval`, `vm` or `$queryRawUnsafe` fed by input.
- Regexes on user input reviewed for nested quantifiers; input length capped first.
- Every outbound call has a timeout; user-supplied URLs go through SSRF checks.
- Tokens from the CSPRNG; comparisons timing-safe; passwords with scrypt or argon2.
- Lockfile committed, `npm ci` in CI, dependency updates automated, install scripts controlled.
- Container runs as non-root; stack traces never reach clients; logs redact secrets.

## What you should be able to answer

- Why is ReDoS worse in Node than in a thread-per-request server, and how do you defend against it?
- What is prototype pollution, and why is `JSON.parse` alone not the problem?
- How would you safely implement a "fetch this URL" feature?
- What are the risks of npm install scripts, and how do you reduce them in CI?
- Why use `timingSafeEqual` for webhook signatures, and what is its sharp edge?
- What does Node's `--permission` flag restrict, and what does it not?
