# OAuth 2.0 and OpenID Connect for app developers

"Add Sign in with Google" and "call the Microsoft Graph API for the user" are
ordinary tickets, and interviewers use them to see whether you know what a
token actually means. You do not need to build an authorisation server. You do
need to know the Authorization Code flow with PKCE, the three kinds of token, and
the handful of checks that stop an attacker walking in.

## The four roles, and the one distinction that matters

| Role | Plain meaning | Example |
|---|---|---|
| Resource owner | The user | Ada |
| Client | Your app, asking for access | Your React app plus its API |
| Authorisation server | Issues tokens after the user consents | Google, Entra ID, Auth0, Keycloak |
| Resource server | The API that accepts access tokens | Google Calendar API, or your own API |

**OAuth 2.0 is delegated authorisation.** It answers "may this client call that
API on the user's behalf?" It says nothing reliable about *who* the user is.

**OpenID Connect (OIDC) is authentication on top of OAuth.** It adds the
`openid` scope, a standard ID token, and a `userinfo` endpoint. "Sign in with X"
is OIDC. If an interviewer asks you to sum it up in one line: OAuth gets you
an access token for an API; OIDC also gets you an ID token that says who
signed in.

## Three tokens, three audiences

| Token | Who reads it | What it says | Typical lifetime |
|---|---|---|---|
| ID token (OIDC) | Your client | Who signed in, when, and how | Minutes; used once at login |
| Access token | The resource server (API) | This client may do these scopes | 5–60 minutes |
| Refresh token | The authorisation server only | Issue a new access token | Days to months; rotated on use |

The classic mistake is to accept an access token as proof of identity: "the
token is valid, so this is Ada". An access token issued to *some other app* for
the same provider can be just as valid. Your API should accept only access
tokens whose `aud` (audience) is your API, and your login should use the ID
token, whose `aud` is your client id.

## Authorization Code with PKCE, step by step

This is the flow for every kind of app in 2026: server-rendered, single-page
and mobile. The implicit flow (tokens in the URL fragment) and the password
grant are deprecated by the OAuth security best current practice (RFC 9700)
and are dropped from OAuth 2.1.

1. Your app creates a random **code verifier** and its SHA-256 hash, the **code
   challenge**, plus random `state` and `nonce` values. It stores all three in
   the user's session.
2. It redirects the browser to the provider:

```http
GET /authorize?response_type=code
  &client_id=devpath-web
  &redirect_uri=https://app.example.com/auth/callback
  &scope=openid%20email%20profile
  &state=Qx8f...&nonce=n-0S6...
  &code_challenge=qRhmc6PA...&code_challenge_method=S256 HTTP/1.1
Host: login.provider.com
```

3. The user signs in and consents at the provider, never on your page.
4. The provider redirects back with a short-lived, single-use `code` and the
   same `state`.
5. Your **server** checks `state` matches the session, then exchanges the code:

```http
POST /token HTTP/1.1
Host: login.provider.com
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&code=SplxlOB...&redirect_uri=https://app.example.com/auth/callback
&client_id=devpath-web&client_secret=...&code_verifier=dBjftJeZ4CVP...
```

6. The provider returns an ID token, an access token and usually a refresh
   token. Your server validates the ID token, finds or creates the local user
   by `iss` plus `sub`, and starts an ordinary session.

Generating the PKCE pair takes two lines in Node 24:

```js
import { randomBytes, createHash } from 'node:crypto';

const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
```

## What each check defends against

| Check | Attack it stops |
|---|---|
| `state` matches the session | Login CSRF: the attacker completes the flow in your browser with *their* code, so you end up signed in as them |
| PKCE `code_verifier` | A stolen authorisation code (from logs, a malicious app on the device, or a leaked redirect) cannot be redeemed without the verifier |
| Exact `redirect_uri` registration | Codes being sent to an attacker's URL via an open redirect or a wildcard pattern |
| ID token `nonce` | Replay of an ID token from another login |
| ID token signature, `iss`, `aud`, `exp` | Forged tokens, tokens from another provider, tokens meant for another app, stale tokens |

Validate ID tokens with a maintained library (`openid-client` or `jose` in
Node, `Microsoft.AspNetCore.Authentication.OpenIdConnect` in .NET). It fetches
the provider's signing keys from its JWKS endpoint, found via
`/.well-known/openid-configuration`, and rejects `alg: none`. Never decode a JWT
with `atob` and trust what you read.

## Identify users by issuer plus subject, not email

`sub` is the provider's stable, never-reassigned id for the user; `iss` names
the provider. Store the pair as the external identity. Email looks tempting but
it can change, and some providers let users assert an unverified address. If
you link accounts by email, only do it when the provider sets
`email_verified: true` *and* you trust that provider to verify it. Otherwise an
attacker who registers your admin's email at a lax provider signs in as them.

## Single-page apps: keep tokens off the browser

A React app *can* run the code flow itself as a public client with PKCE, but
then the access and refresh tokens live in JavaScript memory or storage, and any
XSS can steal them. The pattern most teams use in 2026 is a
**backend-for-frontend (BFF)**:

- The browser talks only to your own backend, with an `HttpOnly`,
  `Secure`, `SameSite=Lax` session cookie.
- The BFF runs the code flow as a confidential client (it has a client secret),
  holds the tokens server-side, and attaches the access token when it calls
  downstream APIs.
- Logout is simple: destroy the server session, and optionally redirect to the
  provider's end-session endpoint.

This moves you back to ordinary cookie-session security, covered in
[Auth: sessions, tokens and cookies](auth-sessions-jwt.md), and makes CSRF your
concern rather than token theft; see [CSRF and SameSite](csrf-and-samesite.md).

## Scopes, consent and machine-to-machine calls

**Scopes** are what the client asks to do (`calendar.read`, `orders:write`);
**claims** are statements in a token (`sub`, `email`, `roles`). Ask for the
fewest scopes that work: users see them on the consent screen, and a leaked
token can only do what its scopes allow. Your API should check the scope for
each endpoint, not just "is the token valid".

When no user is involved (a nightly job calling your billing API), use the
**client credentials** grant: the service authenticates with its own
credentials and gets an access token for itself. Do not create a fake "service
user" with a password.

## Refresh tokens

Short access tokens limit the damage of a leak; refresh tokens keep users signed
in. Good providers **rotate** refresh tokens: each use returns a new one and
invalidates the old, and reuse of an old one revokes the whole family, which
reveals theft. Store refresh tokens server-side (in the BFF) or, on mobile, in
the platform keychain. Never put them in `localStorage`.

## Build or buy

For most CRUD products, a managed identity provider (Entra ID, Auth0, Cognito,
Keycloak if you self-host) is the defensible default. It brings MFA, passkeys,
password resets and breach detection you would otherwise build. Your code still
owns authorisation: what a signed-in user may do is your data and your rules,
covered in [Authorisation models](authorisation-models.md). The hand-built
session flow in [the auth project](../../66-auth/) is still worth doing once, so
you know what the provider is doing for you.

## What you should be able to answer

- What is the difference between OAuth 2.0 and OpenID Connect, and which token
  proves who signed in?
- Walk through the Authorization Code flow with PKCE. What does PKCE stop that
  `state` does not?
- Your API receives a valid, signed access token. What else must it check before
  trusting it?
- Why should you identify external users by `iss` and `sub` rather than email?
- Where should a React app's tokens live, and what is a backend-for-frontend?
- Which grant does a scheduled job use to call another service, and why not a
  service account with a password?
