# Case studies

Nine real decisions from this repo, each followed from the commit that made
it (`2220491`, 2026-09-09) to the flaw it hid, the review that found the flaw,
and the code as it stands now. Every citation is to the working tree as
checked on 2026-09-24; run the command next to it and you should see the same
thing. If you do not, the code has moved again, and noticing that is part of
the exercise.

The cases quote planning and review documents written during the
adversarial-review iteration of 2026-09-23/24. Those were working documents
and are not in the repo. Every claim taken from them is restated here with a
command you can run against the code or the git history.

## How to read one

Every case has the same sections: **The decision**, **What it hid**, **How it
was found**, **What changed**, sometimes **What a junior, a mid and a senior
would each have done**, and an **Exercise**.

1. Read "The decision". Stop.
2. In your journal, write what you would have done and what you think it will
   cost later. Two or three sentences is enough.
3. Read the rest. Compare your answer with "What it hid" before you read "How
   it was found".
4. Do the exercise. Each one picks an open thread from
   [loose-threads.md](../loose-threads.md), ends with a concrete "Done when",
   and puts its output in `../decisions/`, `../journal/`, a branch or a PR.

The junior/mid/senior section is mandatory in cases 01, 08 and 09 and
optional elsewhere. It describes what each level would plausibly have done,
not a caricature. The senior paragraph always includes who they told and what
they wrote down, because that is usually the difference.

## The cases

| # | Case | In one line | Dimensions |
|---|---|---|---|
| 01 | [Fail the build on dangling references](01-fail-the-build-on-dangling-references.md) | Build-time validation as the only monitoring a serverless app has, and the step kind it skipped | Ownership, Testing, Design |
| 02 | [SM-2, trimmed for multiple choice](02-sm2-trimmed-for-multiple-choice.md) | Adapting a published algorithm and writing down what you dropped | Technical depth, Design |
| 03 | [HashRouter, and links rewritten at render time](03-hashrouter-and-links-at-render-time.md) | How a routing choice broke in-page anchors and made two slug rules disagree | Design, Debugging, Operating in ambiguity |
| 04 | [A hundred-line highlighter](04-a-hundred-line-highlighter.md) | Writing your own, meeting the bug the library already fixed, and measuring the claim | Design, Estimation |
| 05 | [Local-first progress and a hand-rolled store](05-local-first-progress-and-a-hand-rolled-store.md) | A product decision in technical clothes, and the two-tab overwrite it hid | Technical depth, Design, Operating in ambiguity |
| 06 | ["It builds" is not "it renders"](06-it-builds-is-not-it-renders.md) | A jsdom harness with no new runner, and what it could not see without StrictMode | Testing, Code review, Technical depth |
| 07 | [Deleting the DSA track](07-deleting-the-dsa-track.md) | Scope as a product decision, and the boundary nobody wrote down | Operating in ambiguity, Communication |
| 08 | [Merge-on-read schema evolution](08-merge-on-read-schema-evolution.md) | Migrating data you cannot reach, and one entry point that skipped the rule | Design, Technical depth |
| 09 | [The roadmap as data, and stable step keys](09-the-roadmap-as-data-and-stable-step-keys.md) | Content edits that silently moved every learner's ticks, and the key that fixed it | Design, Ownership |

The dimensions refer to [the competency matrix](../competency-matrix.md).

## Reading order

The numbers are for reference, not sequence. Read them in this order:

1. **01**, because "fail the build" is the house style every later fix leans on.
2. **09** then **08**. They are one story told from two sides: why the step
   key had to change, and how you change data already stored in browsers.
3. **05**, which shares `progress.ts` with 08 and adds the product question.
4. **06** then **03**, two cases where the running app did something no
   compiler could see.
5. **02** then **04**, smaller and self-contained; good for a short week.
6. **07** last. It has the least code and the most judgement, and it reads
   better once you have seen how much the other eight depended on knowing what
   DevPath is for.

The [90-day plan](../90-day-plan.md) schedules them in exactly this order, one
a week for weeks 1 to 9.

Each case is 900 to 1,500 words and its exercise is sized for one to three
sessions. Chapters in [senior-behaviours/](../senior-behaviours/) link back
here for worked examples rather than retelling them.

Write in your journal: after the first case, which of the four "how it was
found" methods (reading, running, measuring, or another reviewer) you would
have used, and which one actually worked.
