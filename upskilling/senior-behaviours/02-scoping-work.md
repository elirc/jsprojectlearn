# Scoping work

**Scoping is choosing what not to do, and saying so in writing before you
start. A scope with no non-goals is a wish, and a wish grows until it misses
its date.**

A mid-level developer scopes the task they were handed: they split it,
estimate it and ship it. A senior scopes the problem behind the task. They
check whether the request is the right answer, find the riskiest assumption
(in DevPath, usually data already stored in browsers) and test it first, and
publish the non-goals before anyone starts, so a cut is a decision the
requester saw rather than a surprise in the demo.

## Restate the problem in the user's terms

Requests arrive as solutions: "add a chart", "add a setting", "add a goal".
Rewrite each one as the problem a user has, in one sentence with a person in
it. "Add a weekly hours budget" becomes "a learner with six hours a week
cannot tell whether today's plan fits in the time they have."

The restatement is where you find out whether the request is the right
answer. It also gives you the test for every later cut: does this piece help
that person with that problem?

## Find the smallest thing that proves the approach

Before slicing, ask which assumption would kill the whole idea if it were
wrong, and test it first. That is a spike or a tracer: a thin path through
every layer, thrown away or kept, but built to answer one question.

In DevPath the riskiest assumption is usually about data already sitting in
learners' browsers, not about the UI. Any feature that stores something new
touches `ProgressState` in [progress.ts](../../app/src/lib/progress.ts)
(lines 77–91), and a schema change needs a migration, a parser and tests. A
spike that answers "does this need a new stored field?" costs an hour and can
change the estimate by a day.

## Non-goals are a first-class list

Write the non-goals before the goals feel finished. A non-goal is something a
reasonable person would expect to be included, deliberately left out, with
one line of reason. "No mobile layout" is a non-goal. "No blockchain" is not,
because nobody expected it.

Non-goals do three jobs. They stop scope creep in review ("that's listed as a
non-goal; open an issue"). They make the estimate honest. They record a
product decision that someone would otherwise have to reconstruct later.

## Slice so each slice ships

Cut the work so every slice is usable on its own and could be the last one.
Slices by layer ("first the store, then the UI") ship nothing until the end.
Slices by behaviour ("reviews only, then new cards, then the budget") ship
something each time, and let you stop when the value runs out.

The test: if you were told to stop after this slice, would users be better
off than before it? If not, it is a task, not a slice.

## What this looks like in DevPath

The Today plan is the worked example. The UX plan for this iteration proposed
a plan with reviews, new cards, a weekly hours budget, onboarding questions
about goals and hours, and a week bar. The UX review cut it to two rows and a
lede. What shipped is `todayPlan` in [plan.ts](../../app/src/lib/plan.ts)
(line 62): reviews due, new questions capped by `newPerDay`, the next path
step and a days-away count.

The budget was cut for a reason you can still read in the code. It needed
minutes, and minutes in DevPath meant two different things: time measured
while answering, and the roadmap's estimated `minutes` per step. The comment
on `DayActivity` in `progress.ts` (lines 64–68) records the decision: "a
number that means two things means nothing." That is a non-goal written where
the next person to propose a budget will find it.

Each slice shipped on its own. `newPerDay` is a Settings select with a
default of 10 ([Settings.tsx](../../app/src/routes/Settings.tsx), line 113),
with no onboarding needed. Onboarding goals and weekly hours were left out
because they only fed the budget.

A larger scope decision is the removal of the `dsa/` track: 211 files, nine
days after they were added, because they did not serve the stated target
role. [Case study 07](../case-studies/07-deleting-the-dsa-track.md) owns that
analysis. The behaviour to copy is that the reason fitted in one line of the
commit message.

## Common failure modes

- You start from the requested solution and never write the problem, so
  every later cut feels like a loss instead of a choice.
- The non-goals list is empty, or lists things nobody wanted. Reviewers then
  add scope one comment at a time.
- You slice by layer. Three weeks in, nothing is usable, and stopping early
  means throwing work away.
- You spike the easy part (the UI) and leave the risky part (stored data,
  migration) for the end, where it doubles the estimate.
- You cut scope silently. The requester finds out at the demo.

## Exercise

Take the request "add a daily goal to the dashboard". It is a journal
exercise; no code is needed. The senior part is step 3: finding, before any
design, whether the smallest useful version has to change what is stored in
every learner's browser.

1. Restate it as a user problem in one sentence with a person in it.
2. Write three scopes, S, M and L. For each: the goal, at least three
   non-goals with a one-line reason each, and the files it touches. Start
   from [Dashboard.tsx](../../app/src/routes/Dashboard.tsx), `todayPlan` in
   [plan.ts](../../app/src/lib/plan.ts), `Settings` and `DayActivity` in
   [progress.ts](../../app/src/lib/progress.ts), and
   [selectors.ts](../../app/src/lib/selectors.ts).
3. For each scope, answer: does it add a stored field? If yes, name the
   migration it needs and what `parseSettings` (line 169) must default.
4. Pick one scope and say why in two sentences. Name the slice you would ship
   first and what users get if you stop after it.

Done when the entry is in `journal/` with all three scopes, at least nine
non-goals in total, one "adds a stored field: yes/no" line per scope, and a
chosen scope. Check it against the time-budget cut above: if your L scope
reintroduces minutes, say which of the two meanings you would use and why.

Write in your journal: which non-goal was hardest to write down, and who
would push back on it first?
