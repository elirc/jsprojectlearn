# 02. SM-2, trimmed for multiple choice

A spaced-repetition scheduler is the part of DevPath that decides what you see
tomorrow. It is also a small, readable algorithm with a published original, and
that makes it a good place to practise one senior habit: when you adapt
someone else's design, write down what you dropped and why, so the next reader
can tell an adaptation from a mistake.

## The decision

In `2220491` (2026-09-09) `gradeCard` in `app/src/lib/progress.ts` implemented
"SM-2, trimmed to what a multiple-choice drill can actually observe". Check
the original before you judge the trim. SuperMemo's description of SM-2
(<https://super-memory.com/english/ol/sm2.htm>, read on 2026-09-24) says:

- intervals are `I(1)=1`, `I(2)=6`, then `I(n)=I(n-1)*EF`;
- after each answer the ease factor becomes
  `EF + (0.1 - (5-q)*(0.08 + (5-q)*0.02))`, floored at 1.3;
- if the quality `q` is below 3, repetitions restart "without changing the
  E-Factor";
- after each day's session, items that scored below 4 are repeated until they
  score at least 4.

In SM-2 the learner grades their own recall from 0 to 5. DevPath cannot ask
for that. A multiple-choice question tests recognition, not recall, and asking
"how well did you know that?" after every click doubles the clicks. So the
author derived `q` from what the app can see: correct and under 8 seconds is 5,
correct and slower is 3.5, wrong is 1. The second interval became 3 days instead
of 6. A wrong answer resets `reps`, counts a lapse, sets the interval to 0 and
takes a flat 0.2 off ease. Selection lives in `session.ts` `priority()`: due
cards first (more overdue and more lapses go earlier), then unseen cards, then
everything else, weakest first.

Alternatives on the table were random order (no scheduler), Leitner boxes,
full SM-2 with self-grading buttons, FSRS, and plain accuracy weighting. The
trim bought a scheduler a learner can read in thirty lines with no extra
clicks. The cost was a crude quality signal. Eight seconds is the threshold
whether the question is one line or an eight-line code snippet.

## What it hid

Three things, none of them visible in a test run.

**A value computed and thrown away.** The 2220491 code opened with
`const quality = correct ? (quick ? 5 : 3.5) : 1;` and then branched on
`correct`. The wrong branch never read `quality`. The `1` was dead. TypeScript's
`noUnusedLocals` could not see it, because `quality` *was* used, in the other
branch. That matters for more than tidiness. The line says "a wrong answer is
q=1", and a reader who knows SM-2 then expects the formula to run at q=1. It
did not; the wrong branch applied its own flat −0.2.

**A deviation from the original that nobody wrote down.** Run the formula at
q=1 and you get −0.54. The journal review cited that number. The SuperMemo text
says something different again: below q=3 the ease factor does not change at
all. So DevPath is harsher than the source it cites (−0.2 per lapse, where
SM-2 says 0) and gentler than the formula applied naively. If you use an SM-2
library, check which reading it follows rather than assuming. The code picked a
third option and did not say so.

**A comment that promised more than the code did.** The old comment read
`interval 0 means "again this session" — due immediately`. `DrillSession` fixed
its question list in a `useState` initialiser when the session started. A
missed card became due at once, but it came back in the *next* drill, not this
one. SM-2's "repeat until q ≥ 4 today" rule had quietly been dropped, and the
comment still described it.

## How it was found

The plan for this journal (2026-09-23) spotted the comment mismatch by reading
`DrillSession` next to `gradeCard`. The adversarial review
of that plan recomputed every constant by hand
(0.1 − 1.5·(0.08 + 1.5·0.02) = −0.065 for a slow correct answer) and, while
doing the arithmetic, noticed that `quality = 1` was never read. Nobody found
this with a test. It was found by someone doing the maths on paper and asking
why a number existed.

## What changed

Run `git diff 2220491 -- app/src/lib/progress.ts` and read the scheduler section.

- The maths moved into a pure function, `scheduleCard(prev, correct,
  elapsedMs, now)` (`progress.ts:495-536`). `gradeCard` (`:538-549`) is now a
  thin store wrapper that supplies `Date.now()` and also advances the streak
  and the day's activity. Pure means testable with an injected clock, and
  `progress.test.ts` now tests the first three intervals, the 8-second
  boundary and the lapse path.
- `quality` is declared inside the correct branch only
  (`const quality = quick ? 5 : 3.5;`, `:512`). The dead `1` is gone. The
  wrong branch (`:518-523`) is unchanged: flat −0.2, floored at 1.3.
- The comment now says what the code does:
  `// interval 0 means "due now": the next drill serves it first.` (`:528`).
  The behaviour was not changed to match the old comment. Instead the drill
  summary gained a "Drill these N again" button (`DrillSession.tsx`), which
  gives a learner SM-2's same-day repeat as an explicit choice rather than an
  automatic loop.

So the "computed-then-unused" thread is closed. The code no longer claims a
wrong answer is q=1. What it still does not do is say *why* a lapse costs 0.2
when the original says 0, and nothing records why the second interval is 3
days. Those two deviations are deliberate-looking and undocumented. That is the
state in which the next contributor "fixes" them back to SM-2 and changes
every learner's schedule without meaning to.

## What a junior, a mid and a senior would each have done

**Junior.** Implements SM-2 from a blog post, keeps the 6-day interval
because the post had it, and adds a 0–5 self-grade prompt because the post
had that too. It is correct, and learners hate it by day three because every
question now needs two clicks.

**Mid.** Sees that MCQ cannot supply recall grades, derives `q` from
correctness and time, and shortens the second interval because a job-hunting
learner cannot wait six days. The mid writes good tests for the result. The
mid does not write down which parts of SM-2 were dropped, because the code
"is the documentation".

**Senior.** Makes the same trims and adds a short table to the file's header
or to a decision record: *kept* (the ease formula for correct answers, the
1.3 floor), *changed* (second interval 6 → 3 days, lapse −0.2 instead of 0,
q from time rather than self-grade), *dropped* (self-grading, same-session
repeat until q ≥ 4). Each row gets one line of why. They link the primary
source and say what they checked in it. Then, because 8 seconds is a guess,
they say what data would change it: median answer time per question length,
which the app does not record yet: a session stores its total `ms`, but no
card stores how long its answer took. The first step is to record it.

## Exercise

Take [LT-09](../loose-threads.md), the scheduler's constants: the lapse penalty,
the slow-correct penalty and the 3-day interval deviate from SM-2 without a
recorded reason. Decide whether to keep them, and write the decision record the
original change should have had, using [the
template](../templates/decision-record.md), in `../decisions/`. Include the
kept/changed/dropped table from the senior paragraph and cite the SuperMemo
page. If you decide to change behaviour (for example, leave ease unchanged on a
lapse, as SM-2 does), make the change in `scheduleCard` on a branch.

Done when: the record exists in `../decisions/` with status Accepted or
Rejected; `scheduleCard` has a one-line comment pointing at it; and
the lapse test in `app/src/lib/progress.test.ts` (it currently asserts
`card.ease === 2.3` after one miss) pins the behaviour you chose and names
your record in its assertion message, so that "fixing it back to SM-2" fails
a test and sends the next person to the reason. `npm test` passes.

Write in your journal: one place in your own code where you adapted a known
algorithm or pattern, and what a reader would have to guess about it today.
