# Auth: sessions, tokens and cookies

Every CRUD app has a login. Getting it wrong is the most consequential mistake
a junior developer can ship, which is why interviewers ask carefully — and why
the confident-but-wrong answer ("we use JWTs, they're stateless and more
secure") is such a reliable filter.

## The two words, kept straight

- **Authentication** — proving who you are. Failing it is **401**.
- **Authorization** — deciding what you may do. Failing it is **403**.

A logged-in user fetching someone else's invoice is an *authorization* failure.
That specific bug — checking that someone is logged in but not that the record
belongs to them — is the most common serious vulnerability in CRUD apps. It has
a name: **broken object-level authorization**. Knowing it by name is worth
saying out loud.

## Storing passwords

Never store, log, or email a password. Store a hash produced by a **slow,
salted, password-specific** algorithm:

- **Argon2id** — current best choice, memory-hard so GPUs and ASICs help less
- **bcrypt** — still fine, widely available, work factor around 12
- **scrypt** — also acceptable
- **PBKDF2** — acceptable where required by compliance

**Not** SHA-256, SHA-512 or MD5. Those are designed to be fast; a GPU computes
billions per second. A password hash needs to be deliberately slow — tens of
milliseconds per attempt — so brute force costs real money.

The **salt** is a unique random value per password, stored alongside the hash.
It means two users with the same password get different hashes, which kills
precomputed rainbow tables. Every library above handles the salt for you; if you
find yourself writing salt code, you are using the wrong function.

```
$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+dWRWJTmaaJObG
   ^algorithm      ^parameters      ^salt        ^hash
```

The parameters are stored in the string so you can raise the work factor later
and rehash on next login.

Two more rules:

- **Compare in constant time.** Use the library's verify function, not `==`.
- **Rehash on login** if the stored parameters are weaker than your current
  policy. That is how you upgrade a password database without asking anyone to
  reset.

## Login flow, and what not to leak

```
POST /auth/login  { email, password }
  -> find user by email
  -> verify password against the stored hash
  -> on success: establish a session (see below)
  -> on failure: 401, generic message
```

**Return the same error for "no such user" and "wrong password."** Different
messages let an attacker enumerate which accounts exist — useful for targeted
phishing and credential stuffing.

Timing leaks it too: if a missing user returns in 5ms and a wrong password takes
80ms because you ran the hash, the difference is measurable. Run a dummy hash
verification when the user does not exist so both paths cost the same.

The same reasoning applies to signup ("this email is already registered" is an
enumeration oracle) and password reset (always say "if that address exists, we
have sent a link").

**Rate limit login.** Per IP *and* per account — a distributed attack uses
thousands of IPs against one account, so IP-only limiting does not help.

## Sessions vs JWT: the actual trade-off

### Server-side sessions

```
Login  -> create a session record, send an opaque id in a cookie
Request-> look up the session id, load the user
Logout -> delete the session record
```

- **Revocation is trivial.** Delete the row. "Log out everywhere", "ban this
  user now", "invalidate all sessions after a password change" — all one query.
- **Costs shared state.** Every instance must reach the session store (Redis or
  the database). That is one network hop per request.
- The cookie contains no information, so nothing leaks if it is read.

### JWT (stateless tokens)

```
header.payload.signature   (three base64url segments, dot-separated)
```

The server signs a payload of claims; any instance can verify the signature
without a lookup.

- **No shared state**, no lookup per request. Nice for many services.
- **You cannot un-issue it.** Until it expires, it is valid. "Log out
  everywhere" requires a revocation list — which is server state again, and now
  you have the costs of both designs.

**The payload is not encrypted.** It is base64url — anyone can decode it in a
browser console. The signature proves it was not *altered*, not that it is
*secret*. Never put anything sensitive in the claims.

### What teams actually do

Short-lived **access token** (5–15 minutes) plus a long-lived, revocable
**refresh token** stored server-side:

- The access token's short life bounds the damage of a leak.
- The refresh token is a database row, so it can be revoked.
- **Rotate refresh tokens on use**: issue a new one each time and invalidate the
  old. If an old one is presented again, that is a strong signal of theft —
  revoke the whole family.

For a single web app with one backend, **plain server-side sessions are simpler
and better**, and saying so in an interview is a good answer.

## Where the credential lives in a browser

There is no free option. Know both sides:

| | HttpOnly cookie | localStorage |
|---|---|---|
| Readable by injected script (XSS) | **No** | **Yes** |
| Sent automatically cross-site (CSRF) | **Yes** — needs SameSite / CSRF token | No |
| Works with multiple tabs | Yes | Yes |
| Usable from a native mobile client | Awkward | Easy |

**Default to an `HttpOnly; Secure; SameSite=Lax` cookie for a browser app.** XSS
is the more likely and more damaging attack, and HttpOnly is the only thing that
actually defends against token theft.

Where localStorage is genuinely defensible: a token that a non-browser client
also uses, or an architecture where cookies cannot work. Say why, do not just
assert it.

## CSRF

Because a browser attaches cookies automatically, a form on `evil.com` can make
an authenticated request to your API. The attacker never sees the response —
they only need the side effect.

Defences, in order of usefulness:

1. **`SameSite=Lax`** on the session cookie. Blocks cross-site POSTs. This is
   the default in modern browsers and covers most cases.
2. **Anti-forgery token** — a random value in a form field or header that the
   attacker cannot read (because the same-origin policy stops them reading your
   page).
3. **Check the `Origin` header** on state-changing requests.

Token-in-Authorization-header auth is not CSRF-vulnerable, because the browser
does not attach it for you. That is a real point in favour of the header
approach — weigh it against the XSS exposure.

## Authorization, done properly

Two checks, always:

```
Is the caller authenticated?              -> 401 if not
Is this specific record theirs to touch?  -> 403/404 if not
```

The second one has to be enforced in the query, not after it:

```sql
-- Wrong: fetch then check
SELECT * FROM orders WHERE id = $1;

-- Right: the filter is part of the lookup
SELECT * FROM orders WHERE id = $1 AND customer_id = $2;
```

Doing it in the query means you cannot forget the check on some code path, and
it fails closed.

For anything beyond ownership, prefer **policies over scattered role strings**.
`RequireClaim("department", "finance")` or a policy named
`CanApproveExpenses` is greppable and changeable; `if (user.Role == "Admin")`
sprinkled through 40 controllers is not.

## OAuth 2.0 and OpenID Connect

- **OAuth 2.0** is *delegated authorization*: letting an app act on a user's
  behalf at another service, without their password.
- **OpenID Connect** is a thin authentication layer on top of OAuth. "Sign in
  with Google" is OIDC.

Using raw OAuth as a login mechanism is a classic misuse — an access token says
"this app may call the API", not "this is who the user is". The ID token from
OIDC is the one that answers the second question.

For your own app, "should we build login or use a provider?" is a legitimate
question with a defensible answer either way. Managed identity providers remove
a large class of risk; they also add a dependency and a cost.

## Multi-factor

TOTP (an authenticator app) is the practical baseline: cheap, offline, no SMS
costs, and not vulnerable to SIM swapping. Store the shared secret encrypted,
give the user recovery codes, and require re-authentication before changing MFA
settings.

## The checklist

- [ ] Passwords hashed with Argon2id or bcrypt, never SHA
- [ ] Same generic error for wrong password and unknown user, in constant time
- [ ] Login rate limited per IP **and** per account
- [ ] Session cookie is `HttpOnly; Secure; SameSite=Lax`
- [ ] Password change invalidates other sessions
- [ ] Every record lookup filters by owner in the query
- [ ] Nothing sensitive in a JWT payload
- [ ] Tokens never appear in URLs or logs
- [ ] Password reset tokens are single-use and short-lived
- [ ] Secrets come from the environment, never the repository

## Questions you should be able to answer

- Sessions or JWT for this app, and why?
- Why bcrypt rather than SHA-256?
- Where does the token live in the browser, and what is the trade-off?
- What happens to existing sessions when a user changes their password?
- How do you stop user A reading user B's order?
