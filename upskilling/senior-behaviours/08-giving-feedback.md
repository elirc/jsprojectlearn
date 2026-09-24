# Giving feedback

**A senior's feedback carries its own evidence, so the receiver can check it
in a minute and the conversation moves from who is right to what is true.
When the same feedback has to be given twice, a senior turns it into a check
or a written rule so it stops needing to be given.**

A mid-level developer gives polite, specific comments on the PRs they are
asked to review. The senior difference is in three places: the evidence
travels with the claim (a command, a line, a number), the critical feedback
is about the work's effect on a user or a maintainer rather than the
author's choices, and repeated feedback becomes a gate. Being kind and being
clear are not in conflict; vague feedback is the unkind option, because it
leaves the person guessing.

## Situation, behaviour, impact

Structure each piece as three parts:

- **Situation**: where and when, precisely enough to find it. A file and a
  symbol, a PR, a meeting.
- **Behaviour**: what was done, stated as a fact the person could check.
  Not an interpretation of motive.
- **Impact**: what it caused or will cause, for whom.

Then, if it is critical, one suggestion, offered as one option rather than
the answer. "The `commit()` in `progress.ts` writes the whole state object
(situation, behaviour). With two tabs open, the last one to write erases the
other's step ticks (impact). A `storage` listener that re-reads would fix it;
there may be a simpler way." That was a real finding in this repo, and it is
fixed (F-05 in [loose-threads.md](../loose-threads.md)).

## Make it verifiable

The strongest feedback carries its own evidence: the command, the line, the
number. The receiver can check it in a minute instead of taking your word
for it, and the conversation moves from "who is right" to "what is true".
Verifiable feedback also protects you. If you are wrong, the evidence shows
it quickly, and you correct yourself before the other person has to.

## Praise that teaches

"Nice work" teaches nothing. Praise the specific choice, and say why it was
good, so the person does it again on purpose and others can copy it.

Commit `2220491`'s message is a good target. Run `git log -1 2220491` and
look at its structure: what changed, grouped by area; why ("this path targets
CRUD interviews, not algorithm puzzles"); how it was verified ("Tests: 2,552
passing"); and what was removed and why. Praise that names those four parts
teaches the author's habit to everyone who reads it. Praise that also notes
what the message did not say (that `lib.test.ts` landed as a binary file,
F-03) is still praise, and teaches that a good message does not replace
reading the stat line.

## About the work, not the person

Critique the artefact and its effect. "This test depends on the order it
runs in" is about the work. "You wrote a fragile test" is about the person,
even though it sounds similar, and people defend themselves instead of the
code. Written feedback makes this easier: you can reread the sentence and
remove the "you" before you send it.

Written or spoken? Critical feedback on a person's behaviour goes in person
first, in private. Feedback on work goes where the work is (the PR, the doc),
in writing, so it can be checked and so the next person learns from it.

## Receiving it and asking for it

Receive feedback by checking it, not by defending. Thank the person, verify
the claim, then either change the work or explain why not, in writing.
Ask for feedback with a narrow question ("which section of this doc would you
cut?"), because "any feedback?" gets "looks good".

## What this looks like in DevPath

The planning round on 2026-09-23 used an adversarial pattern: one author
wrote each plan, a separate reviewer attacked it, and the reviewer's
"required amendments" were binding. The review of this journal's own plan is
the model for feedback that is specific, verifiable and about the work.

Every claim in the plan got a row with a verdict and evidence. One read:
"`6b5ff4c` (31 Aug) added `dsa/01-30` 'among 610 files' — **FALSE** —
`git show --stat 6b5ff4c` → `1157 files changed`." The plan's author could
check that in ten seconds. The same row added "30 dsa dirs is correct", so
the author knew which half to keep. No row said the author was careless; the
row said the number was wrong and showed the command.

Where the plan had a hypothesis (StrictMode grading a timed-out question
twice), the reviewer did not argue. They ran a probe in jsdom under React
19.3 in development mode and reported the observed counts, with and without
StrictMode. The finding was then fixed in `Countdown`
([DrillSession.tsx](../../app/src/routes/DrillSession.tsx), lines 416–464;
F-02).

The review also praised specifically: "the plan's code facts are mostly
right", followed by an exact count of what was false and what was weak.
Its hardest point was about the work's level, not the author: "the 'senior'
content is mostly
strong-mid material", with a list of what was missing. That objection is why
this folder has chapters 01, 07 and 10 in their current form. The feedback
was received by changing the work, which is the only way anyone can tell
feedback was heard.

## Common failure modes

- The feedback is a feeling ("this seems off") with no location, so the
  receiver cannot act on it.
- The behaviour is an interpretation of motive ("you rushed this").
- The praise is generic, so nobody learns what to repeat.
- You pile up feedback and deliver it all at a review weeks later, when
  nothing can change.
- You ask "any feedback?" and accept "looks good" as an answer.

## Exercise

Write two pieces of feedback on real artefacts in this repo, in `journal/`:

1. **Positive**, on a specific choice worth copying. Candidates: the
   `DayActivity` comment in [progress.ts](../../app/src/lib/progress.ts)
   (lines 64–68), the `2220491` commit message, or a case study in
   [../case-studies/](../case-studies/README.md).
2. **Critical**, on a piece of work, not a person. Candidates: the shared
   test harness in [harness.ts](../../app/src/testing/harness.ts), or any open
   row in [loose-threads.md](../loose-threads.md) that you have verified
   yourself.

Each must be under 120 words, in situation–behaviour–impact form, and contain
at least one claim the receiver can verify with a command or a file and line.
Give both to a peer and ask them to rate each for actionability from 1 to 5.
Solo: rate them yourself after 48 hours, then rewrite the lower-rated one.

Done when both pieces are in your journal with their ratings, each has a
verifiable claim, and the lower-rated one has a rewritten version beneath it.

Write in your journal: which piece was harder to make verifiable, and what
did you have to go and check?
