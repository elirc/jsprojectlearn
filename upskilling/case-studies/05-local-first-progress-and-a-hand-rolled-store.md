# 05. Local-first progress and a hand-rolled store

This case joins two decisions that the code joins too. DevPath keeps all of a
learner's progress in their own browser, with no backend. And it reaches that
data through a small hand-written store rather than a state library. The
first is a product decision wearing technical clothes. The second is a
technical decision with a teaching motive. Both hid the same bug.

## The decision

**No backend.** In `2220491` (2026-09-09) every tick, card, session, streak
and setting lived under one `localStorage` key, `devpath.progress.v1`.
`Settings.tsx` offered export (a JSON download), import, and reset behind a
`confirm`. The alternatives were a backend with accounts, IndexedDB, a hosted
sync service, or state encoded in the URL. Local-first bought a lot: no
servers to run, no authentication, no personal data leaving the machine, no
privacy policy, and it works offline and off disk (case
[03](03-hashrouter-and-links-at-render-time.md) explains why that last part
mattered). The price: no cross-device progress, data lost when the learner
clears site data, and no recovery for anyone who never exported.

Ask who the user is before you judge that. A self-taught learner working
through a curriculum on one laptop loses a streak if the data goes. A
bootcamp with forty learners and an instructor who wants a dashboard loses a
product. DevPath was built for the first.

**A hand-rolled store.** `progress.ts` held module-level `state`, a `Set` of
listeners and a `commit()` that wrote through to `localStorage` and notified.
`useProgress()` in `app/src/lib/hooks.ts:6-8` subscribes with React's
`useSyncExternalStore`. The file's header says why it is not Zustand or
Redux: "this file is the worked example for react/41-mini-store and
react/51-use-sync-external-store". The repo teaches the pattern, so the app
uses it. Redux Toolkit was ruled out by the stack rule the repo owner set for
this work (keep the stack, no Redux); Context
plus `useReducer`, Zustand, and a signals library were not, and would each
have added either a dependency or a re-render model the learner had not met
yet. The store costs no devtools, no selectors (every subscriber re-renders on
every commit), and state read once at import time.

## What it hid

**Two tabs overwrote each other.** `state` was read once when the module
loaded. Nothing listened for the browser's `storage` event, which fires in
*other* tabs when one tab writes. So with DevPath open in two tabs, each held
its own copy, and every `commit()` wrote its whole copy back. Tick three steps
in tab A, answer a drill in tab B, and B's write erased A's ticks. Nothing
failed and nothing was logged; the ticks had vanished by the next time either
tab loaded. A learner who reads a guide in one tab and drills in another hits
exactly this. A single-user, single-device product still has concurrency.

**Failures were silent.** `commit()` swallowed storage errors on purpose
("not worth interrupting the user"). In private browsing, on a full quota, or
with site data blocked, the app worked all session and remembered nothing. The
learner saw a streak that was not being saved.

**Import trusted its input.** `importState` spread a parsed file over the
defaults without validating it. Case
[08](08-merge-on-read-schema-evolution.md) owns that story; here, note only
that the one entry point where data arrives from outside the app was the one
with the least checking.

## How it was found

The two-tab overwrite was found by reading. A refactor plan written on
2026-09-23 listed it under "Multi-tab" with the
mechanism: two module-level states, last writer wins for the whole object. The
journal review confirmed the absence the fastest way possible,
`grep -rn "'storage'" app/src` returning nothing, and added the reason it
matters: `commit()` writes the whole object, so the loss is not limited to the
key that changed. Nobody had reported it. In a product with no telemetry, a
bug that silently loses data will not be reported; it will be experienced as
"I thought I'd done that".

## What changed

`git diff 2220491 -- app/src/lib/progress.ts app/src/routes/Settings.tsx`:

- A `storage` listener (`progress.ts:373-382`) re-reads storage and notifies
  subscribers when another tab writes the progress key. The comment above it
  describes the failure it prevents. `app.nav.smoke.test.ts:94-102` writes a
  state as "another tab" would, dispatches the event, and asserts this tab sees
  the new tick.
- `commit()` (`:359-371`) still does not throw, but records `persisted`, and
  `progressStore.isPersisted()` (`:393-395`) lets `Layout.tsx:122-127` show a
  one-line alert. The old comment's "not worth interrupting the user" became
  "so nobody trusts a streak that is not being saved". The trade-off is the
  same; the answer changed because someone asked what the user loses.
- Everything that reaches `state` now goes through
  `parseProgress(migrate(raw))`, whether from this tab, another tab, or an
  imported file (header, `:8-10`). `Settings.tsx` caps imports at 5 MB
  (`:9`), parses with `parseImport`, and asks for confirmation with a summary
  of both the file and the current state before replacing anything
  (`:41-62`).
- Two test seams, `replaceForTests` and `reloadForTests` (`:396-404`), let the
  smoke suites reset the store between tests instead of depending on test
  order (case [06](06-it-builds-is-not-it-renders.md)).

The store is still hand-rolled and still small. The decision survived review;
the gaps around it did not.

## Exercise

Both findings this case touches are fixed in the register
([F-05 and F-04](../loose-threads.md)). What is left is the design decision
that never had a document: progress lives in one browser, permanently, and
someone will ask for sync. The `storage` listener narrows the two-tab window
but cannot close it, because the event arrives after the other tab's write,
and a tab that commits in that gap still writes its whole stale copy. A sync
service has the same problem across devices, with minutes instead of
milliseconds between writes.

Write the design doc for "optional sync" using
[the design-doc template](../templates/design-doc.md), and make its centre the
section that argues **against** building it now. Put in: who asked and what
they lose today; the smallest alternative (for example, a reminder to export
weekly, or export on every streak milestone); what sync would cost in
operations, authentication, privacy and conflict resolution for a solo
maintainer; and what evidence would change your mind. Read the worked example,
[design-doc-sync-vs-local.md](../examples/design-doc-sync-vs-local.md), only
after you have a draft, and compare.
Chapter [03](../senior-behaviours/03-saying-no.md) covers how to say no in
writing; chapter [04](../senior-behaviours/04-writing-a-design-doc.md) covers
the doc itself.

Done when: the doc is in `../decisions/` with status Proposed or Rejected; it
fits on two pages; the "against" section names at least three concrete costs,
each tied to a file or a service you would have to add; it states the reversal
condition as a signal you could actually observe (the app has no telemetry, so
"N users a week" is not observable, while "three separate learners asked in the
issue tracker" or "a named cohort needs an instructor view" is); and someone
other than you, or you after 48 hours with [the review
checklist](../templates/review-checklist.md), has reviewed it and the review is
linked.

Write in your journal: a product decision you have seen disguised as a
technical one, and who should have made it.
