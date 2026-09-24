# Landing a decision you cannot make alone

**Most decisions a senior cares about belong to someone else: a lead, a
product owner, the maintainer of the code you depend on. Your job is to get
the right decision made by the person who owns it, cheaply, and to leave a
written record that outlives the conversation.**

Being right is the smallest part of it. A correct proposal that the owner
first meets in a meeting, framed in your currency rather than theirs, with one
option and no costs, usually loses to "let's keep what we have".

## Find the owner and their currency

Before you argue, find out who can say yes and what they are measured on. A
team lead is measured on delivery and on not being surprised. A product owner
is measured on what users see. A maintainer is measured on how much the change
costs them for the next two years.

Then translate your problem into that currency. "The step key is positional"
is an engineer's sentence. "When we re-sequence the roadmap next week, some
learners' ticks will move to steps they never did, and nothing will tell
them" is a lead's sentence: it names a date, a user and a failure nobody
will notice. Both sentences state the same fact.

## Bring options with costs, including theirs

Put the option the sceptic prefers on the table yourself, priced fairly. If
you leave it out, they will raise it, and you will spend the meeting
defending the omission instead of comparing costs. Every option gets the same
three lines: what it costs now, what it costs later, and what would make it
the wrong call.

"Do nothing" is always an option. Sometimes it wins. A proposal that cannot
lose to do-nothing is a sales pitch.

## Pre-wire

Nobody should see your proposal for the first time in the room where it is
decided. Send it to each person whose objection could sink it, one at a time,
a day or two before. Ask one question: "What would make you say no to this?"

Pre-wiring is not lobbying. You are collecting objections while they are
still cheap to answer, and sometimes you learn the proposal is wrong. The
owner also gets to shape it, which makes it partly their decision, and people
defend decisions they helped make.

## Write it down, including what you lost

The decision is not landed until it is written: the options, the choice, who
made it and what was given up. Use a decision record
([template](../templates/decision-record.md)). The losing argument goes in
too, stated so that its author would sign it. In six months someone will ask
"why didn't you do X?", and the record answers without you in the room.

## What this looks like in DevPath

The step-key change is the worked example. Before this iteration, progress
keyed each tick by `stage/module/index`. It is now `module/kind:target`,
built by `stepKey` in [types.ts](../../app/src/lib/types.ts) (line 171).
Old keys are rewritten once through the frozen 195-entry table
[legacy-step-keys.json](../../app/src/lib/legacy-step-keys.json). The
analysis of that design lives in
[case study 09](../case-studies/09-the-roadmap-as-data-and-stable-step-keys.md)
and the record in
[the example decision record](../examples/decision-record-step-keys.md).
This chapter is about how it got decided.

Nobody decided it alone. Separate adversarial reviews on 2026-09-23 converged
on it from different directions. The UX review found that the planned
features would put the positional key into drill URLs and session history,
spreading the damage. The roadmap review needed to move steps between
modules, which an append-only rule cannot express. The app-refactor review
specified the frozen table and budgeted about three hours for it. The review
of this journal's own plan pointed out that seven drill decks were used in
more than one module (24 targets are, on today's roadmap), so the key had to
keep the module.

Now reconstruct landing it with a team lead who says: "Keep the index. It
works. Tell people to append steps at the end."

**Frame it in their currency.** The roadmap re-sequencing was already
scheduled, and it moves steps. A throwaway script, run on 2026-09-24, read the
legacy table and today's [roadmap.json](../../content/roadmap.json) and
looked up what now sits at each old `stage/module/index`. It shows what
index keys would have done after that one edit: of 195 old ticks, 175 still
point at the right step, **7 would silently point at a different step** and
13 would point at nothing. About one tick in ten damaged by a single content
change, with no error anywhere. That is the sentence for the lead.

**Price their option fairly.**

| Option | Cost now | Cost later | Wrong call if |
|---|---|---|---|
| Keep the index, append-only rule | No code | A rule enforced by memory; it forbids the moves already planned | Nobody ever reorders a module |
| Explicit `id` on every step | 195 hand-written ids | Authoring burden on every new step | Authors copy-paste ids |
| Derive from `kind` + target | About 3 h: key, table, tests | Changing a step's target resets its tick | Two steps in one module share a target |

The third option's weakness is real, and it belongs in the table: under
target keys, pointing a step at a different project makes it a new step. The
roadmap review said so, and the build rejects the collision case
(`validateRoadmap` in [build-content.mjs](../../scripts/build-content.mjs),
lines 299–309).

**Pre-wire.** Before the meeting you would send the lead the table and the
script's output and ask what would make them say no. The likely answer:
"migration risk. A bad migration loses everybody's history." That objection
is what the shipped safety features answer. The raw v1 payload is copied to
`devpath.progress.v1.backup` before anything is rewritten (`read` in
[progress.ts](../../app/src/lib/progress.ts), lines 336–347). The generator
refuses to overwrite its own output
([gen-legacy-step-keys.mjs](../../scripts/gen-legacy-step-keys.mjs), lines
48–51). A test asserts that every legacy key lands on a real step
([selectors.test.ts](../../app/src/lib/selectors.test.ts), line 64). The
sceptic's objection made the design better. That is why you ask.

**Write it down.** The record states what was given up: target changes reset
ticks, and the table is data about the past that must never be regenerated.
The comment above `LEGACY` in `progress.ts` (lines 227–231) says the second
part where the next maintainer will read it.

## Common failure modes

- You argue in your own currency ("it's positional"), and the owner hears a
  refactor request with no deadline.
- You present one option. The owner's first question is "what else did you
  consider?", and the answer is silence.
- You leave out the option the owner prefers, then spend the meeting on why.
- The owner sees it first in the meeting, objects in public, and now has to
  defend the objection to save face.
- You win the conversation and write nothing. Three months later the same
  argument happens again with someone new.

## Exercise

Land a decision on LT-12 in [loose-threads.md](../loose-threads.md): the
content pipeline imports `stepTarget`, `headingIds` and `tableOfContents`
from the app's source, trading one source of truth for coupling. The coupling
grew during this iteration (the heading imports arrived with read-step
validation), which is the usual way: nobody decides it, it accumulates. The
decision is not yours alone, because it changes how both the app and the
pipeline are maintained.

1. On a branch, write a one-page options memo: the problem in the
   maintainer's currency, at least three options including do-nothing, and
   for each the cost now, cost later and "wrong call if".
2. Pre-wire it. Send it to one reviewer (a peer, or the repo owner as a draft
   PR) and ask "what would make you say no?" Solo: leave it 48 hours, then
   write the strongest objection you can in the voice of a sceptical lead.
3. Revise, then record the outcome as
   `decisions/NNNN-pipeline-imports-app-source.md` with status Accepted or
   Rejected, including the losing argument.

Done when the decision record exists, names who decided, quotes at least one
objection received (or written) before the decision, and says what changed
in the proposal because of it.

Write in your journal: which objection changed your proposal, and would you
have found it without asking?
