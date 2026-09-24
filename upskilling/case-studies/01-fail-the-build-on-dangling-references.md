# 01. Fail the build on dangling references

DevPath has no server, so it has no logs. When a roadmap step points at a
project that does not exist, the only person who finds out is a learner, in
their own browser, and they will not tell you. This case is about the decision
to catch that class of error at build time, the gap it left, and a second gate
that started life as a script nobody ran.

## The decision

Commit `2220491` (2026-09-09) shipped `scripts/build-content.mjs` with one rule:
content the app cannot follow is a build failure, not a warning. `validateRoadmap`
collected every `build`, `drill` and `guide` step whose target was missing and
threw once with the whole list. `loadQuestions` threw on a duplicate id, fewer
than two choices, an out-of-range `answer` or a missing `why`. The script's
`main().catch` prints the message and calls `process.exit(1)`, and
`app/package.json` runs the script as both `predev` and `prebuild`. So neither
`npm run dev` nor `npm run build` starts on broken content.

The alternatives were all cheaper to write. You could warn and carry on. You
could render a "missing step" placeholder in the app. You could check only in
CI. The author picked the one that costs every content author some friction
(a typo in `roadmap.json` blocks the dev server) and bought a guarantee: the
app never shows a step that leads nowhere. When production is thousands of
browsers you cannot see, the build is the only monitoring you have. Chapter
[10](../senior-behaviours/10-designing-for-operability.md) takes that idea
further.

## What it hid

The validator covered three of the four step kinds. `read` steps (a `doc` plus
an `anchor`) were not checked at all. In 2220491 all nine read steps pointed at
root `HANDBOOK.md`, and a reviewer checking them on 2026-09-23 reported all nine
anchors as resolving.

That report was wrong, and the way it went wrong is the lesson. The reviewer
re-implemented `slugify` from `markdown.ts` and ran it over the raw heading
text. The app did something else: its heading renderer slugged marked's
*HTML-escaped* output, so `The repo's big ideas` became
`12-the-repo39s-big-ideas` in the page. The read step in `m-decide-vs-do` asked for
`#12-the-repos-big-ideas` and landed at the top of the handbook. The build
passed, and a careful human check passed too, because both used a copy of the
slug rule rather than the code the app actually ran.

There was also a design question the decision had not had to answer yet. In
2220491 `slugify` was a non-exported `const` inside `markdown.ts` (run
`git show 2220491:app/src/lib/markdown.ts | sed -n 18p`), a file that imports
`marked`. A plain Node script could not reuse it without either exporting it
and importing app source into the pipeline, or copying it. The reviewer's
mistake above is what copying looks like on a bad day.

The last thing it hid was structural. `validateRoadmap` collected all
problems before throwing, while `loadQuestions` threw on the first one. Authors
fixing a bad deck got one error per run.

## How it was found

A refactor plan written on 2026-09-23 ran the real renderer and
table-of-contents code over every document and compared the ids. The
adversarial review of that plan re-ran it over the four handbooks and narrowed
the plan's "5 of 302 TOC entries broken" to one broken entry in the
handbooks, which was the one a roadmap step depended on. The journal review
had "verified" the same anchor as fine a few hours earlier. Same fact, two
answers. The difference was whether the check imported the production code or
copied it.

A separate review of the question bank found a content defect no reference
check could see: in 408 of 450 questions (91%) the correct choice was the
longest or tied for longest. A learner could score about 90% by picking the
long option every time.

## What changed

Read these in the current tree (`git diff 2220491 -- scripts/build-content.mjs`):

- `validateRoadmap` (`scripts/build-content.mjs:283-355`) now also fails on a
  module id used twice (`:299-303`), on two steps in one module with the same
  `kind:target` (`:307-309`), on a drill tag no question carries, and on a
  tagged drill asking for more questions than exist. Thin pools produce
  warnings, not failures. The function is exported and tested directly in
  `scripts/build-content.test.mjs`, because the script only runs `main()` when
  invoked as a file (`:469-475`).
- `read` steps are validated (`:317-323`): a `doc` that is not a shipped doc
  fails, and so does an anchor that is not a heading id. The ids come from
  `headingIds` in `markdown.ts`, so the build asks the renderer's own slugger
  instead of a copy. The test "read steps: an unshipped doc fails, an anchor
  that is not a heading fails, a real heading passes" pins it, including the
  apostrophe that fooled the reviewer. The register records this as
  [F-16 and F-17](../loose-threads.md). Note that this landed on 2026-09-24,
  a day after the rest: for a few hours the `headingIds` comment ("used by the
  content build to validate anchors") described a caller that did not exist.
- `markdown.ts` now has one slug rule and one per-document slugger
  (`slugify`, exported, `:44-49`; `createSlugger`, `:52-60`), used by both the
  renderer and `tableOfContents`. The same `tableOfContents` writes each
  guide's heading ids into `guides.json`, so search uses the renderer's ids
  too.
- The pipeline paid for all of this with imports from the app:
  `import { stepTarget } from '../app/src/lib/types.ts';` and
  `import { headingIds, tableOfContents } from '../app/src/lib/markdown.ts';`
  (`:22-23`). The key and the heading ids the build validates are the ones the
  app uses, by construction. The price is that the build script now needs
  Node's type stripping, the app's file layout and, through `markdown.ts`,
  `marked` and the highlighter. That trade-off is open as
  [LT-12](../loose-threads.md).
- `scripts/check-questions.mjs` is a new quality gate. It fails a deck where
  the correct choice is strictly longest in more than 40% of questions
  (`:167`), a question whose correct choice is over twice the median wrong
  one (`:154`), and exact or near-duplicate stems across decks. It was first
  written as a standalone script, then wired into `main()` (`:24` and
  `:417-427`), so a failing deck now stops `npm run dev` like a dangling
  reference does. On 2026-09-24 `node scripts/check-questions.mjs` printed
  `checked 34 decks · 1043 questions · 0 fail · 0 warn`.

What did not change: `loadQuestions` still throws on the first bad question
([LT-03](../loose-threads.md)), and nothing checks that a step has a `title`
or a numeric `minutes` ([LT-13](../loose-threads.md)).

## What a junior, a mid and a senior would each have done

**Junior.** Given the ticket "the build should fail on bad roadmap steps", the
junior writes the check for the three kinds in the ticket's example and adds a
test for each. They do not ask about `read`, because nobody mentioned it. When
a reviewer points out the gap, they add a `read` check by copying the
`slugify` regex into the script, because importing a `.ts` file from a `.mjs`
script feels unsafe and the copy is five lines. The check passes, and it keeps
passing on the day the copy and the original diverge.

**Mid.** The mid lists the step kinds from the `Step` type in `types.ts`
before writing anything and sees four, not three. They validate all four. They
recognise that the anchor check needs the app's slug rule and choose to
export it and import it, because a copy guarantees drift. They make the two
validators consistent (collect everything, throw once). They also wire
`check-questions.mjs` into the build the day it is written, not the day
after, because a gate nobody runs is documentation.

**Senior.** The senior does what the mid did and then asks what the import
costs. `build-content.mjs` importing from `app/src/lib` means a refactor of
`markdown.ts` can break the content pipeline, and `markdown.ts` imports
`marked`, so the pipeline now needs the app's dependencies installed. They
write that down as a two-paragraph decision record
([template](../templates/decision-record.md)) naming the alternative (move the
slug rule and `stepTarget` into a tiny shared module with no dependencies) and
the condition for switching ("if the pipeline ever runs without `app/`
installed"). They post it in the PR description so the next person who
touches either file sees the coupling. They also ask the question nobody
assigned: which gate runs where? They answer it in one table in the PR:
`prebuild`, CI, or neither.

## Exercise

The two halves that stayed open are yours:
[LT-03](../loose-threads.md) (one validator collects, the other throws on
the first problem) and [LT-13](../loose-threads.md) (a step's `title` and
`minutes` are never checked). Close both in one branch, because they meet in
the same design question: what should an author see when a content change has
five mistakes in it?

Before writing code, write a decision record in `../decisions/` that settles
two things. First, collect-then-throw or throw-first, for every check in
`build-content.mjs`, with the reason from the author's side. Second, hand-written
shape checks or a JSON Schema, given the repo prefers no new dependency. Name
what you would do if the roadmap grew a fifth step kind. Note that
`loadQuestions` reads files from disk and is not exported: how you make it
testable is part of the design, not a detail.

Done when: on your branch, changing one step's `minutes` to the string `"30"`
and deleting another step's `title` in `content/roadmap.json` makes
`npm run content` exit non-zero with **both** problems in one message; two
malformed questions in one deck are also reported together in one run;
`scripts/build-content.test.mjs` has a test for each of those; the record is
in `../decisions/`; and after you revert the content, `npm test` and
`npm run build` pass. Move LT-03 and LT-13 to the register's fixed table.

Write in your journal: the last time you "verified" something by
re-implementing it rather than calling it, and what it would have cost if the
copy had been wrong.
