# Review: `app/src/lib/markdown.ts` (working tree, 2026-09-24)

*Worked example of [templates/review-checklist.md](../templates/review-checklist.md),
applied to [app/src/lib/markdown.ts](../../app/src/lib/markdown.ts) as it
is now, as if the whole file were a new PR. The diff against `2220491`
(`git diff 2220491 -- app/src/lib/markdown.ts`) added `routePath`, one
shared and exported `slugify`, `createSlugger`, `headings()`,
`tableOfContents()`, `headingIds()`, `escapeAttr` and the
`content/modules/` → `#/guide/` mapping in `resolveHref`. Findings that are
already registered point at [loose-threads.md](../loose-threads.md) rather
than restating them.*

## Before reading the diff

- [x] **What is it for?** Render repo markdown so that relative links
      navigate the app, code is highlighted, and every TOC entry lands on its
      heading.
- [x] **Tested, with output?** `markdown.test.ts` has 7 tests, including
      "every TOC entry of every real doc lands on a rendered heading id",
      which runs over the real documents. `lib.test.ts` covers link
      rewriting.
- [ ] **Four commands?** Partly. `npm test` passed on 2026-09-24 (996
      tests), and `npm run build` ran the same day. I didn't re-run
      `npm run typecheck`. In a real review, ask the author for the output.
- [x] **Ran it:** by proxy. `app.nav.smoke.test.ts` "in-page anchors in the
      TS handbook stay inside the document" mounts the app, opens the TS
      handbook and clicks a contents link (F-07). A reviewer with the dev
      server running should click one by hand too.

## Correctness

Hand-run inputs through `resolveHref` with `baseDir: '27-memoize'` and
`routePath: '/doc/x.md'`:

| Input | Output |
|---|---|
| `''` | `#` |
| `#x` | `#/doc/x.md#x` |
| `//example.com/a` | `#/doc/27-memoize/example.com/a` |
| `javascript:alert(1)` | `#/doc/27-memoize/javascript:alert(1)` |
| `a.md#b#c` | `#/doc/27-memoize/a.md#b` |
| `HTTPS://x.y` | `HTTPS://x.y` |
| `../content/modules/sql-fundamentals.md#joins` | `#/guide/sql-fundamentals#joins` |

1. **question:** `resolveHref('')` returns `#`. Under `HashRouter`, `#` is
   the route `/`, so an empty link sends the reader to Today. Is that the
   intent, or should an empty href render as plain text? Cost: a confusing
   jump for a reader, only when a doc has a broken empty link.
2. **nit:** a protocol-relative `//host/path` becomes a doc route. No doc
   uses one today. If one appears, it fails as a NotFound in the app rather
   than as an external link. Worth one line in the doc comment.
3. **question:** `a.md#b#c` drops `#c`, because `split('#')` keeps only the
   first two parts. Harmless for real anchors. I'm noting it so the next
   reader doesn't wonder.
4. **Positive:** `javascript:` and other unknown schemes fall through to a
   doc route, so they are neutralised rather than rendered as live links.
   That is safer than an allow-list someone forgets to update. Please keep
   it, and a test would stop a well-meaning refactor removing it.

## Outside the diff

5. **Positive:** the `headingIds` doc comment says it is "used by the content
   build to validate anchors", and `git grep -n headingIds` now shows the
   caller in `scripts/build-content.mjs`. In the previous revision nothing
   called it, and this would have been the one blocking comment: a comment
   that promises a safety check which doesn't exist is worse than no comment
   (F-16 and F-17 in the register). Checking that a comment's claim has a
   caller is a habit worth keeping.
6. **suggestion:** `slugify` is exported, which makes it easy to bypass the
   per-document slugger, the mistake search used to make (F-18). Nothing in
   `app/src` or `scripts/` imports it today (`grep -rn slugify app/src
   scripts` finds only `markdown.ts`). Consider not exporting it, so `headings()` and
   `tableOfContents()` stay the only way to get an id.
7. **suggestion:** two regexes decide what a project folder is.
   `resolveHref` matches `(\d{2}-[a-z0-9-]+)` under a hard-coded
   `react|typescript|csharp` list. `discoverProjects` in
   `scripts/build-content.mjs` uses `PROJECT_DIR = /^(\d{2})-(.+)$/` and its
   own `TRACKS` array. Every current folder satisfies both (checked with
   `ls -d` over the four track roots). A folder named `07-Foo_Bar` would be
   discovered and indexed, but links to it would become `#/doc/07-Foo_Bar`,
   a NotFound. Cost: a silent broken link the first time someone breaks the
   naming convention. Consider deriving the regex from one shared list.
8. **question:** the renderer can't know whether a `#/doc/...` target was
   ever copied. Six real links point at directories that weren't (LT-04). Is
   validating links at build time, the house style of case study
   [01](../case-studies/01-fail-the-build-on-dangling-references.md), in
   scope for this file's owner, or does it belong to the pipeline?
9. **Persisted data:** none. This file writes nothing to `localStorage`.
   Heading ids do end up in bookmarks and in `read`-step anchors in
   `content/roadmap.json`, though. Changing `slugify` is a one-way door for
   those URLs, so say so in its doc comment.

## Tests

10. **suggestion:** no test pins `resolveHref`'s handling of `javascript:`
    (point 4) or `''` (point 1). Add both, so the behaviour is decided
    rather than accidental.
11. The real-document TOC test is the right kind of test: it fails on
    content changes as well as code changes. Keep it.

## Design

12. **nit:** `createMarked` builds a new `Marked` instance and slugger on
    every call. `DocView` and `FileView` memoise the result per document, so
    this costs nothing today. The slugger has to be per document, so leave
    it. I checked, so the next reviewer doesn't have to.
13. **question:** raw HTML in markdown passes through untouched, and the
    header comment records that as a trust decision. It holds while every
    rendered document comes from this repo. If `upskilling/` or any other
    contributor-written folder is ever rendered in the app (an Arc 3
    option), review becomes the only sanitiser. Is that written down
    anywhere a contributor would see it?

## Verdict

Approve. Nothing blocks: the one blocking point from the previous revision
(5) is fixed. Everything else is a suggestion, question or nit and can follow
in later PRs. Points 6 and 7 are worth registering in
[loose-threads.md](../loose-threads.md) if the author doesn't take them now.
