# MFA and passkeys

Stolen and reused passwords are behind most account takeovers, so "how would
you add MFA?" and "what is a passkey?" now come up in ordinary web developer
interviews. A strong answer ranks the factors by what they actually resist,
explains how TOTP works in a sentence, and knows why passkeys resist phishing
when one-time codes do not.

## Factors, and what each one resists

A factor is something you know (password), have (phone, security key) or are
(fingerprint, face). MFA means two *different* kinds; a password plus a
security question is still one kind.

| Method | Phishing | SIM swap / interception | Notes |
|---|---|---|---|
| SMS code | No | No | Better than nothing; SIM swaps and SS7 attacks are routine |
| Email code | No | Depends on the mailbox | Fine as a recovery channel, weak as a second factor |
| TOTP app (Google Authenticator, 1Password) | No | Yes | Cheap, offline, the practical baseline |
| Push approval with number matching | Partly | Yes | Plain "Approve?" pushes invite MFA-fatigue attacks |
| Passkey / security key (WebAuthn) | Yes | Yes | Bound to your domain; nothing for a user to type into a fake site |

"Phishing" is the column that matters. A convincing fake login page can ask for
the SMS or TOTP code and replay it to your real site within seconds, a so-called
real-time relay. A passkey cannot be relayed like that, for reasons covered
below.

## How TOTP works

TOTP (RFC 6238) is a shared secret plus the clock. At enrolment your server
generates a random secret (20 bytes is usual) and shows it as a QR code. Every
30 seconds, the app and the server both compute an HMAC of the current time
step and take six digits from it:

```js
import { createHmac } from 'node:crypto';

function totp(secret, now = Date.now(), step = 30, digits = 6) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / step)));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, '0');
}
```

That snippet reproduces the RFC's test vectors, but in production use a
maintained library (`otplib` in Node, `Otp.NET` in .NET) and get these details
right:

- **Accept a small window**, typically one step either side, to allow for
  clock drift. Wider windows give guessers more valid codes.
- **Reject reuse.** Store the last accepted time step per user; a code that
  worked once must not work again inside its window.
- **Rate-limit attempts.** Six digits is a million combinations; five tries per
  code window is plenty for humans.
- **Encrypt the secret at rest.** Unlike a password, you need the secret itself
  to verify codes, so you cannot hash it. Keep the encryption key outside the
  database.
- **Compare in constant time**, with `crypto.timingSafeEqual` or the library's
  verify.

## Enrolment and recovery codes

Enrolment is where accounts get quietly taken over, so treat it as a sensitive
action:

1. Require a recent login or password re-entry before starting.
2. Show the QR code and a text version of the secret.
3. **Only enable MFA after the user submits a valid code**, which proves their
   app actually has the secret.
4. Issue 8–10 single-use **recovery codes**, show them once, and store them
   hashed like passwords.
5. Email the user that MFA was turned on, with a link for "this was not me".

Changing or removing a factor needs the same care: a fresh MFA check, then a
notification. Otherwise an attacker with a stolen session cookie can remove your
MFA and add their own.

## Step-up authentication and remembered devices

You do not have to prompt for a second factor on every page. Common patterns:

- **Step-up**: ask for MFA again before high-risk actions (changing email or
  bank details, exporting data, deleting the account), even within a session.
  Record `amr` (how the user authenticated) and `auth_time` in the session so
  the check is a simple comparison.
- **Remember this device** for 30 days: a separate, signed, `HttpOnly` cookie
  that lets the login skip the second factor on that browser. Revoke all of
  them when the password changes or MFA is reset.

If you use an identity provider via OIDC, it does most of this for you; you
request stronger authentication with `acr_values` or `max_age` and check the
returned `acr`/`amr` claims. See [OAuth 2.0 and OpenID
Connect](oauth-oidc-for-app-devs.md).

## Passkeys and WebAuthn

A passkey is a WebAuthn credential: a **key pair** created by the user's device
or password manager for *your site specifically*. Your server stores only the
public key. To sign in, the server sends a random challenge; the authenticator
checks the user is present (fingerprint, face, PIN) and signs the challenge with
the private key, which never leaves the device.

Why that beats codes:

- **Origin binding.** The browser includes the page's origin in what gets
  signed, and the credential is scoped to your relying-party id
  (`example.com`). A look-alike domain cannot ask for, or use, your site's
  passkey. There is nothing for the user to type into a phishing page.
- **No shared secret.** A database breach leaks public keys, which are useless
  to an attacker.
- **Two factors in one gesture.** Possession of the device plus the biometric or
  PIN that unlocks it (`userVerification: 'required'`).

**Synced passkeys** (iCloud Keychain, Google Password Manager, 1Password) are
copied across a user's devices, which solves "I lost my phone" for most people.
**Device-bound** passkeys on a hardware security key never leave it, which some
organisations require for administrators.

## Implementing passkeys without writing crypto

The two ceremonies, both driven by a library such as SimpleWebAuthn in Node
(ASP.NET Core Identity in .NET 10 includes passkey support):

```txt
Registration (user signed in)
  server: generateRegistrationOptions()  -> challenge, rp id, user id
  browser: navigator.credentials.create(options)
  server: verifyRegistrationResponse()   -> store credential id + public key

Authentication
  server: generateAuthenticationOptions() -> challenge
  browser: navigator.credentials.get(options)
  server: verifyAuthenticationResponse() -> check signature, origin, challenge
```

Store the challenge in the server session and accept it once; never trust a
challenge the client sends back unverified. For a smooth sign-in, use
**conditional UI**: mark the username field with
`autocomplete="username webauthn"` and the browser offers saved passkeys in its
autofill list.

```html
<input name="username" autocomplete="username webauthn" />
```

## Rolling it out in a real product

- Offer passkeys alongside passwords first; let users add one after signing in
  ("Sign in faster next time").
- Keep at least one recovery path per account: a second passkey, TOTP, or
  recovery codes. Account recovery that falls back to email alone makes the
  mailbox the real security boundary.
- Make MFA mandatory for administrators and staff before customers. Their
  accounts are where a single takeover does the most damage.
- Log every factor change and every recovery code use, and alert on them.

Interviewers often end with "so should we just use SMS?" The balanced answer:
SMS beats no MFA, TOTP beats SMS, and passkeys beat both because they are the
only common option that phishing cannot relay. Password storage and recovery
flows are in [Password storage and account
recovery](password-storage-and-recovery.md).

## What you should be able to answer

- Rank SMS, TOTP, push approval and passkeys by resistance to phishing, and
  explain the ranking.
- How does TOTP generate a code, and why must the server store the secret
  encrypted rather than hashed?
- What should happen, in order, when a user enrols in MFA?
- Why can a passkey not be phished the way a one-time code can?
- What is step-up authentication, and which actions would you protect with it?
- A user has lost their phone. What recovery options should already exist?
