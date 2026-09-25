# CSRF and SameSite, properly

"Isn't CSRF solved by SameSite cookies now?" is a favourite follow-up once you
say your app uses cookie sessions. The honest answer is "mostly, with gaps",
and naming the gaps (what counts as a *site*, top-level GET requests, sibling
subdomains, browsers that do not default to `Lax`) is what separates a
memorised answer from an understood one.

The short version of the defences is in [The security basics](web-security-basics.md).
This guide explains why each one works and where each one stops.

## The attack in one paragraph

Browsers attach cookies to requests based on where the request *goes*, not
where it *came from*. If Ada is signed in to `bank.example` and visits
`evil.test`, a hidden form there can `POST` to `bank.example/transfer` and her
session cookie rides along. The attacker cannot read the response (the
same-origin policy stops that), but they do not need to: the transfer has
happened. CSRF exists wherever authentication is *ambient*: cookies, HTTP Basic
auth, client certificates, even network position on an intranet.

APIs authenticated by an `Authorization: Bearer` header that your own
JavaScript attaches are not exposed, because the browser never adds that
header on its own. That is why the question only really matters for cookie
sessions, which are otherwise the safer choice for browser apps (see [Auth:
sessions, tokens and cookies](auth-sessions-jwt.md)).

## Site is not origin

SameSite rules are about **sites**, and a site is looser than an origin:

| URL A | URL B | Same origin? | Same site? |
|---|---|---|---|
| `https://app.example.com` | `https://app.example.com:443/x` | Yes | Yes |
| `https://app.example.com` | `https://api.example.com` | No | Yes |
| `https://app.example.com` | `http://app.example.com` | No | No (schemeful same-site) |
| `https://app.example.com` | `https://example.org` | No | No |
| `https://alice.github.io` | `https://bob.github.io` | No | No (`github.io` is on the public suffix list) |

A site is the scheme plus the registrable domain (`example.com`), as defined by
the public suffix list. So a request from `blog.example.com` to
`app.example.com` is **same-site**, and SameSite cookies are sent with it. If
any subdomain can be taken over (a forgotten DNS record pointing at a deleted
cloud bucket) or hosts user content, SameSite does not protect you from it.

## The three SameSite values

| Value | Cookie sent on cross-site... | Use for |
|---|---|---|
| `Strict` | Nothing, not even following a link from another site | High-value actions; users arriving via a link appear signed out on the first request |
| `Lax` | Only top-level navigations with safe methods (clicking a link, a `GET` form) | The sensible default for session cookies |
| `None` (requires `Secure`) | Everything | Cookies that genuinely must work in cross-site iframes or embeds |

Two gaps with `Lax`:

- **State-changing GETs.** `GET /account/delete?confirm=1` is a top-level
  navigation, so the cookie is sent. Never change state on `GET`; HTTP
  semantics say so anyway (see [HTTP from the wire up](http-fundamentals.md)).
- **Browser defaults differ.** Chromium treats a cookie with no `SameSite`
  attribute as `Lax` (with a short-lived exception for top-level POSTs just
  after the cookie is set). Firefox and Safari do not apply that default, so
  always set the attribute explicitly.

A good session cookie in 2026 looks like this. The `__Host-` prefix makes the
browser refuse it unless it is `Secure`, has `Path=/`, and has no `Domain`, so a
sibling subdomain cannot set or overwrite it ("cookie tossing"):

```http
Set-Cookie: __Host-session=9f2c...; Path=/; Secure; HttpOnly; SameSite=Lax
```

## Defence 1: Fetch Metadata

Every current browser sends `Sec-Fetch-Site` on requests: `same-origin`,
`same-site`, `cross-site`, or `none` (typed in the address bar or opened from a
bookmark). A few lines of middleware can reject cross-site state changes
outright, and unlike SameSite it distinguishes `same-site` from `same-origin`:

```js
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const ALLOWED_ORIGINS = new Set(['https://app.example.com']);

export function rejectCrossSite(req, res, next) {
  if (SAFE.has(req.method)) return next();
  const site = req.get('Sec-Fetch-Site');
  if (site) {
    return site === 'same-origin' || site === 'none' ? next() : res.status(403).end();
  }
  const origin = req.get('Origin'); // older clients: fall back to Origin
  if (origin && ALLOWED_ORIGINS.has(origin)) return next();
  return res.status(403).end();
}
```

Requests with neither header come from non-browser clients such as `curl` or
another server. Those do not carry a victim's cookies, so if your API also
accepts bearer tokens, apply this check only to cookie-authenticated requests.

## Defence 2: anti-forgery tokens

The classic defence: the server issues a random token tied to the session, puts
it in each form (or exposes it to your JavaScript), and rejects state-changing
requests that do not echo it back. `evil.test` cannot read your page, so it
cannot learn the token.

| Pattern | How it works | Watch out for |
|---|---|---|
| Synchroniser token | Token stored in the session, sent in a hidden field or header | Needs server-side session state |
| Signed double-submit cookie | Token in a cookie and in a header; server checks they match and that the signature binds it to the session | An unsigned version can be defeated by a subdomain that tosses its own cookie |
| Custom request header | Require `X-Requested-With` or similar on every mutation | Relies on CORS forcing a preflight for custom headers; weaker than a real token |

Framework support: ASP.NET Core's antiforgery system does the synchroniser
pattern: Razor forms get tokens automatically, and with `app.UseAntiforgery()` minimal API
endpoints that bind form data are validated too. In Express, the old `csurf` package is
deprecated; use a maintained double-submit library such as `csrf-csrf`, or
Fetch Metadata plus SameSite.

## Things that are not CSRF protection

- **CORS.** It controls whether a script can *read* a cross-origin response.
  A "simple" request (a form `POST` with `application/x-www-form-urlencoded`,
  `multipart/form-data` or `text/plain`) is sent without any preflight, and the
  side effect happens whatever CORS says.
- **"We only accept JSON."** True only if the server rejects requests whose
  `Content-Type` is not `application/json`. A form can send a JSON-looking body
  as `text/plain`, and lenient body parsers will happily parse it.
- **Checking `Referer`.** Often stripped by privacy settings and referrer
  policies, so it forces you to fail open.
- **POST-only endpoints.** A form can post.

## Special cases worth naming

- **Login CSRF.** An attacker signs the victim in to the *attacker's* account,
  then later reads whatever the victim entered. Protect the login form too, and
  in OAuth flows this is what the `state` parameter prevents (see [OAuth 2.0
  and OpenID Connect](oauth-oidc-for-app-devs.md)).
- **WebSockets.** The handshake carries cookies and is not covered by CORS, so a
  hostile page can open a socket as the user (cross-site WebSocket hijacking).
  Check the `Origin` header during the handshake. The chat in [the WebSocket
  project](../../67-websocket-chat/) is a good place to add it.
- **Logout.** Low risk, but a cross-site `GET /logout` is still an annoyance;
  make it a `POST`.

## Testing it

An integration test should prove the refusal, not just the happy path: send a
`POST` with a valid session cookie but `Sec-Fetch-Site: cross-site` (or a
missing or wrong token) and assert `403`, and assert the same request with the
right token or `same-origin` succeeds. Check the `Set-Cookie` header in a test
too, so nobody quietly drops `SameSite` or `Secure` in a refactor.

## What you should be able to answer

- Why does a browser send your session cookie with a request that another site
  started?
- What is the difference between same-site and same-origin, and why does it
  matter for SameSite cookies?
- What does `SameSite=Lax` still allow, and what rule keeps that safe?
- How do Fetch Metadata headers help, and what do you do for clients that do
  not send them?
- Why is CORS not a CSRF defence?
- What is login CSRF, and where else does the same idea appear?
