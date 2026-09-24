# Running a code review

**A senior review is judged by what it finds outside the lines that changed:
callers, data already stored in users' browsers, generated output, and
whether the diff can be reviewed at all. Line-by-line reading comes last,
because by then you know where to aim it.**

A junior reviews the lines in the diff. A mid-level reviewer runs the branch
and checks the tests. Both are necessary and neither is the senior part. The
senior part is the finding the author could not have seen from inside the
change, and a comment that prices it as a cost to a user or a maintainer.

The checklist is [templates/review-checklist.md](../templates/review-checklist.md).
A worked application of it to `markdown.ts` is
[examples/review-checklist-markdown-ts.md](../examples/review-checklist-markdown-ts.md).
This chapter is about the order and the habits around the checklist.

## The order: context, run it, outside the diff, then the diff

Read the description first and write down, in one line, what the change is
for. If you can't, that is your first comment, and it blocks.

Then run it. Check out the branch, run the four commands (`npm run content`,
`npm run typecheck`, `npm test`, `npm run build`) and use the feature. Ten
minutes in the running app finds things no amount of reading will.

Then look outside the diff. Who calls the changed functions? What happens to
data written by the previous version? Does the stat line show anything odd,
such as a file shown as binary, or a 900-line file nobody can review?

Only then read the diff line by line. By now you know what it is for, you
have seen it work or fail, and you know where it touches the rest of the
system, so the line-level reading is faster and better aimed.

## Label every comment

Prefix every comment with its weight: `blocking:`, `suggestion:`,
`question:` or `nit:`. The author then knows what must change before merge
and what is your taste. Explain each blocking comment as a cost to a user or
a maintainer, and offer an alternative. "blocking: an imported file with only
`{seconds: 30}` leaves `maxLevel` undefined, so every drill renders empty
until reload. Could `parseSettings` default each field on its own?" is
actionable. "This looks fragile" is not.

Ask rather than order when you might be missing context. "question: why is
this in the component rather than `lib/`?" invites a reason you had not
thought of.

## What only an outside-the-diff review catches

Commit `2220491` added `app/src/lib/lib.test.ts` with a literal NUL
character inside a test string. Git treats any file with a NUL byte near its
start as binary, so the commit's stat line showed `Bin 0 -> 9209 bytes`, and
any pull request view would have said "binary file not shown". The file's 25
tests could not have been reviewed by anyone reading the diff. The only way
to catch it was to look at the stat line and ask why a `.ts` file was binary.
It is fixed now (F-03 in [loose-threads.md](../loose-threads.md)); the check
that would stop it happening again is still open work.

A second example: in development, a timed-out drill question was graded
twice. No reader of the diff would have seen it. The adversarial reviewer of
this journal's plan ran an experiment instead: a jsdom probe under React 19.3
in development mode, with real timers and no `act`, mirroring `Countdown` and
its `answer` guard. It showed the state updater running twice, the `chosen`
guard reading a stale closure, and `gradeCard` running twice. That is
"run it" at its most useful: a hypothesis turned into evidence before anyone
argued about it. The fix is `Countdown` in
[DrillSession.tsx](../../app/src/routes/DrillSession.tsx) (lines 416–464),
which calls `onExpire` from the interval callback behind a once-ref (F-02).

## Reviewing tests

Review tests as closely as code. For each test, ask: does it fail without the
change? If you revert the fix and the test still passes, it tests nothing.
Check what the test shares with others (a mounted app, `localStorage`) and
whether it depends on the order it runs in. Check what it reads from disk:
some tests here read generated content and fail on a fresh clone until
`npm run content` has run (LT-07).

## Turnaround and being reviewed

Review turnaround is a team responsibility. A PR waiting two days costs the
author context and invites a larger, harder-to-review follow-up. Aim to give
a first pass within one working day, even if it is only "I've run it; full
review tomorrow".

When you are the author, answer every comment, with a change or a reason.
Resolve nothing silently. Say thank you for the findings that hurt, because
those are the ones that saved you.

## What this looks like in DevPath

The review round on 2026-09-23 ran this order on the whole repo. The
reviewers ran scripts against the content instead of trusting the plans'
numbers, and several plan claims changed as a result. One plan said a
feature (rendering backticks in question text) "affects 340 of 450
questions"; the reviewer's count of distinct questions was 240, because 340
was a sum of per-field hits. You can repeat the count against the decks as
they were in `2220491`: loop over `git ls-tree --name-only 2220491
content/questions/`, read each file with `git show`, and count questions with
a backtick in `q`, any choice, `why` or `asked`. That is a reviewer checking
the number rather than the prose.

## Common failure modes

- You review only the diff and approve a change that breaks data already in
  users' browsers.
- You never run the branch. The bug is visible in the first ten seconds of
  using the feature.
- Every comment has the same weight, so the author cannot tell the blocking
  finding from your naming preference.
- You rewrite the change in comments instead of asking why it was done that
  way.
- The review sits for three days, and the author merges to unblock
  themselves.

## Exercise

Review [plan.ts](../../app/src/lib/plan.ts) and
[plan.test.ts](../../app/src/lib/plan.test.ts) as if they were a new pull
request, using [the checklist](../templates/review-checklist.md). No case
study dissects this file, so the findings are yours to find.

1. Write the one-line purpose before reading the code.
2. Run the four commands and use Today on the dashboard with a fresh profile
   and with an imported one.
3. Outside the diff: find every caller of `todayPlan` (start at
   [Dashboard.tsx](../../app/src/routes/Dashboard.tsx), line 53), and work out
   what a profile migrated from v1 contains in `activity` (see `migrate` in
   [progress.ts](../../app/src/lib/progress.ts), line 260), then check what
   `todayPlan` does with it.
4. For at least two tests, revert or break the code they cover and record
   whether they fail.

Done when the review is written as a PR review or in `journal/`, with at
least six labelled comments, at least one finding outside the two files, and
at least one test you proved fails without the code it covers. Any verified
defect goes into [loose-threads.md](../loose-threads.md) as a new `LT-` row,
following its "Adding a finding" rules.

Write in your journal: which finding would you have missed if you had read
only the diff?
