# XSS in depth: contexts, sinks and CSP

"React escapes everything, so we cannot have XSS" is the answer interviewers
are waiting to challenge. Cross-site scripting still ships in React, Razor and
plain Node apps through a small number of doors: raw HTML, URLs, inline state
and third-party markup. Knowing the doors, and what a Content Security Policy
does when one is left open, is what a mid-level answer sounds like.

The one-paragraph version (stored, reflected, DOM-based; encode on output; CSP
as a backstop) is in [The security basics](web-security-basics.md). This guide
is the detail.

## What an attacker gets

Script running in your origin can do anything the user can: read the page,
call your API with the user's cookies, change their email address, and read
any token stored in `localStorage`. `HttpOnly` cookies stop the script
*reading* the session cookie, but it does not need to: it can make requests as
the user from inside the page. That is why XSS is treated as full account
compromise, and why "we use HttpOnly cookies" is not an XSS defence.

## Sources and sinks

Think in terms of where untrusted data comes from (**sources**) and where it
becomes code or markup (**sinks**):

| Sources | Dangerous sinks |
|---|---|
| Form fields and API bodies saved to the database | `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` |
| URL path, query string and `location.hash` | `dangerouslySetInnerHTML`, Razor `@Html.Raw`, Handlebars `{{{ }}}` |
| `postMessage` data from other windows | `href`/`src` with `javascript:` or `data:` URLs |
| Third-party APIs and webhooks | `eval`, `new Function`, `setTimeout` with a string |
| File names and uploaded SVG or HTML | Inline `<script>` blocks built by string concatenation |

Code review for XSS is mostly searching for the sinks and asking where their
input came from. Lint rules such as `react/no-danger` and
`no-unsanitized/property` automate the search.

## Context decides the encoding

The same value needs different escaping depending on where it lands, which is
why hand-written escaping fails:

| Context | Example | Correct handling |
|---|---|---|
| HTML text | `<p>{name}</p>` | HTML-encode `<`, `>`, `&`; frameworks do this by default |
| Quoted attribute | `<div title="{name}">` | Attribute-encode, including quotes; always quote attributes |
| URL attribute | `<a href="{url}">` | Parse it, allow only `https:` (and maybe `mailto:`), then encode |
| JavaScript | `<script>const n = "{name}"</script>` | Avoid; pass data as JSON in a safe form, see below |
| CSS | `style="color: {colour}"` | Avoid; allowlist values |

React covers the first two automatically. Here is what `renderToStaticMarkup`
in React 19 produces for hostile input:

```html
<div title="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">&lt;img src=x onerror=alert(1)&gt;</div>
```

## React's remaining doors

**`dangerouslySetInnerHTML`.** The usual reason is rendering Markdown or rich
text. Markdown libraries such as `marked` do not sanitise their output, so run
it through DOMPurify with an allowlist before it reaches the DOM:

```jsx
import DOMPurify from 'dompurify';

const html = DOMPurify.sanitize(marked.parse(post.body), { USE_PROFILES: { html: true } });
return <article dangerouslySetInnerHTML={{ __html: html }} />;
```

Sanitise on output, where you know the context, and keep the raw text in the
database so a better sanitiser can be applied later.

**URLs.** React 19 replaces `javascript:` URLs in `href` with one that throws,
but that is a safety net, not validation: `data:` URLs, `window.location =
userUrl` and non-React templates are not covered. Validate user-supplied links
with the URL parser:

```js
function safeHref(input) {
  try {
    const url = new URL(input, 'https://app.example.com');
    return ['https:', 'mailto:'].includes(url.protocol) ? url.href : '#';
  } catch {
    return '#';
  }
}
```

**Refs and effects.** `ref.current.innerHTML = ...` in an effect bypasses React
entirely, as does any jQuery or charting plugin that takes HTML strings for
tooltips.

## Server-rendered state

Server-rendered apps often hand initial data to the client in a script tag.
`JSON.stringify` does not escape `<`, so a user's bio containing
`</script><script>...` closes your script tag and opens theirs. Escape `<`
before embedding, or put the JSON in a `<script type="application/json">`
element and read it with `JSON.parse(el.textContent)`:

```js
const safe = JSON.stringify(state).replace(/</g, '\\u003c');
// {"bio":"</script><script>alert(1)</script>"}
```

Frameworks such as Next.js do this for you; hand-rolled Express templates do
not.

## Files and other people's markup

- **SVG uploads** can contain `<script>`. Serve user uploads from a separate
  domain (for example a storage bucket's own host) with
  `Content-Disposition: attachment` where possible, and set
  `X-Content-Type-Options: nosniff` so browsers do not guess types.
- **`postMessage` listeners** must check `event.origin` against an allowlist
  before touching the data.
- **Third-party widgets** run with your origin's privileges. Load them in a
  sandboxed `<iframe>` when you can.

## CSP: the backstop

A Content Security Policy tells the browser which scripts may run. The modern,
recommended form is a **strict, nonce-based** policy:

```http
Content-Security-Policy: script-src 'nonce-r4nd0mPerResponse' 'strict-dynamic'; object-src 'none'; base-uri 'none'
```

Each response generates a fresh random nonce and puts it on your own script
tags (`<script nonce="...">`). Injected scripts do not have it, so they do not
run, and `'strict-dynamic'` lets your trusted scripts load their own
dependencies. Allowlists of domains (`script-src cdn.example.com`) are weaker,
because many popular CDNs host something an attacker can abuse.

Roll out with `Content-Security-Policy-Report-Only` first, collect violation
reports, remove inline event handlers (`onclick="..."`), then enforce. CSP does
not fix the bug; it turns many XSS bugs from account takeover into a blocked
script and a report.

**Trusted Types** go a step further in browsers that support them:
`require-trusted-types-for 'script'` makes sinks such as `innerHTML` reject
plain strings, so only values from a sanitiser policy can reach them.

## Testing and finding XSS

- Unit test the helpers that matter: `safeHref`, the Markdown pipeline, the
  sanitiser configuration. Feed them the payloads from the OWASP XSS filter
  evasion cheat sheet.
- Add an integration test that stores `<img src=x onerror=alert(1)>` in every
  free-text field of a form, loads the page, and asserts nothing executed and
  the text is shown literally.
- Run a DAST scanner (OWASP ZAP) against a staging build, and let static
  analysis flag new sink usages in pull requests.

## What you should be able to answer

- React escapes interpolated values. Name three ways XSS can still happen in a
  React app.
- Why does output encoding depend on context? Give two contexts that need
  different handling.
- A user's session cookie is `HttpOnly`. What can an XSS payload still do?
- How would you render user-written Markdown safely?
- What is a nonce-based CSP, and why is it preferred to a list of allowed
  domains?
- How do you safely embed server data in a page for the client to read on load?
