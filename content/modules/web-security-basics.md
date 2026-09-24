# The security basics you are expected to know

Nobody expects a mid-level CRUD developer to be a security specialist. They do
expect you to not ship the obvious holes, and to recognise a dangerous pattern
in review. This is that baseline.

## Injection

Untrusted input becoming code. SQL is the famous one, but the pattern repeats:
shell commands, LDAP queries, template engines, `eval`.

**The fix is separation, not sanitisation.** Parameterised queries send the
query text and the values down separate channels, so a value can never become
a keyword:

```
db.query('SELECT * FROM users WHERE email = $1', [email]);
```

Hand-rolled escaping fails on encodings, on nested contexts, and on the edge
case you did not think of. If you are writing escaping code for SQL, you are
using the wrong API.

**Where parameters cannot help:** dynamic identifiers. A column name in
`ORDER BY` cannot be a parameter, so it must come from an allowlist you control.

The same applies to shell commands — pass an argument array, never build a
command string from user input.

## XSS

Attacker JavaScript running in your page, with full access to the DOM, to
localStorage, and to any request the user is authenticated for.

Three flavours: **stored** (saved in your database and served to others),
**reflected** (bounced back off a query parameter), and **DOM-based** (client
code writes untrusted data into the page).

**The fix is contextual output encoding.** The escaping differs by where the
value lands — HTML body, HTML attribute, URL, JavaScript string, CSS all have
different rules. Frameworks do this for you by default:

- React escapes anything interpolated in JSX. The opt-out is
  `dangerouslySetInnerHTML` — the name is a deliberate warning.
- Razor escapes by default. The opt-out is `@Html.Raw`.
- In vanilla JavaScript, `textContent` is safe; `innerHTML` parses markup.

If you must render user-supplied HTML (a rich-text field), sanitise it with a
real library like DOMPurify against an allowlist. Never write your own.

**Defence in depth:** a Content-Security-Policy header means that even if
something slips through, the browser refuses to execute it.

```
Content-Security-Policy: default-src 'self'; object-src 'none'; base-uri 'self'
```

The hard part of adopting CSP is removing inline scripts, which is also why it
is worth doing.

## CSRF

The browser attaches cookies automatically, so a form on `evil.com` can trigger
an authenticated request to your app. The attacker never sees the response —
they only need the side effect.

Defences:

1. **`SameSite=Lax`** on session cookies — blocks cross-site POSTs, and
   handles most cases. Set it explicitly: only Chromium-based browsers default
   to `Lax`; Firefox and Safari do not.
2. **Anti-forgery token** — a random value in a form field or header that the
   attacker cannot read, because the same-origin policy stops them reading your
   page.
3. **Verify the `Origin` header** on state-changing requests.

Auth via an `Authorization` header is not CSRF-vulnerable, because the browser
does not attach it for you. That is a real point in favour of the header
approach; weigh it against the XSS exposure of a token JavaScript can read (see
[the auth guide](auth-sessions-jwt.md)).

## Broken access control

The most common serious vulnerability in CRUD apps, and the one most likely to
be *your* bug rather than a framework's.

```
// Authenticated, and completely broken
app.get('/api/orders/:id', requireAuth, async (req, res) => {
  const order = await db.orders.findById(req.params.id);
  res.json(order);   // whose order?
});
```

Change the id in the URL, read someone else's invoice. It has a name:
**insecure direct object reference** / broken object-level authorization.

**Enforce ownership in the query, not after it:**

```
const order = await db.orders.findOne({ id: req.params.id, userId: req.user.id });
if (!order) return res.status(404).end();
```

Doing it in the query means you cannot forget the check on some branch, and it
fails closed. The same applies to *every* list endpoint — a missing tenant
filter on a multi-tenant app is a data breach.

Also check the write side: can a user set `role: "admin"` in a profile update
because you spread the request body straight into the entity? **Mass assignment**
is the same class of bug. Bind to an explicit DTO with only the fields a user
may set.

## Secrets

- Never in the repository. Git history is permanent — deleting a committed
  secret does not remove it, so the only remediation is **rotation**.
- Environment variables or a secret manager (Key Vault, Secrets Manager,
  Doppler). Locally: user secrets, or an uncommitted `.env` beside a committed
  `.env.example`.
- Never in logs, error messages, URLs, or client-side code. "It's minified" is
  not obscurity.
- Rotate on any suspicion, and on staff departure.

Add a secret scanner to CI. It catches the accidental commit before it merges.

## Security headers

Cheap, high value, set once in middleware:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY                      (or CSP frame-ancestors)
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: ...
```

`nosniff` stops the browser guessing a content type and executing an upload as
script. `X-Frame-Options`/`frame-ancestors` prevents clickjacking.

## File uploads

A genuinely dangerous feature:

- **Do not use the user's filename.** It can contain path traversal (`../../`)
  or an executable extension.
- Generate your own identifier; keep the original name as metadata only.
- **Validate content, not the `Content-Type` header** — that is client-supplied.
  Check magic bytes.
- Enforce a size limit before buffering the whole thing.
- Store outside the web root, ideally in object storage, and serve from a
  separate origin so a stored HTML file cannot run as your site.

## Rate limiting and lockout

Protects login endpoints from credential stuffing, expensive endpoints from
abuse, and everything from a buggy client in a retry loop.

Limit **per account as well as per IP** — a distributed attack uses thousands of
IPs against one account. Return `429` with `Retry-After`.

## Dependencies

Most of your shipped code is someone else's. Install scripts and runtime code
both execute with your process's privileges.

- Run `npm audit` / `dotnet list package --vulnerable` in CI
- Patch on a schedule rather than in a panic
- Assess reachability — not every advisory is exploitable in your usage, but
  "we never looked" is not defensible
- Prefer fewer, better-maintained dependencies. Every one is a trust decision.

## Error handling and information disclosure

Never return a stack trace to a client. It reveals framework versions, file
paths, and sometimes connection strings.

Log the detail with a correlation id; return a generic message plus that id.
Support can find the full error; an attacker cannot.

Check that `ASPNETCORE_ENVIRONMENT` / `NODE_ENV` is actually set to production
in production — the developer exception page is one misconfigured variable away.

## Logging safely

Never log passwords, tokens, session ids, card numbers, or full request bodies
that might contain them. Redact at the logging layer, not at each call site,
because you will forget one.

## The review checklist

Run through this on any pull request touching data or auth:

- [ ] Every query is parameterised
- [ ] Every record lookup filters by owner or tenant
- [ ] The write path binds to an explicit DTO, not the raw body
- [ ] Output is escaped, and no new `innerHTML` / `Html.Raw` / `dangerouslySetInnerHTML`
- [ ] New endpoints have the right auth attribute
- [ ] No secrets, no tokens in URLs, no PII in logs
- [ ] Errors return a generic message and a trace id
- [ ] File uploads validate type, size and name

## The principles behind all of it

- **Defence in depth** — layer independent controls, because any one will fail.
- **Least privilege** — the app's database account does not need DROP.
- **Fail closed** — an error in an authorization check must deny, not allow.
- **Never trust the client** — it is not a trust boundary. The server is.
