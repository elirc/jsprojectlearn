# Postmortem: a timed-out drill question was graded twice in development

*Worked example, and a real one: F-02 in
[loose-threads.md](../loose-threads.md). Reconstructed from commit `2220491`,
the planning and review documents of 2026-09-23, and the fix in the working
tree on `feat/devpath-v2`. Case study
[06](../case-studies/06-it-builds-is-not-it-renders.md) owns the wider
lesson about what the test harness could see.*

- Date and duration: introduced 2026-09-09 (`2220491`); confirmed
  2026-09-23; fixed in the iteration of 2026-09-23/24. Latent for 14 days.
- Severity: low. Development builds only (`npm run dev`); production builds
  don't double-invoke updaters. Anyone developing or demoing locally with the
  timer on got corrupted scheduling data for every question that timed out.
- Author: (worked example) · Reviewed by: (your name, when you review it)
- Blameless: this document describes systems and decisions, not people.

## Summary

When a drill question's countdown reached zero under React's StrictMode, the
app graded it twice: two lapses, ease down 0.4 instead of 0.2, and two rows
in the session log. The expiry callback ran inside a state updater, which
StrictMode deliberately calls twice in development, and the guard meant to
stop a second grade read a stale value. The countdown now fires expiry from
the interval callback behind a once-ref, and a smoke test that mounts the app
under StrictMode checks for exactly one grade.

## Impact

In a development build, for each timed-out question:

- `gradeCard` ran twice, so the card recorded 2 lapses and ease fell by 0.4
  (floored at 1.3). The question came back sooner than it should have, in
  every later session, because scheduling data persists in `localStorage`.
- The question appeared twice in "What you missed", with React's
  duplicate-key warning.
- A 5-question drill with one timeout summarised as `n/6`.
- React logged "Cannot update a component (Session) while rendering a
  different component (Countdown)".

No production impact: StrictMode's double invocation is development-only.
There is no telemetry, so "no production impact" rests on React's documented
behaviour, not on observation.

## Timeline

- **2026-09-09**: commit `2220491` adds `Countdown` in
  `app/src/routes/DrillSession.tsx`. Each tick calls
  `setLeft((value) => { … expire.current(); return 0; })`, so the expiry
  runs inside the updater. `main.tsx` wraps the app in `StrictMode`. The
  smoke test mounts `HashRouter` and `App` *without* `StrictMode`.
- **2026-09-23**: the app-refactor plan lists "the countdown calls `onExpire`
  inside a `setState` updater" as issue 10, and reasons that StrictMode
  would grade twice. The upskilling-journal plan calls the same thing a
  "hypothesis to verify" in one section and states it as fact in another.
- **2026-09-23**: the adversarial reviewer of the journal plan runs an
  experiment instead of arguing. A standalone
  script mirrors `Countdown` and `answer`'s `chosen` guard, under React 19.3
  in development mode, jsdom, real timers, and no `act`. With StrictMode:
  the updater ran 4 times for 2 ticks, `onExpire` 2 times, the grade 2 times,
  and the log held 2 entries. Without StrictMode: 2 / 1 / 1 / 1. Verdict:
  **confirmed**. The app-refactor review then marks issue 10 as settled.
- **2026-09-23/24**: fix and regression test land (below).

## How it was detected

By reading, then by experiment, 14 days after it was introduced, and not by
any test. The existing smoke test could not have caught it, because it
mounted the app without `StrictMode`. The harness ran a different tree from
the one users got from `main.tsx`.

## Root cause and contributing factors

1. **Why was it graded twice?** `answer(-1)` ran twice.
2. **Why twice?** It was called from inside a `setLeft` updater. React may
   call updaters more than once, and StrictMode always does in development,
   to flush out exactly this. Updaters must be pure.
3. **Why didn't the guard stop the second call?** `answer` returned early if
   `chosen !== undefined`, but both calls closed over the same render's
   `chosen`, which was still `undefined`. The guard lived in React state, and
   state doesn't change inside one render's closure.
4. **Why did nothing catch it?** The smoke harness didn't mount under
   `StrictMode`, and no test let a timer expire.
5. **Contributing:** counting ticks inside the updater mixed "what time is
   it" with "what happens when time runs out". The deadline-free design also
   let a throttled background tab drift.

## What went well, what went badly, where we got lucky

- **Went well:** two independent readers flagged the same mechanism. The
  reviewer settled it with a 44-line experiment, with a control, instead of
  more argument.
- **Went badly:** one planning document stated a hypothesis as fact in one
  section and as unverified in another. A reader could have trusted either.
- **Lucky:** development-only. The same impurity in a code path that also
  misbehaves in production would have corrupted learners' data unseen, in
  browsers nobody can inspect.

## Action items

| Action | Type | Owner | Due | Link |
|---|---|---|---|---|
| `Countdown` counts against a fixed `deadline`; `onExpire` is called from the interval callback, never an updater, behind a `fired` ref, via `useEffectEvent` | prevent | app refactor | done | `Countdown` in [DrillSession.tsx](../../app/src/routes/DrillSession.tsx) |
| `answer` also guards with an `answeredIndex` ref, which is not stale inside a closure | prevent | app refactor | done | `answer` in the same file |
| The smoke harness mounts under `StrictMode`, like `main.tsx` | detect | app refactor | done | `boot` in `app/src/testing/harness.ts` |
| Regression test: "a timeout grades the question exactly once under StrictMode" | detect | app refactor | done | [app.drill.smoke.test.ts](../../app/src/app.drill.smoke.test.ts) |
| Add "side effects inside render or state updaters" to the review checklist | detect | journal | done | [review-checklist.md](../templates/review-checklist.md) |
| Search the rest of `app/src` for side effects inside updaters | detect | **open: yours** | Arc 2 | log the result in [loose-threads.md](../loose-threads.md) |

## What I learned

A guard stored in React state protects against a second *render*, not a
second *call within one render*. Guards against double execution belong in a
ref (`answeredIndex`, `fired`), or better, outside the updater altogether.
And a test harness that differs from production in one wrapper can hide a
whole class of bugs. Diff your harness against your real entry point.
