# Design: should progress sync to a backend?

*Worked example of [templates/design-doc.md](../templates/design-doc.md).
The facts about the code are current as of 2026-09-24. The recommendation is
the author's argument, not a decision the repo has recorded. Case study
[05](../case-studies/05-local-first-progress-and-a-hand-rolled-store.md) owns
the analysis of the local-first choice; this doc shows the format applied to
it. Arc 3 invites you to write the counter-proposal.*

- Author: (worked example) · Date: 2026-09-24 · Status: In review
- Decision needed from: the repo owner · by: before any account or server
  work is scoped

## Problem

A learner who uses DevPath on a laptop and a phone has two unrelated
histories. A learner who clears site data, or whose browser evicts it, loses
their streak, their scheduling data and their ticks. Only a learner who
exported a file first can get them back. The question is whether that loss
is common and costly enough to justify running a server.

What is known: nothing about frequency. The app has no telemetry and no
server, by design. No loss has been reported, but the app gives nobody a
way to report one. This doc is about a risk, not an observed incident.

## Goals

- Decide whether to build sync now, later, or never, and record the trigger
  that would change the answer.
- If not now, reduce the cost of the loss that can happen today.

## Non-goals

- Accounts, social features, leaderboards.
- Syncing *content*. Content ships with the build.
- Replacing `localStorage` with IndexedDB. That is a separate question with
  no current pressure: a synthetic heavy profile (every one of the 1,043
  questions graded, 500 sessions, a year of activity, every step ticked)
  serialises to roughly 210–230 KB depending on the values you pick, against
  a quota measured in megabytes. Computed on 2026-09-24 by building that
  object in Node with the field names of `ProgressState` in `progress.ts`
  and measuring `JSON.stringify(state).length`.

## Current state

- All progress is one JSON document under `devpath.progress.v1` (schema
  `version: 2`), written by `commit()` in
  [app/src/lib/progress.ts](../../app/src/lib/progress.ts).
- Tabs in one browser stay consistent through a `storage` listener (F-05).
- A failed write sets `persisted = false`, and `Layout` shows a banner telling
  the learner to export.
- Settings offers export (a dated JSON download), import (validated by
  `parseImport`, including v1 files) and reset (behind `confirm`).
- The build is static: `HashRouter` and `base: './'` mean `dist/` runs from
  any static host or from disk. There is no server to extend.

## Proposal: don't build sync now; make export habitual

1. Show "last exported N days ago" on the Settings page and the Progress
   page. Store the export timestamp in the progress document; it is one
   field and needs a parser default.
2. After a milestone (a stage completed, or a 7-day streak), offer an export
   once with a single dismissible prompt.
3. Record the decision as Rejected-for-now, with the revisit triggers below.

Cost: about a day. No new dependency, no new failure mode, fully reversible.

## Alternatives

1. **Do nothing.** Free. The loss stays silent, and the only defence is a
   paragraph on the Settings page.
2. **A sync backend with accounts** (a small Node API and a database, or a
   hosted backend-as-a-service). This solves multi-device use and eviction.
   What it costs:
   - DevPath stops being a static site. Someone has to operate a server
     indefinitely, with uptime, backups, security patches and abuse
     handling.
   - Authentication, and a privacy policy, because learning history is
     personal data.
   - Conflict resolution. `steps` could merge per key, but `cards` holds
     scheduling state, where "last writer wins" can silently undo a review.
     That needs per-card merge rules, and tests for them.
   - It breaks the "open `dist/` from disk" property that `main.tsx`'s
     comment defends.
   - It collides with the hard constraint of no new frameworks, and with
     the time budget of a solo maintainer.
3. **File-based sync through the learner's own cloud folder** (export to a
   synced folder, import on the other device). No server. Still manual, and
   import *replaces* state rather than merging, so the two devices must take
   turns.
4. **URL-encoded state** (progress in a shareable link). No server. A
   200 KB payload doesn't fit in a URL, and the URL leaks the history to
   whatever it is pasted into.

## Why not now

- The target user is one person working through a curriculum, mostly on one
  machine: the path is built around projects you run locally. Multi-device
  is a nice-to-have for that person, not the core loop.
- Sync is a one-way door. Once people rely on it, turning it off loses their
  data. Export reminders are a two-way door.
- The whole reliability story of DevPath is "nothing to operate". The build
  refuses broken content, and nothing breaks at runtime because nothing
  runs anywhere but the learner's browser. Sync gives that up for a need
  nobody has measured.

## Risks and open questions

- How often do learners lose data today? Unknown, and unknowable without
  asking. Owner: repo owner. Cheapest probe: a line in the README asking
  people to open an issue if it happens to them.
- Will reminders be ignored? Probably, by some. Owner: whoever implements
  them. Measure by asking, not by tracking.
- Do mobile browsers evict `localStorage` for sites visited rarely? Behaviour
  differs by browser and changes over time. Owner: open; reproduce first.

## Rollout and reversal

Reminders ship in one PR behind no flag. Reversing them means deleting a UI
element and ignoring one field. `parseProgress` already drops unknown
fields, so older builds read newer files safely.

## Cost estimate

- Reminders: 0.5–1.5 days, assuming the timestamp lives in the progress
  document and needs no schema version bump.
- Sync: 3–6 weeks for one person to build. The high end assumes per-card
  conflict rules and an auth provider. Operating it has no end date.

## Revisit when

- three or more independent reports of lost progress, or
- a second maintainer who is willing to operate a server, or
- the path grows a phone-first activity, such as drills designed for
  commutes.
