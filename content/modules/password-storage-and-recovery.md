# Password storage and account recovery

Every CRUD app with a login stores passwords and every one needs a "forgot
password" link. Interviewers like both because the naive version works in a demo
and fails badly in a breach. This guide goes past "use bcrypt": hashing
parameters, upgrading old hashes, modern password rules, and a reset flow that
does not hand out accounts.

The basics (never store plain text, why fast hashes are wrong, what a salt is)
are in [Auth: sessions, tokens and cookies](auth-sessions-jwt.md). Start there
if any of that is new.

## Choosing and tuning the hash

Use **Argon2id** unless a platform constraint says otherwise. OWASP's current
minimum is 19 MiB of memory, 2 iterations and 1 degree of parallelism; raise the
memory until one hash takes something like 50–250 ms on your production
hardware. Tune on the real machine: a laptop benchmark says nothing about a
small container.

```js
import argon2 from 'argon2';

const opts = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };

const hash = await argon2.hash(password, opts);
// $argon2id$v=19$m=19456,p=1,t=2$q7kBrOW3f/hjD5CMVCPi3w$U04JHjE8Gl117qE59t...
const ok = await argon2.verify(hash, password);
```

Node 24 also ships `crypto.argon2()` in the standard library, but the npm
package gives you the self-describing PHC string above and a `needsRehash`
helper, which is what you want in application code. In .NET, ASP.NET Core
Identity's `PasswordHasher<T>` uses PBKDF2 with a high iteration count and
versioned output; that is acceptable, and [the password hashing
project](../../csharp/23-auth-password-hashing/) walks through it.

| Algorithm | Status | Watch out for |
|---|---|---|
| Argon2id | First choice | Memory cost affects server capacity; load-test the login endpoint |
| bcrypt | Fine for existing systems | Only the first 72 bytes of input count; cost 12+ |
| scrypt | Acceptable | Parameters are easy to get wrong |
| PBKDF2-SHA256 | Where FIPS compliance requires it | Needs 600,000+ iterations to be comparable |
| SHA-256, MD5, anything unsalted | Never | Billions of guesses per second on one GPU |

## Pepper: an optional second secret

A **pepper** is a secret key, kept outside the database (in a key vault or
environment secret), mixed in with the password before hashing, usually as an
HMAC. If attackers steal only the database, they cannot even begin cracking. It
is defence in depth, not a replacement for a slow hash, and it makes key
rotation a project: you cannot re-pepper without the plain password, so version
it alongside the hash.

## Upgrading hashes you inherited

You join a team whose `users` table holds unsalted SHA-1 hashes. Two moves, in
order:

1. **Wrap now.** Compute `argon2id(sha1Hash)` for every row in a migration and
   mark those rows `legacy_wrapped`. On login, verify with
   `argon2.verify(stored, sha1(password))`. The weak hashes are gone from the
   database today, without waiting for anyone to log in.
2. **Rehash on login.** After a successful login, when the row is wrapped or
   `argon2.needsRehash(stored, opts)` says the parameters are old, hash the
   plain password afresh and save it. Over months the table converges on
   current settings.

The same `needsRehash` path lets you raise the memory cost next year without a
mass reset. Resetting everyone's password is the last resort, for when the old
hashes have already leaked.

## Password rules that match current guidance

NIST SP 800-63B (revision 4, 2025) turned the old folklore round. The rules
worth quoting in an interview:

- **Length over complexity.** At least 15 characters when the password is the
  only factor, 8 when it is used with MFA. Accept at least 64 characters and any
  Unicode, including spaces.
- **No composition rules.** "One uppercase, one digit, one symbol" produces
  `Password1!`, not strength.
- **No forced periodic changes.** Force a change only on evidence of compromise.
- **Check against a blocklist** of breached and common passwords. The Have I
  Been Pwned range API does this with k-anonymity: you send only the first five
  hex characters of the SHA-1 hash and match the suffixes locally, so the
  password never leaves your server.
- **Allow paste and password managers.** Blocking paste pushes users to shorter
  passwords.

## Login without leaking or locking

Return the same message and a similar response time for "no such user" and
"wrong password"; hashing a dummy password on the unknown-user path keeps the
timing honest. Registration and reset are the other enumeration leaks: "that
email is already registered" tells an attacker who has an account. Send an
email instead ("someone tried to sign up with your address") and show a
neutral message on screen.

For brute force, prefer **throttling** (progressive delays per account and per
IP, with a limit such as 10 failures in 15 minutes) over hard lockout, which an
attacker can use to lock your users out on purpose. Credential stuffing, where
leaked pairs from other sites are replayed, is best met with MFA, breached
password checks and bot detection on the login form. The rate limiter pattern is
in [the rate limiter project](../../76-rate-limiter/).

## A reset flow that holds up

```txt
POST /password-reset { email }
  -> 202 "If an account exists, we have sent a link" (always)
  -> if the account exists: email a link carrying a one-time token

POST /password-reset/confirm { token, newPassword }
  -> look up hash(token), check expiry and unused
  -> set the new password hash, mark the token used
  -> revoke all sessions and refresh tokens, email a notice
  -> 204
```

The details are where resets go wrong:

| Decision | Do this | Because |
|---|---|---|
| Token | 32 random bytes from a CSPRNG, base64url | Guessable tokens are account takeover |
| Storage | Store a SHA-256 hash of the token, with the user id and expiry | A read-only database leak should not hand out working links |
| Lifetime | 15–60 minutes, single use | Emails linger in inboxes, forwards and backups |
| Link host | Build from configuration, never from the request's `Host` header | Host header injection sends the token to the attacker's domain |
| After reset | Revoke every session and refresh token; email a notice | Kicks out an attacker who was already in |
| Response | Same message whether or not the account exists | No account enumeration |

A fast hash (SHA-256) is fine for the token, unlike for passwords, because the
token has 256 bits of entropy and cannot be guessed from a dictionary.

```js
import { randomBytes, createHash } from 'node:crypto';

const token = randomBytes(32).toString('base64url');           // goes in the email
const tokenHash = createHash('sha256').update(token).digest('hex'); // goes in the DB
```

Keep the reset page free of third-party scripts and send
`Referrer-Policy: no-referrer`, or the token in its URL can leak to analytics.

## Changing email, and losing everything

Changing the account email is itself a takeover route. Require the current
password (or a fresh MFA check), send a confirmation link to the **new**
address, and notify the **old** one with a way to undo. Only switch once the new
address is confirmed.

When a user has lost both their password and their second factor, recovery
codes issued at MFA enrolment are the self-service path. Past that, recovery is
a support process with identity checks, a delay, and notifications, not a
security question. "Mother's maiden name" is public information for most people
and NIST no longer allows it.

## What you should be able to answer

- Which password hashing algorithm would you choose today, and how would you
  pick its parameters?
- You inherit a table of unsalted SHA-1 hashes. What do you do this week, and
  what happens over the following months?
- What does current NIST guidance say about complexity rules and forced
  password rotation?
- Design a password reset: how is the token generated, stored and expired, and
  what happens after the reset?
- How do you stop login, registration and reset from revealing which emails have
  accounts?
- Why is throttling usually better than locking an account after five failures?
