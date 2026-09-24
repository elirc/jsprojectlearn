# The 90-day plan

Three 30-day arcs. Arc 1: own one slice of the system. Arc 2: raise the floor
for others. Arc 3: operate a level above your title. Every deliverable is a branch, a PR,
a decision record, a postmortem or a journal entry in this repo, so anyone
who opens the repo can check your exit criteria.

## At a glance

| Week | Case study | Chapter | Deliverable work |
|---|---|---|---|
| 1 | [01 Fail the build on dangling references](case-studies/01-fail-the-build-on-dangling-references.md) | [02 Scoping work](senior-behaviours/02-scoping-work.md) | A1.1 trace; first estimates |
| 2 | [09 The roadmap as data and stable step keys](case-studies/09-the-roadmap-as-data-and-stable-step-keys.md) | [05 Running a code review](senior-behaviours/05-running-a-code-review.md) | A1.2 first small fix |
| 3 | [08 Merge-on-read schema evolution](case-studies/08-merge-on-read-schema-evolution.md) | [07 The economics of tech debt](senior-behaviours/07-the-economics-of-tech-debt.md) | A1.2 second fix; A1.3 decision record |
| 4 | [05 Local-first progress and a hand-rolled store](case-studies/05-local-first-progress-and-a-hand-rolled-store.md) | [10 Designing for operability](senior-behaviours/10-designing-for-operability.md) | A1.3 feature; first self-assessment |
| 5 | [06 It builds is not it renders](case-studies/06-it-builds-is-not-it-renders.md) | [06 Debugging production](senior-behaviours/06-debugging-production.md) | A2.1 before-numbers |
| 6 | [03 HashRouter and links at render time](case-studies/03-hashrouter-and-links-at-render-time.md) | — | A2.1 refactor |
| 7 | [02 SM-2 trimmed for multiple choice](case-studies/02-sm2-trimmed-for-multiple-choice.md) | [08 Giving feedback](senior-behaviours/08-giving-feedback.md) | A2.2 mock incident and postmortem |
| 8 | [04 A hundred-line highlighter](case-studies/04-a-hundred-line-highlighter.md) | — | A2.3 review; second self-assessment |
| 9 | [07 Deleting the DSA track](case-studies/07-deleting-the-dsa-track.md) | [04 Writing a design doc](senior-behaviours/04-writing-a-design-doc.md) | A3.1 design doc draft |
| 10 | — | [01 Landing a decision you cannot make alone](senior-behaviours/01-landing-a-decision-you-cannot-make-alone.md) | A3.1 circulate; A3.2 decline memo |
| 11 | — | [03 Saying no](senior-behaviours/03-saying-no.md) | A3.3 grow one other person |
| 12 | — | [09 Growing yourself and one other person](senior-behaviours/09-growing-yourself-and-one-other-person.md) | A3.4 calibration; A3.5 evidence pack |

Weeks with a dash are catch-up weeks. Use them. Nobody finishes a 90-day plan
on schedule, and the plan is budgeted to allow for that. The case studies
run in the order the [case-studies README](case-studies/README.md) gives, and
the reasons are there.

## Rules

- **Time budget: 6–8 hours a week.** Roughly 45 minutes for the weekly entry,
  an hour for the week's case study, an hour for the chapter, and 3–5 hours
  on deliverables. If a deliverable needs more, cut its scope and write down
  what you cut. Don't borrow from the following week.
- **Everything lives in this repo.** Journal entries go in
  [journal/](journal/README.md), decision records in
  [decisions/](decisions/README.md), code on branches and in PRs.
- **"Merged" has a definition.** A change counts only if it was reviewed by
  someone other than you, or self-reviewed after at least 48 hours with
  [templates/review-checklist.md](templates/review-checklist.md), and the
  review is linked. The full rule is in
  [README.md](README.md#what-done-means).
- **All four commands pass on anything merged:** `npm run content`,
  `npm run typecheck`, `npm test`, `npm run build`. Paste the tail of each
  output into the PR description, with the date.
- **Estimate every deliverable before you start it**, as a range with
  assumptions, in that week's entry. Log the actual when you finish. Arc 3
  uses the log.
- **Code never goes in `upskilling/`.** See the
  [folder rules](README.md#folder-rules).

## Solo mode

The plan assumes you may be working alone. Wherever a deliverable needs a
second person, it gives a solo substitute. The substitutes cost more time and
teach slightly less. If you can find one other learner to swap reviews with,
even once a fortnight, do.

| Needs another person | Solo substitute |
|---|---|
| A PR review | Wait 48 hours, review with the checklist, write the review into the PR, then fix or answer every point. |
| Explaining something aloud | Write it from memory a week later and diff it against the first version in your entry. |
| A mock-incident partner | Ask anyone (a friend, or an AI coding assistant) to apply one fault from the list on a branch and tell you only the branch name. See A2.2 for the last resort. |
| Circulating a design doc | Open it as a PR. Self-review after 48 hours counts once per arc. |
| Mentee feedback | Write the walkthrough, follow it cold 30 days later as if you were new, and log every place it failed you. |

## Arc 1, days 1–30: own a slice

*Understand one system completely, then change it safely.* The slice is
progress: `app/src/lib/progress.ts`, `app/src/lib/types.ts` (`stepKey`),
`app/src/lib/hooks.ts` (`useProgress`, `useKey`) and the parts of
`scripts/build-content.mjs` that protect them.

### A1.1 Trace a drill answer from keypress to disk (week 1, about 3 h)

In your journal, trace one answered question with a file and symbol for
every hop: the `keydown` listener in `useKey`, `shouldIgnoreKey`, `answer` in
`DrillSession.tsx`, `gradeCard`, `scheduleCard`, `commit`,
`localStorage.setItem`, the listeners, `progressStore.getSnapshot`,
`useSyncExternalStore` in `useProgress`, and the re-render. Then answer a
second question by reading alone: what does the user see if
`app/public/content/stats.json` fails to load? Check it by deleting the file
*while `npm run dev` is already running*. The `predev` hook regenerates
content on start, so deleting it first proves nothing. Record where your
reading was wrong.

A week later, write the trace again from memory and diff it against the
first. That diff is the evidence.

### A1.2 Two small fixes, failing test first (weeks 2–3, about 2–3 h each)

Pick two open rows from [loose-threads.md](loose-threads.md). Good
candidates: LT-04 (in-app links to directories that were never copied),
LT-07 (a fresh clone's `npm test`), LT-08 (`erasableSyntaxOnly`) and LT-03
(one validator stops at the first problem). Each PR has a test or command
that fails before the change and passes after it. The description says how
you verified the fix, with the output. Check the row is still in the Open
table first; the register moves rows as they are fixed.

### A1.3 One feature, decision record first (weeks 3–4, about 8–10 h)

Choose one:

- **(a)** Guard step keys against in-place target edits (LT-15), so changing
  a step's deck, tags, project or anchor fails the content build unless a
  mapping says where the old ticks go. The real decision is where that
  mapping lives and how `migrate()` applies it without a schema version per
  edit. [Case study 09](case-studies/09-the-roadmap-as-data-and-stable-step-keys.md)
  sets it up.
- **(b)** Give users a way back from the v1 backup and corrupt-payload keys
  in Settings (LT-10).
- **(c)** Validate the roadmap's shape as well as its references (LT-13),
  and make every content check report all its problems in one run (LT-03).
  [Case study 01](case-studies/01-fail-the-build-on-dangling-references.md)
  sets it up.

Read-step validation used to be option (a). It landed during the
review iteration (F-16), and the way it landed is the worked example in case
study 01: the pipeline imports the renderer's `headingIds` rather than
copying the slug rule, and pays for it in coupling (LT-12).

Before any code, write the decision record in `decisions/0001-*.md` from
[templates/decision-record.md](templates/decision-record.md). Spike the
riskiest part for one hour, then re-estimate in your entry. Update the
record if the code taught you something.

### A1.4 Four weekly entries

### Arc 1 exit criteria

A mentor could check each of these from the repo alone.

- [ ] Three merged PRs (A1.2 × 2, A1.3), each with its review linked.
- [ ] `decisions/0001-*.md` with status Accepted, dated before the feature's
      first commit.
- [ ] The A1.1 trace, the one-week-later rewrite and the diff between them,
      in the journal.
- [ ] Four entries in `journal/`, each with a filled estimate-versus-actual
      table.
- [ ] A first self-assessment against the
      [competency matrix](competency-matrix.md), with a linked piece of
      evidence for at least four dimensions.

## Arc 2, days 31–60: raise the floor for others

*Make the codebase better for the next person, and measure it.* This arc has
three deliverables and the entries, no more. It was cut to fit the budget.

### A2.1 Refactor `DrillSession.tsx`, with numbers (weeks 5–6, about 10 h)

`app/src/routes/DrillSession.tsx` holds `Session`, `EmptyDrill`,
`Countdown`, `Summary`, `ReviewCard`, `sessionTitle`, `retryParams` and
`mockVerdict`. It was 655 lines on 2026-09-24
(`wc -l app/src/routes/DrillSession.tsx`). Before touching it, record in the
PR:

- line count (`wc -l`);
- how many tests fail when you break its logic: flip the `!early` condition
  in `finish` and count the failures in `npm test`;
- `npm test` wall time (`time npm test`; on 2026-09-24 it was 38 s for 996
  tests on the machine used for this journal, but take your own);
- the main chunk size from `npm run build` (399,437 bytes on 2026-09-24).

Move the pure decisions out of the component into `app/src/lib/` with unit
tests: when a finished drill ticks its path step, what the summary title says,
and the mock verdict. Behaviour must not change. A refactor that changes
behaviour fails unless a decision record says why. Record the after-numbers
in the same table.

### A2.2 One mock incident, of the kind the build doesn't catch (week 7, about 5 h)

The point is to find a detection gap, so the fault must be one that
`npm run content`, `npm run typecheck`, `npm test` and `npm run build` all
pass. A partner applies one of these on a branch and tells you only the
branch name:

1. Point a step whose key is not in `app/src/lib/legacy-step-keys.json` at a
   different existing target in `content/roadmap.json`, for example another
   deck for a drill, so learners' ticks on it vanish (LT-15).
2. Set a step's `minutes` to the string `"30"` in `content/roadmap.json`
   (LT-13).
3. Delete a step's `title` in `content/roadmap.json` (LT-13).
4. Add a link from a project README to a directory, such as `../react/`, so
   the app opens a `#/doc/` route with nothing behind it (LT-04).

Two faults from earlier versions of this list are now caught by the build: a
stale `read`-step anchor (F-16) and a duplicate heading that sent a search
hit to the wrong place (F-18). That is the register working.

The partner confirms first that all four commands still pass with the fault
applied. If one of them catches it, that is good news: record which command
and pick another fault.

You get the symptom as a user would report it ("the Ctrl-K result for X
opens the wrong place"). Record time-to-detect and time-to-recover. Write the
postmortem from [templates/postmortem.md](templates/postmortem.md). At least
one action item is a *detect* item, and you deliver it as a merged PR.

Last-resort solo version: pick a fault at random
(`node -e "console.log(1 + Math.floor(Math.random() * 4))"`), apply it
yourself on a branch, and wait a week. Then measure only whether any command
catches it. Say in the postmortem that you knew the fault in advance.

### A2.3 A written review (week 8, about 3 h)

Review a peer's PR with [templates/review-checklist.md](templates/review-checklist.md).
Solo: review the adversarial-review iteration's changes to
`app/src/lib/progress.ts` as if they were one PR
(`git diff 2220491 -- app/src/lib/progress.ts`). Label every comment. At
least one finding must be outside the diff. Put the review in your journal,
or in the PR if there is one. See
[the example review](examples/review-checklist-markdown-ts.md) for the
level of detail.

### A2.4 Four weekly entries

### Arc 2 exit criteria

- [ ] The refactor PR merged, with a before/after table of the four numbers.
- [ ] One postmortem for the mock incident, with a detect action item and a
      link to its merged PR.
- [ ] One written review, every comment labelled, at least one finding
      outside the diff.
- [ ] Four more entries, and a second self-assessment.

## Arc 3, days 61–90: operate a level above

*Ambiguity, saying no, and making someone else better.*

### A3.1 A design doc for a change bigger than the arc (weeks 9–10, about 8 h)

Use [templates/design-doc.md](templates/design-doc.md). It needs at least two
real alternatives. Choose one topic:

- surfacing `upskilling/` inside the app (touches `copyDocsInto`, `DocView`
  and `resolveHref`);
- progress schema v3, with a restore path and a real migration test;
- a counter-proposal to [the sync design doc](examples/design-doc-sync-vs-local.md),
  arguing that sync *should* be built now, and for whom.

Circulate it as a PR and collect written comments. Record the outcome as a
decision record. "We decided not to" is a valid outcome.

### A3.2 Say no in writing (week 10, about 2 h)

Write a one-page decline for a plausible request that conflicts with
DevPath's constraints: "add a LeetCode track back", "move to Next.js", "add
Tailwind" or "add free-text answers to drills". Say what you would offer
instead. File it in `decisions/` with status Rejected.

### A3.3 Grow one other person (week 11, about 5 h)

Run a 30-minute walkthrough of `progress.ts` for a newer learner, or write a
new guide in `content/modules/` on a real gap (run `ls content/modules`
first; there were 37 on 2026-09-24). Wire the guide into
`content/roadmap.json` as a `guide` step. Since step keys became
`module/kind:target` (F-06), inserting a step no longer moves anyone's ticks,
so it can go where it belongs in the module. Collect written feedback,
including the uncomfortable parts. Solo: see the substitute table above.

### A3.4 Estimation calibration (week 12, about 1 h)

From the estimate-versus-actual tables in your twelve entries, compute the
median of actual ÷ estimate and the spread (lowest and highest ratio). Write
what you will change. Apply it to re-estimate A3.1's proposal.

### A3.5 Evidence pack (week 12, about 2 h)

A one-page self-assessment against every dimension of the
[competency matrix](competency-matrix.md), each claim linked. Mark your two
weakest dimensions and give each one concrete action for the next 30 days,
named by loose-thread ID or file.

### Arc 3 exit criteria

- [ ] The design doc as a PR with written comments (or a linked 48-hour
      self-review), and its decision recorded in `decisions/`.
- [ ] A Rejected decision record declining a request, with an alternative
      offered.
- [ ] Feedback on your walkthrough or guide recorded in the journal, from
      the learner or from your own cold run 30 days later.
- [ ] The calibration ratio and spread computed, in an entry.
- [ ] The evidence pack, with at least one link for every dimension.
