# 03. HashRouter, and links rewritten at render time

Two decisions in `2220491` (2026-09-09) look independent and are not. The app
uses `HashRouter`, so the part of the URL after `#` belongs to the router. And
the app renders the repo's own markdown, whose links were written for GitHub.
Every bug in this case sits where those two decisions meet.

## The decision

**The router.** `app/src/main.tsx:10-18` wraps the app in `HashRouter`, with
the reason in a comment:

```tsx
// HashRouter rather than BrowserRouter on purpose: `npm run build` should
// produce a dist/ you can open from any static host — or straight off disk —
// without server-side rewrite rules.
```

`app/vite.config.ts:9` sets `base: './'` for the same reason. With
`BrowserRouter`, a deep link such as `/doc/HANDBOOK.md` needs the host to serve
`index.html` for every path. With a hash, the server only ever sees `/`. The
alternatives were `BrowserRouter` plus host rewrite rules, `BrowserRouter` plus
the GitHub Pages `404.html` trick, `MemoryRouter` (no shareable URLs at all),
or no router. The hash costs uglier URLs, no server-side rendering path, and
one thing that was not obvious on day one: the browser's own `#anchor`
behaviour is gone, because the hash is taken.

**The links.** `resolveHref()` in `app/src/lib/markdown.ts` rewrites links at
render time. A link like `../41-lru-cache/` inside a project README becomes
`#/project/js/41-lru-cache`; a `.md` link becomes `#/doc/...`. The 233 project
folders of the time stayed readable on GitHub and in the app, with no content
changes. The
alternatives were rewriting at build time in `build-content.mjs`, authoring
app-specific links, or accepting broken links in the app. The price is logic
that runs on every render, is coupled by regex to folder naming
(`/^\d{2}-[a-z0-9-]+$/`), and can only discover a bad link when someone clicks
it.

## What it hid

**Bare `#anchor` links went to NotFound.** In 2220491, `resolveHref` returned
any href starting with `#` unchanged (`git show 2220491:app/src/lib/markdown.ts |
sed -n 67p`). On GitHub, `[Types](#1-what-a-type-is)` scrolls the page. Under
`HashRouter`, the browser sets the hash to `#1-what-a-type-is`, the router
reads that as the route `/1-what-a-type-is`, and the catch-all
`<Route path="*">` (`App.tsx:55` today) renders NotFound. The TypeScript and
C# handbooks open with contents lists built from exactly these links: 19 in
`typescript/HANDBOOK.md`, 12 in `csharp/HANDBOOK.md`. Every one of the 31 led
to a "page not found".

**Two slug rules disagreed.** Headings got their `id` from the renderer, which
slugged marked's *HTML-escaped* inline output. The sidebar table of contents
got its ids from a regex over the *raw* markdown. For most headings the two
agree. For `## 12. The repo's big ideas` the renderer saw `repo&#39;s` and
produced `12-the-repo39s-big-ideas`, while the TOC produced
`12-the-repos-big-ideas`. Clicking that TOC entry did nothing, and the roadmap's
read step in `m-decide-vs-do`, which used the TOC form, opened the handbook at the
top. Duplicate headings were a second source of disagreement: neither path
de-duplicated, so two `## Setup` headings shared one id.

Neither bug shows up in a test that renders a document and checks for
output. Both need a test that knows what the *router* and the *other slug
path* will do with that output.

## How it was found

The plan for this journal flagged the anchor problem on 2026-09-23 as "verify
first": it looked wrong by reading, but nobody had clicked it. A refactor plan
written the same day verified both bugs by running the real `markdown.ts` over
every document with Node and counting: 31
bare anchors, and ids that did not match between TOC and heading. Its
adversarial review re-ran the slug comparison over the four handbooks and
corrected the count to one broken TOC entry there (the plan's "5 of 302" was
across all docs). The same review confirmed the anchor bug by router semantics
and suggested reproducing it in the jsdom smoke harness rather than a browser,
because a test can be re-run and a manual click cannot.

## What changed

`git diff 2220491 -- app/src/lib/markdown.ts app/src/routes/DocView.tsx`:

- `RenderOptions` gained `routePath` (`markdown.ts:19-28`), with a comment
  saying why. `resolveHref` now turns `#x` into `#<routePath>#x` when it knows
  the current route (`:107`). `DocView.tsx:21` computes the route and passes it
  in (`:34`). `markdown.test.ts:63-69` pins the rewrite, and `:71-77` renders
  the real TypeScript and C# handbooks and asserts no bare `href="#…"` survives.
  The register records this as [F-07](../loose-threads.md).
- One slug rule, one slugger. `slugify` (`:44-49`) runs on plain text:
  `plainText` strips tags and decodes the five entities marked emits
  (`:30-42`). `createSlugger` (`:52-60`) de-duplicates like GitHub (`-2`, `-3`).
  The renderer and a new `headings()` walker (`:148-171`) each create one per
  document, and `tableOfContents` is derived from `headings()`, so the two
  paths cannot disagree. `markdown.test.ts:29-40` checks every TOC entry of every
  real handbook and guide against the rendered ids ([F-08](../loose-threads.md)).
- A third slug path went the same way. Search used to build guide-section
  links by running `slugify` over the raw heading. The content build now
  writes each guide's heading ids into `guides.json` from `tableOfContents`,
  and `search.ts` uses them, so a search hit lands where the renderer put the
  id ([F-18](../loose-threads.md)).
- Repo-relative links to guides now work. A link such as
  `../content/modules/sql-fundamentals.md` in a project README used to become
  `#/doc/content/modules/…`, which was never copied. `resolveHref` now maps
  `content/modules/<id>.md` to `#/guide/<id>` (`:121-124`), and
  `markdown.test.ts:79` pins it.
- Two smaller fixes rode along: link `href` and `title` are attribute-escaped
  (`escapeAttr`, `:62-63`, used at `:87-88`), and the redundant `.md` branch,
  which returned the same thing as the fallback, is gone.
- `DocView` still does by hand what the browser can no longer do: an effect
  scrolls to the anchor once the document is on screen (`DocView.tsx:39-48`),
  and TOC links are built as `#${pathname}${search}#${id}` (`:82`).

The router decision itself has not changed, and should not have. What changed
is that its cost is now written into the code (`routePath`'s comment) instead
of being discovered by learners.

## Exercise

Render-time rewriting can only fail when someone clicks. This case owns
[LT-04](../loose-threads.md): links that work on GitHub and break in the app.
The count has moved three times. One scan on 2026-09-23 found four, a second
the next morning found seven, and after the `#/guide/` mapping above a scan
built on marked's lexer found six, all of them in the root `README.md`, all
links to directories (`react/`, `content/modules/` and so on) that become
`#/doc/react` and ask `DocView` to fetch a directory. The earlier scans also
reported false positives from link syntax inside inline code, which is its
own lesson about regex scans. A number that changes every time someone looks
is the reason to make the check part of the build.

Write the scan properly, in your scratch area rather than the repo, and
reproduce the six. Click one in the app with `npm run dev` running and record
what the learner sees. Then decide where the check belongs: build time (like
case [01](01-fail-the-build-on-dangling-references.md)), a test like
`markdown.test.ts:71`, or nowhere, and what should happen to a directory link
(map it to a Library filter, to the GitHub URL, or fail the build). Record the
decision in `../decisions/` with the count in it.

Done when: your scan reports six (or says why your number differs) with no
code-span false positives; the decision record gives that count, the command
that produced it and the date; if you chose to enforce it, a check on a branch
fails on today's `README.md` and goes green once the six links are fixed or
mapped; and the LT-04 row is updated with your count, or moved to the fixed
table if you fixed it.

Write in your journal: at what point this app should move to `BrowserRouter`,
and what it would cost the people who have already bookmarked `#/` URLs.
