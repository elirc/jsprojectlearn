# Week 2026-W39

*Illustrative example. The finding, the fix and the tests are real, and are
in the working tree on `feat/devpath-v2` (F-01 in
[loose-threads.md](../loose-threads.md)). The timings, the "I" and the
reflections are invented to show what a good entry looks like.*

**Matrix dimensions exercised:** Debugging, Testing, Design

## What I shipped

- Fixed `#/drill/:deckId?count=abc` showing "Nothing due here" for a deck
  full of questions. All drill URL parsing now goes through one function,
  `parseDrillParams` in
  [app/src/lib/session.ts](../../app/src/lib/session.ts). A missing, empty
  or non-numeric `count` falls back to 15 (40 for a mock), and anything else
  is floored and clamped to 1–60 (`MAX_DRILL`).
  - How I know it works: `session.test.ts` "parseDrillParams clamps count:
    abc → default, 0/-5 → 1, 999 → 60" failed before the change and passes
    after it. `app.drill.smoke.test.ts` "a hand-typed count=abc falls back
    to a real session, not an empty one" mounts the app at
    `#/drill/js-fundamentals?count=abc` and asserts `1/15` on screen. All
    four commands passed on 2026-09-24.

## What I learned

The bug took three steps, each of them correct JavaScript on its own. In the
old `DrillSession` (commit `2220491`), `Number(params.get('count') ?? 15)`
turns `'abc'` into `NaN`. `Math.max(1, Math.min(NaN, 60))` is still `NaN`,
because every comparison with `NaN` loses. `buildDrill` then returns
`shuffled.slice(0, NaN)`, and `slice` treats `NaN` as 0, so the result is
`[]`. The empty-state screen then did its job and said nothing was due.

The part I would not have guessed: `Number('')` is `0`, not `NaN`. So
`?count=` (empty) slipped past a plain `Number.isFinite` check and would
have become a one-question drill. That is why `parseDrillParams` checks
`rawCount.trim() === ''` before converting. The test covers `count=` as its
own case.

I also learned why the question list lives in a `useState` initializer
("recomputing it as answers land would reshuffle the deck under the user's
feet"). Parsing the URL once per mount is only correct because `App.tsx`
keys the drill route per navigation. I had to read the comment above
`DrillRoute` to see that the two decisions depend on each other.

## What I'd do differently

I fixed the symptom first, then wrote the test, then had to break my fix on
purpose to watch the test fail. Next time the test comes first. The failing
run is the only proof the test can catch the bug.

## A decision I made and its trade-off

- Decision: parse and clamp every drill parameter in one pure function, and
  fall back to a sensible session instead of showing an error.
- Alternatives I rejected:
  - Guard inside `buildDrill` (`slice(0, count || 15)`). It fixes this
    symptom, but `buildMock` takes a count too, and every later consumer
    would need its own guard.
  - A new `EmptyDrill` reason, "that count isn't a number". Honest, but it
    punishes a hand-typed URL that has one obvious meaning.
- What I paid: a silent correction. Someone who typed `count=abc` gets 15
  questions and no explanation.
- Reversible? Two-way door: no URL or stored data changes shape.
- Worth a decision record? No. One sentence in the function's doc comment
  covers it, and it is there.

## A question I couldn't answer

Is 8 seconds a fair line between a "quick" and a "slow" correct answer? The
`count=abc` fix sent me through `scheduleCard` in `progress.ts`, where a
correct answer under 8 s scores quality 5 and anything slower scores 3.5,
which lowers ease by 0.065 (LT-09). That threshold is the same for a one-line
question and a twenty-line code snippet. I can't answer it from the data,
because a session stores its total `ms` and no card stores how long its own
answer took. Next: find where `answer` in `DrillSession.tsx` knows the
elapsed time, and write down what recording it per card would cost in the
stored schema. I'll do that on Tuesday before asking anyone.

## Estimate vs actual

| Task | Estimate low (h) | Estimate high (h) | Actual (h) | Why the gap |
|---|---|---|---|---|
| `count=abc` fix with tests | 0.5 | 1 | 2.5 | I suspected `buildDrill`'s sort first; `Number('')` cost another 40 minutes |
| Read `DrillSession` end to end | 1 | 1.5 | 1.5 | — |

## Next week

Answer the 8-second question with a cost estimate, and add what I find to the
LT-09 row.

---

Four weeks on: (to be added in W43)
