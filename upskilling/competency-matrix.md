# Competency matrix

Ten dimensions, three levels. Every cell describes something another person
could watch you do, or could read in something you produced. None of them is
an adjective. Wherever a senior cell sounds like a trait, it ends with "You
can see it when…" so that someone else can check it.

## How to use it

- **Self-assess every 30 days** (see the [cadence](README.md#the-cadence)).
  For each dimension, pick the column that describes what you *did* in the
  last 30 days, not what you could do.
- **Every claim needs a link**: a PR, a commit, a decision record in
  `decisions/`, a postmortem, a written review, or a journal entry. A claim
  with no link does not count, however true it feels.
- **A level is held when you have done it twice, unprompted.** Once can be
  luck. Doing it because a plan told you to still counts as evidence, but
  write down that it was prompted.
- **Expect to be uneven.** Most people are mid in six dimensions, junior in
  two and senior in two. The matrix is a map for choosing your next piece of
  work. It is not a scorecard.
- Real work to practise on is listed in [loose-threads.md](loose-threads.md).
  The "How to assess yourself" paragraphs below point at specific rows.

## 1. Technical depth

| Junior | Mid | Senior |
|---|---|---|
| Uses `useEffect`, `JSON.parse` and `localStorage` as the docs show. When something misbehaves, changes code until the symptom goes away. Can say what `progressStore.subscribe` does, but not why React needs `getSnapshot` to return the same object between changes. | Explains why `useSyncExternalStore` needs a stable snapshot (tearing, render loops). Reads a dependency's source or docs before asking. Knows the failure modes of the tools in use, such as `localStorage` throwing in private mode, which is why `commit()` in `progress.ts` catches. | Names the mechanism two layers below a symptom before changing code, and proves it with a test that fails first. Declines to dig deeper when the answer won't change the fix, and says so. Can teach the concept in ten minutes with a repo example. You can see it when a PR description explains *why* the bug happened in terms of the platform (React's double-invoked updaters, Node's test globs), not only what changed. |

**Evidence in this repo:** a PR that fixes a bug whose cause sits two layers
below the symptom, with the mechanism written in the description. The model
is the StrictMode double-grade (F-02 in [loose-threads.md](loose-threads.md);
told in full in [the postmortem example](examples/postmortem-strictmode-double-grade.md)).

**How to assess yourself in this repo.** Take `Countdown` and `answer` in
`app/src/routes/DrillSession.tsx`. Without reading the postmortem example,
write down why the old version, which called the expiry inside a `setLeft`
updater, graded twice only in development. Then read the example and compare.
If you got the mechanism (updater double-invoked, stale `chosen` in the
closure), you are at least mid here. If you would also have asked what else
in the app runs side effects inside updaters, and grepped for it, that is
the senior behaviour.

## 2. Design

| Junior | Mid | Senior |
|---|---|---|
| Adds code where the feature is needed. Copies the nearest existing pattern. Designs the happy path. | Separates deciding from doing: puts new logic in `app/src/lib/` as pure functions with tests, not inside a route component. Considers one alternative before coding. | Writes down at least two alternatives plus "do nothing", with what each costs, before coding. Asks what the likely next change does to the design ("what happens when someone inserts a step?"). Moves fast on two-way doors and slows down on one-way doors: storage keys, public URLs, content schemas. You can see it when a decision record exists *before* the PR, and a reviewer agrees its rejected options were real. |

**Evidence:** a decision record in `decisions/` with rejected options a
reviewer accepted as real options.

**How to assess yourself in this repo.** Read `stepKey` in
`app/src/lib/types.ts` and the [step-key decision
record](examples/decision-record-step-keys.md). Before you read the record's
Options section, list the options you would have considered for keying
progress. Two or more real ones plus "do nothing" is mid. Senior is seeing,
unprompted, that the key is persisted in every user's browser. That makes
changing it a one-way door, so it needs a migration and a rollback path
(`devpath.progress.v1.backup`).

## 3. Debugging

| Junior | Mid | Senior |
|---|---|---|
| Reproduces a bug when given the steps. Adds `console.log` widely. Stops when the symptom stops. | Follows the method in [debugging-playbook.md](../content/modules/debugging-playbook.md). Writes a failing test before the fix. Can bisect with `git bisect`. | Asks "why did nothing catch this?" and closes that detection gap as well as fixing the bug. Keeps the people affected informed while debugging. Reverts or mitigates first when the damage is ongoing, and investigates after. You can see it when a postmortem has a *detect* action item and a linked, merged PR for it. |

**Evidence:** a postmortem whose action items include a detect item, and the
merged PR that delivers it.

**How to assess yourself in this repo.** LT-13 is a detection gap: a step
whose `minutes` is the string `"30"` passes the build. If your instinct on
finding one such step is to fix that step, you are at mid. Senior is adding
the check to `validateRoadmap` so the next one fails the build, and asking
which other fields of `content/roadmap.json` nothing checks. The fixed row
F-16 (formerly LT-01) shows the same move made for `read`-step anchors.

## 4. Testing

| Junior | Mid | Senior |
|---|---|---|
| Writes tests after the code, for the happy path, when asked. | Writes the failing test first for bugs. Tests pure logic in the style of `app/src/lib/*.test.ts` and behaviour through the `app.*.smoke.test.ts` suites. Can explain why the smoke tests exist ("it builds is not it renders"). | Decides what *not* to test and writes down why. Notices when the suite itself is wrong: order dependence, shared state, tests that pass for the wrong reason, test counts that change with files on disk (F-19, formerly LT-06). Weighs a change to test infrastructure against its cost to every contributor. Reviews tests as closely as code. You can see it when a PR deletes or merges a test as well as adding one, with the reason written down. |

**Evidence:** a PR that removes or merges a test as well as adding one, or
one that fixes the test infrastructure, with the reasoning in the
description.

**How to assess yourself in this repo.** Clone the repo into a scratch
folder, run `npm ci` and then `npm test` without `npm run content`, and
explain every failure without looking at LT-07. Then read
`app/src/app.smoke.test.ts` next to `app/src/app.drill.smoke.test.ts`. Both
boot one app per file, but only the second resets route and progress in a
`beforeEach`. Write down which tests in the first depend on the order they
run in. Mid can answer the first question. Senior can answer both and say
which to fix first, and why.

## 5. Code review

| Junior | Mid | Senior |
|---|---|---|
| Approves, or leaves style nits. Reviews only the lines in the diff. | Runs the branch. Checks that tests cover the change. Separates blocking comments from nits. Reviews within one working day. | Reviews what the diff doesn't show: callers, data already persisted in users' `localStorage`, generated output, whether a file became unreviewable. Commit `2220491` shows `app/src/lib/lib.test.ts` as `Bin 0 -> 9209 bytes` (`git show --stat 2220491`), so its 25 tests were never visible in review (F-03). Asks questions instead of issuing orders. Approves with comments when what remains is small. You can see it when every blocking comment is explained in terms of cost to a user or a maintainer. |

**Evidence:** a written review using
[templates/review-checklist.md](templates/review-checklist.md) with at least
one finding outside the diff. See
[the markdown.ts example](examples/review-checklist-markdown-ts.md).

**How to assess yourself in this repo.** Review `resolveHref` in
`app/src/lib/markdown.ts` as if it were a new PR. If you find LT-04 (links to
directories that become `#/doc/<dir>` routes with nothing behind them), you
read the documents it runs over, not only the function. If you also write
down whether it should block, and why not, you labelled it the way a senior
would.

## 6. Communication

| Junior | Mid | Senior |
|---|---|---|
| Reports status when asked. PR descriptions say what changed. | PR descriptions say what, why and how it was tested. Raises blockers the same day. | Writes for the reader who wasn't in the room. Puts the bad news first. Turns a hallway decision into a written record. Matches length to the reader: three lines for a typo fix, a decision record for a storage-key change. You can see it when a peer acts on the PR description or record without asking a follow-up question. |

**Evidence:** one PR description and one decision record that a peer
understood without a follow-up question. Ask them, and record the answer.

**How to assess yourself in this repo.** Read commit `2220491`'s message
(`git show -s 2220491`). It is a good model: what, why, how it was verified,
what was removed and why. Now note what it lacks. It says "Tests: 2,552
passing" but not that one test file landed as a binary blob. Good messages
don't replace reading the stat line. Rewrite the message's "Tests" paragraph
as you would have written it. If your version would have caught the binary
file, you are reading your own diff the way a reviewer will.

## 7. Ownership

| Junior | Mid | Senior |
|---|---|---|
| Finishes assigned tasks. When the task is merged, it is done. | Follows the change to where users see it: runs `npm run build` and opens the result. Fixes bugs they introduced without being asked. | Notices problems nobody owns and either fixes them or makes sure someone does, with the scope deliberately limited. Leaves an area better than they found it without turning a fix into a rewrite. You can see it when an issue or PR exists for a problem nobody assigned, and its description says what it deliberately does *not* fix. |

**Evidence:** an issue or PR for an unassigned problem, with its scope
limited in writing.

**How to assess yourself in this repo.** F-17 and F-20 (formerly LT-02 and
LT-11) were both comments that had stopped matching the code, and F-11 was a
third. Nobody's task would have found them; someone reading for another
reason did. Count how many comment-versus-code disagreements you notice in
one hour of reading `app/src/lib/`, and log them in
[loose-threads.md](loose-threads.md). Mid notices them. Senior logs them,
fixes the cheap ones in a separate small PR, and leaves the rest registered
with an owner.

## 8. Estimation

| Junior | Mid | Senior |
|---|---|---|
| Gives one number, usually the time to write the code. Misses it silently. | Breaks the work into steps and estimates each one. Includes testing and review. Says early when an estimate is slipping. | Gives a range with its assumptions ("2–4 days; the high end is if the progress schema needs a version bump"). Spikes the riskiest unknown first. Tracks estimate against actual and knows their own multiplier. You can see it when the estimate log has a computed ratio and the next estimate visibly applies it. |

**Evidence:** the estimate-versus-actual rows from your weekly entries and
the ratio computed from them (Arc 3 of the [90-day plan](90-day-plan.md)).

**How to assess yourself in this repo.** Before you start LT-13, write a
range and your assumptions in your weekly entry. Include `npm run content`
time, the tests, and choosing between hand-written checks and a schema. Log
the actual. A gap over 2× with no written reason for it means the estimate
was a guess.

## 9. Mentoring

| Junior | Mid | Senior |
|---|---|---|
| Answers questions when asked. | Explains their own code so a peer can change it without asking again. Pairs when invited. | Makes others faster without doing their work: writes the guide, the checklist or the validation rule so the question stops being asked. In a pairing session, asks questions rather than taking the keyboard. Feedback names the file, the behaviour and its effect, and offers one next step. You can see it when someone else's work improved in a way they attribute to you, in writing. |

**Evidence:** a guide merged into `content/modules/`, or a written
walkthrough a newer learner followed, plus their written feedback.

**How to assess yourself in this repo.** The `check-questions.mjs` gate
(F-15) is mentoring at scale. It turned a reviewer's observation ("the long
answer is usually right") into a rule that teaches every future deck author.
List one question you have answered twice in the last month. If you turned
it into a guide section, a checklist line or a build check, that is the
senior behaviour.

## 10. Operating in ambiguity

| Junior | Mid | Senior |
|---|---|---|
| Waits for a clearer spec. Asks "what should I do?". | Asks clarifying questions, then proceeds on stated assumptions. | Turns a vague goal into a scoped problem with a reversible first step. Says what they don't know and how and when they will find out. Makes product-level cuts and writes the reason in one line. You can see it when a design doc's problem statement is sharper than the request that started it, and the requester agrees. |

**Evidence:** a design doc whose first section states the problem better than
the request did (Arc 3).

**How to assess yourself in this repo.** The `dsa/` track was added in
`6b5ff4c` (2026-08-31) and removed nine days later in `2220491`: 211 files
went, with a one-line reason in the commit message ("this path targets CRUD
interviews, not algorithm puzzles"). Read [case study
07](case-studies/07-deleting-the-dsa-track.md). Then take a vague request of
your own, "make DevPath useful after mid-level", and write its problem
statement in five sentences. If yours names a user, a constraint and a
non-goal, you are operating at senior level on this dimension.

## Recording a self-assessment

Copy this table into your journal entry for the week you assess:

| Dimension | Level (J/M/S) | Evidence link(s) | Next action |
|---|---|---|---|
| Technical depth | | | |
| Design | | | |
| Debugging | | | |
| Testing | | | |
| Code review | | | |
| Communication | | | |
| Ownership | | | |
| Estimation | | | |
| Mentoring | | | |
| Operating in ambiguity | | | |

Mark your two weakest dimensions. For each, name one row of
[loose-threads.md](loose-threads.md), or one deliverable in the
[90-day plan](90-day-plan.md), that exercises it in the next 30 days.
