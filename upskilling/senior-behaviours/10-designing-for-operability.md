# Designing for operability

**When production is other people's browsers, you cannot watch it, so you
design the app to fail loudly before it ships, to fail recoverably after, and
to let a user hand you what you need to help them. Operability is a design
property you add up front, not a dashboard you attach later.**

[Chapter 06](06-debugging-production.md) is about owning an incident when it
happens. This chapter is about the decisions, made months earlier, that
decide whether you can do anything when it does.

## Know what the app can know

Start by listing what you will be able to observe. For DevPath the list is
short, by design. The app is static files; everything a learner does lives in
their own `localStorage`, and Settings tells them "Nothing is uploaded
anywhere" ([Settings.tsx](../../app/src/routes/Settings.tsx), line 69). There
is no telemetry, no error reporting service and no server log.

That rules out the usual answer, "add monitoring", and forces better ones.
What you can know about a failure is: what the build refused to ship, what
the user sees on screen, and what the user can export and send you. Design
all three on purpose.

## The build is the monitoring

When you cannot see production, detection moves to before production.
`validateRoadmap` in [build-content.mjs](../../scripts/build-content.mjs)
(line 283) collects every broken reference and fails the build
([case study 01](../case-studies/01-fail-the-build-on-dangling-references.md)).
The question-bank gate `checkQuestions` runs inside the same build (imported
at line 24). CI runs content, typecheck, lint, test and build on every pull
request ([ci.yml](../../.github/workflows/ci.yml)).

Every class of mistake the build does not reject is a class of mistake that
reaches users silently. The Open table of
[loose-threads.md](../loose-threads.md) is the current list of such gaps;
LT-13, for example, records that a step's `title` and `minutes` are not
checked, so a typo there reaches the app. Closing a row like that is
operability work, even though it touches no runtime code. Watch how the
register changes: `read` steps were unvalidated when it was first written,
and later on 2026-09-24 `validateRoadmap` began checking them: a missing
doc or an anchor that is not a heading now fails the build (lines 317–323;
F-16, formerly LT-01).

## Version what you store, and keep a way back

Stored data outlives the code that wrote it. Three rules, all visible in
[progress.ts](../../app/src/lib/progress.ts):

- **Version inside the payload.** The storage key keeps its v1 name on
  purpose, "renaming it would orphan every existing profile", and the schema
  version lives in the data (lines 14–16, `version: 2` at line 78).
- **Migrate on read, shape-only.** `migrate` (line 260) needs no content, so
  it runs before anything is fetched. `parseImport` refuses a file from a
  newer version rather than guessing (line 302).
- **Back up before you rewrite.** The raw v1 payload is copied to
  `devpath.progress.v1.backup` before the migrated state is written back,
  and an unreadable payload is kept under `devpath.progress.corrupt-<ms>`
  (`read`, lines 311–350). A bug in the migration then costs a user a manual
  restore, not their history.

The analysis of merge-on-read lives in
[case study 08](../case-studies/08-merge-on-read-schema-evolution.md). The
open gap: nothing in the app reads those backups back (LT-10). A backup
only a developer with devtools can restore is half a rollback path.

## Fail visibly, recoverably and in part

Design each failure so the user sees what happened, can retry, and keeps
everything that still works.

- **Content fails to load.** The whole tree waits on one load
  ([ContentGate.tsx](../../app/src/components/ContentGate.tsx)). On error it
  says whether the page was opened off disk (line 22) and offers Retry (line
  40). Retry works because `loadContent` never caches a failed promise
  ([content.ts](../../app/src/lib/content.ts), lines 34–37).
- **A document is missing.** A static host's SPA fallback answers a missing
  file with `index.html` and a 200. `loadDoc` treats that as not found
  instead of rendering a web page as a document (content.ts, lines 46–51).
- **A screen throws.** Two error boundaries: one around the app, and one per
  route keyed on the pathname
  ([Layout.tsx](../../app/src/components/Layout.tsx), line 128), so one broken
  screen leaves the navigation working. The fallback offers Try again, Back
  to Today and Reload, and imports nothing from the app, because "a fallback
  that can itself throw is no fallback"
  ([ErrorBoundary.tsx](../../app/src/components/ErrorBoundary.tsx), lines
  8–13).
- **Storage is blocked or full.** `commit` catches the write failure (lines
  359–371) and Layout shows a one-line warning to export a copy before
  closing the tab (Layout.tsx, lines 122–127). The session keeps working;
  the user is not misled about whether it is saved.

## The export as a support bundle

When a user reports a problem, the most useful thing they can send is their
export: Settings downloads the whole state (`exportState`, progress.ts line
577). As a support bundle it has two weaknesses. It contains the learner's
free-text notes, which they may not want to send. It also lacks context a
support bundle needs: which build produced it (`stats.generatedAt` is shown
on Settings, line 203, but not written into the file), whether storage is
persisting, and the last error the error boundary caught. The design
analysis of local-first progress is in
[case study 05](../case-studies/05-local-first-progress-and-a-hand-rolled-store.md).

## What this looks like in DevPath

Put together, DevPath's operability design is: reject what you can at build
time; version and back up what you store; make every runtime failure visible
with a retry; and let the user carry their state out. Each piece is small. The
senior behaviour is deciding them before the first incident, because after
it the data in thousands of browsers already has whatever shape you gave it.

## Common failure modes

- "We'll add monitoring later", in a product where there is nowhere to send
  it.
- A schema change with no version field, so the next migration has to guess
  what it is reading.
- A migration that overwrites the only copy.
- One error boundary around everything, so a bug in one screen takes out
  navigation too.
- A support path that needs the user to open devtools.

## Exercise

Add a support bundle to the app, on a branch, through a PR.

1. Write a pure function in `app/src/lib/` that builds a diagnostics object
   from the current state and content: schema version, `stats.generatedAt`,
   counts of steps, cards, sessions and notes, `progressStore.isPersisted()`,
   the user agent, and whether the v1 backup and any `corrupt-` keys exist.
   It must not include note text or card ids.
2. Offer "Copy diagnostics" on Settings and in the error boundary's
   fallback, with the error message included there. Keep the fallback free
   of app imports that could throw; decide how, and say why in the PR.
3. Unit-test the function, and add a smoke test that triggers the boundary
   and finds the button.

Done when the PR passes `npm run content`, `npm run typecheck`, `npm test`
and `npm run build`, a test proves the bundle contains the schema version and
build stamp and contains no note text, and the PR description says what a
maintainer can diagnose from it that they could not before. If you choose
LT-10 instead (a restore button for the v1 backup), the same "done when"
applies to its PR, and the row moves to the fixed table in
[loose-threads.md](../loose-threads.md).

Write in your journal: name one failure a learner could hit today that your
bundle would still not let you diagnose.
