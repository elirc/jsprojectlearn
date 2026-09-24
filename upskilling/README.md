# Upskilling: from mid-level to senior, in this repo

DevPath takes you to hireable mid-level. This folder is for the next step.
Mid-level means you can take a well-defined task and finish it well. Senior
means you can take an ill-defined problem and leave the codebase and the
people around it better off: you scope it, record the trade-offs, catch what
others miss and make other people faster.

Senior is a set of behaviours other people can observe. It is not a number of
years or a list of technologies. None of it fits a multiple-choice drill, so
it lives here as markdown, and in real changes you make to this repo.

## Who this is for

You have finished the DevPath stages or are working through the later ones, or
you contribute to this repo. You can already build a CRUD feature with tests.
You want to get better at the judgement around the code: deciding, reviewing,
debugging under pressure, and explaining.

This folder is not surfaced in the app. `scripts/build-content.mjs` copies
project folders, the track-level `HANDBOOK.md`/`QUIZ.md`/`README.md`/
`START-HERE.md` files and `content/modules/`. Nothing here matches those
rules, so you read it on disk or on GitHub. Every link is a plain relative
path for that reason.

## What's here

| Path | What it is | When you use it |
|---|---|---|
| [competency-matrix.md](competency-matrix.md) | 10 dimensions × junior/mid/senior, each cell a behaviour someone could watch you do | Day 1, then every 30 days |
| [90-day-plan.md](90-day-plan.md) | Three 30-day arcs with deliverables and exit criteria, budgeted at 6–8 h/week | Your schedule |
| [loose-threads.md](loose-threads.md) | The one register of verified weaknesses in this repo, open and fixed | When you need real work to practise on |
| [case-studies/](case-studies/) | Nine real decisions in this repo, the flaw each one hid and how it was found | One a week during the plan |
| [senior-behaviours/](senior-behaviours/) | Ten chapters on what seniors do differently | One a week during the plan |
| [templates/](templates/) | Weekly entry, decision record, postmortem, design doc, review checklist | Copy them; never edit in place |
| [examples/](examples/) | One filled-in example of each template, drawn from this repo | Before you fill in a template for the first time |
| [journal/](journal/README.md) | Your weekly entries, committed | Weekly |
| [decisions/](decisions/README.md) | Your decision records about this repo, committed | Per decision |

Three existing guides own material this folder does not repeat. Read them
rather than looking for it here:
[interview-playbook.md](../content/modules/interview-playbook.md) (telling
the stories), [debugging-playbook.md](../content/modules/debugging-playbook.md)
(the debugging method) and
[testing-strategy.md](../content/modules/testing-strategy.md) (test layers
and doubles).

## Order of reading

1. [competency-matrix.md](competency-matrix.md). Mark where you are today,
   honestly, and link one piece of evidence per dimension where you have it.
2. [90-day-plan.md](90-day-plan.md). Put the weekly slot in your calendar.
3. [loose-threads.md](loose-threads.md). Skim it so you know what real work
   exists.
4. Start Arc 1.

## The cadence

- **Daily, 10 minutes.** One line in a scratch note outside the repo: what you
  did and what surprised you. It feeds the weekly entry. It is not committed.
- **Weekly, 45 minutes, the same slot every week.** Copy
  [templates/weekly-entry.md](templates/weekly-entry.md) to
  `journal/YYYY-Www.md` (ISO week, e.g. `journal/2026-W40.md`) and fill it
  in. Then open the entry from four weeks ago and add one line at its
  bottom: "Four weeks on: …".
- **Per decision.** Write a decision record in `decisions/NNNN-kebab-title.md`
  whenever a choice is costly to reverse, affects someone else, or you had to
  argue for it. Rule of thumb: if you spent more than 30 minutes choosing,
  write it down.
- **Per incident.** Write a postmortem within 48 hours of anything that broke
  `npm run content`, `npm run typecheck`, `npm test` or `npm run build` on a
  shared branch, and of the mock incident in Arc 2.
- **Every 30 days.** Self-assess against the matrix. Every claim links to a
  PR, commit, decision record, postmortem or review. A claim with no link
  does not count.
- **During the 90 days.** One case study and one senior-behaviour chapter a
  week. The plan says which.

## What "done" means

This is the part of the README that matters most. Vague completion is how a
journal turns into a reading list.

- **An exercise is done** when its output exists in the repo and you can link
  to it: a branch, a PR, a decision record or a journal entry. If code
  changed, all four commands pass on it: `npm run content`,
  `npm run typecheck`, `npm test`, `npm run build`.
- **A case study is done** when your answer to its exercise is in your
  journal and includes at least one thing you would have done differently
  from the repo's author, and why.
- **A chapter is done** when you have done its exercise *and* someone else
  has seen the output. Solo, the "someone else" is you after 48 hours, using
  [templates/review-checklist.md](templates/review-checklist.md), with the
  review written down.
- **"Merged" means reviewed, not pushed.** A change counts as merged when
  (a) someone other than you reviewed and approved it, or (b) you left it for
  at least 48 hours, reviewed it yourself with the checklist, wrote the review
  into the PR or a journal entry, and fixed or answered every point. Either
  way the review is linked from the deliverable. A PR you merged ten minutes
  after opening it is a push, not a merge, and does not count toward any exit
  criterion.
- **The 90 days are done** when every arc's exit criteria are met. The time it
  took does not matter.

## If you have no mentor

Pair with another learner if you can, and review each other's PRs against the
checklist. If you can't, argue with the repo's history. `git log` and the WHY
comments are a senior author's recorded reasoning. Read commit `2220491`'s
message, then read the code it describes, and write down where the two
disagree. Post your decision records as PRs even with nobody to approve them.
Most of the skill is writing for a reader who isn't in the room.

## How entries are written

Plain and specific. Past tense for what happened. Name the file and the
symbol: "`parseDrillParams` in `app/src/lib/session.ts`", not "the drill
code". Give numbers where you have them, with the command that produced them
and the date. Write "I", not "we". Nobody grades the prose. What matters is
whether you can act on it four weeks later.

## Folder rules

- **No code files under `upskilling/`.** No `.js`, `.mjs`, `.cjs` or `.ts`
  files anywhere in this folder.
- **No directory named `test`**, and no numbered directories such as
  `01-notes/`.

The reason is test discovery. `npm test` now passes `node --test` an explicit
list of globs (see the `test` script in the root `package.json`), and none of
them reaches `upskilling/`. But `node --test` with no arguments, which is what
people type to run "everything", falls back to Node's default globs from the
current directory. Those match `**/*.test.*`, `**/test-*`, `**/*-test`,
`**/*_test` and everything under any `**/test/` directory, so a worked
solution saved as `upskilling/test/solution.js` would run and could fail.
Until the explicit globs arrived, `npm test` itself behaved that way and ran
the generated copies of project tests two extra times (F-19 in
[loose-threads.md](loose-threads.md)). Numbered directories are how this repo
marks project folders (`01-fizzbuzz/`), and one of the test globs,
`[0-9][0-9]-*/**/*.test.js`, is written with that convention in mind; keep
the pattern meaning one thing. If an exercise produces code, put the code in
a project folder or on a branch and link to it from here.

Check the rule before you commit. This must print nothing:

```sh
node -e "const fs=require('fs'),p=require('path');(function walk(d){for(const f of fs.readdirSync(d)){const q=p.join(d,f);if(fs.statSync(q).isDirectory()){if(f==='test'||/^[0-9]{2}-/.test(f))console.log('BAD DIR',q);walk(q)}else if(/[.](m?js|cjs|ts)$/.test(f))console.log('CODE FILE',q)}})('upskilling')"
```

## Style guide

These rules apply to everything in this folder, including your own entries.

- **Voice.** Direct, second person, present tense for advice ("You read the
  WHY comment first."). Past tense for what happened in the repo. Don't use
  "we" to mean you and the reader. British spelling.
- **Concrete over abstract.** Follow every principle within three sentences
  with a DevPath example: a file and a symbol, a commit hash or a number.
  Refer to code by symbol rather than line number, because line numbers drift.
- **Verified facts only.** Check anything you say about the code against the
  current code. When you are unsure, write it as a question and mark it
  *reproduce first*. Every number carries the command that produced it and
  a date.
- **No filler.** Banned: "journey", "level up", "rockstar", "ninja",
  "crush it", "exciting", "simply", "just", "obviously", "it's important to
  note", "in today's world". No pep talks, no emoji.
- **No duplication.** Each verified weakness is stated once, in
  [loose-threads.md](loose-threads.md), and everything else links to it. Case
  studies own the analysis of a decision. Chapters own the behaviour and link
  to case studies for examples.
- **Every chapter and case study ends with an exercise done in this repo.**
  The exercise names its output location (`journal/`, `decisions/`, a branch
  or a PR) and ends with one line: `Write in your journal: …`.
- **Markdown.** One H1; H2 sections; tables for comparisons; code excerpts
  of 15 lines or fewer, copied exactly and fenced with a language tag;
  relative links that work on disk and on GitHub; no `#/` app routes;
  kebab-case filenames; wrap at about 80 columns.
- **Fairness to the author.** The repo's decisions were reasonable under their
  constraints. Critique the trade-off, not the person.

## Reading list

Eighteen items, one line each. None is required. Each one is here because a
case study or chapter leans on it.

1. John Ousterhout, *A Philosophy of Software Design*. Deep modules, and the vocabulary for comparing `progress.ts` with a store library.
2. Tanya Reilly, *The Staff Engineer's Path*. What changes after senior: scope, leverage, the big picture.
3. Michael Feathers, *Working Effectively with Legacy Code*. Seams and characterisation tests, for changing code you didn't write.
4. Martin Fowler, *Refactoring* (2nd ed.). A shared vocabulary of small, safe steps for the Arc 2 refactor.
5. Kent Beck, *Tidy First?* When a small structural change pays for itself.
6. Winters, Manshreck and Wright, *Software Engineering at Google*. Read the chapters on code review and deprecation.
7. Martin Kleppmann, *Designing Data-Intensive Applications*, ch. 4. Encoding and evolution: the theory behind case study 08.
8. Steve McConnell, *Software Estimation*. Ranges instead of promises, and the cone of uncertainty.
9. Fred Brooks, *The Mythical Man-Month*: "No Silver Bullet" and "The Second-System Effect".
10. David Agans, *Debugging: The 9 Indispensable Rules*. Short. Pair it with the repo's playbook.
11. Google SRE Book, ch. 15, "Postmortem Culture". The source of the blameless template.
12. Michael Nygard, "Documenting Architecture Decisions" (2011). The original decision-record post.
13. Google Engineering Practices, "How to do a code review" and "The CL author's guide".
14. Dan McKinley, "Choose Boring Technology". Innovation tokens: the argument behind "no new frameworks".
15. Rich Hickey, "Simple Made Easy" (2011). Simple versus easy, for case studies 04 and 05.
16. Joel Spolsky, "Things You Should Never Do, Part I". The case against the big rewrite.
17. Kim Scott, *Radical Candor*. The care-plus-challenge model behind the feedback chapter.
18. Dan Luu's collection of public post-mortems. Read five before you write your first postmortem.
