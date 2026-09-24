# Writing a design doc

**A design doc exists to get the right decision made cheaply by the right
people. It is not documentation of what you already decided, and if nobody
could change your mind by reading it, it is an announcement, not a design doc.**

The template is [templates/design-doc.md](../templates/design-doc.md) and a
filled-in example is
[examples/design-doc-sync-vs-local.md](../examples/design-doc-sync-vs-local.md).
This chapter does not repeat either. It covers how to use them: where the
value is, what to leave out, and how to close the doc once it is circulated.

## The problem section is where most of the value is

Spend half your writing time on the problem. A reader who agrees with your
problem statement will usually agree with a reasonable proposal. A reader who
doesn't will fight every paragraph after it, and they will be right to.

A good problem section names the user, what they cannot do today, and the
evidence, with file references. It does not mention the solution. If your
problem statement contains the word "should", it is probably a proposal in
disguise.

Test it: hand the problem section alone to someone and ask them to propose a
fix. If they propose yours, the section is doing its job. If they propose
something better, you have saved a week.

## Non-goals and real alternatives

Non-goals were covered in [chapter 02](02-scoping-work.md). In a design doc
they have one more job: they are the list of arguments you will not have in
the comments.

Alternatives must be real. A real alternative is one a competent colleague
might pick, described well enough that they would recognise their own
argument. Two strawmen and your favourite is a common shape, and readers see
through it. Always include "do nothing" and price it honestly. Sometimes the
cost of doing nothing is zero, and the doc's best outcome is to say so.

## Risks as questions with owners

Write each risk as a question someone can answer, with a name and a date
next to it. "Performance might be a problem" is a worry. "Does rendering the
upskilling folder add more than 50 kB to the main chunk? Measure with
`npm run build`; owner: me; by Friday" is a risk you can close.

Unowned risks are how design docs age badly. A doc with five open questions
and no owners is not ready to circulate.

## Rollout, reversal and length

Say how the change reaches users, and how you would undo it. The second
question separates two-way doors from one-way doors. A new route is a two-way
door: delete it. A storage key, a URL scheme or a content schema is a one-way
door, because data or links outside your control will depend on it. One-way
doors deserve most of the doc's words.

Keep it to two pages. The template says so for a reason: past two pages,
people skim, and the decision gets made on the summary anyway. If you need
more, the design is probably two decisions.

## Circulate it and close it

Send it to the people named in "Decision needed from whom". Give them a
deadline. Answer every comment, either with a change or a reply that says why
not. Then close it: record the decision as a decision record in
`decisions/`, link the doc from it, and mark the doc's status. A doc that is
never closed keeps being reopened.

## What this looks like in DevPath

This repo's decisions mostly happened in review documents rather than design
docs, which makes the gaps easy to see. The progress schema v2 was designed
across a UX plan and two reviews; the reviewer of the UX plan had to write
"Migration needs the roadmap, which `progress.ts` does not have at `read()`
time" before the frozen-table design appeared. A problem section that had
stated "progress is parsed before content is loaded" up front would have
ruled out the runtime-rekey alternative in one line. The shipped `migrate`
in [progress.ts](../../app/src/lib/progress.ts) (line 260) says the
constraint in its doc comment: "Shape-only: it needs no content, so it can
run in read() before anything has been fetched." That sentence belonged in a
problem section.

The worked example for this chapter's exercise is also a real open question:
should this `upskilling/` folder be visible inside the app? Today it is not.
`copyDocs` in [build-content.mjs](../../scripts/build-content.mjs) (line 140)
copies project folders, four track-level files and `content/modules/`, and
nothing here matches. Links inside documents are rewritten at render time by
`resolveHref` in [markdown.ts](../../app/src/lib/markdown.ts) (line 105), and
LT-04 in [loose-threads.md](../loose-threads.md) records that some in-app
links already point at files that were never copied. Both facts belong in the
"Current state" section of any doc about this.

## Common failure modes

- The problem section describes the solution. Every comment becomes an
  argument about the proposal because nobody agreed on the problem.
- Alternatives are strawmen. Readers trust the rest of the doc less.
- Risks are worries without owners or dates, so they are still open when the
  code ships.
- The doc runs to eight pages. Readers skim, and the decision is made on the
  summary you wrote in five minutes.
- The doc is circulated and never closed. There is no record of what was
  decided or by whom.

## Exercise

Write a design doc, at most two pages, with
[templates/design-doc.md](../templates/design-doc.md) for "surface
`upskilling/` in the app".

1. Before writing, read `copyDocs` and `copyDocsInto` in
   [build-content.mjs](../../scripts/build-content.mjs) (lines 140–194),
   `resolveHref` in [markdown.ts](../../app/src/lib/markdown.ts), the
   `/doc/*` route in [App.tsx](../../app/src/App.tsx) (line 52), and LT-04 in
   [loose-threads.md](../loose-threads.md).
2. The problem section must name a user and must not mention a solution.
3. Include at least two alternatives plus "do nothing". One of them must
   respect the folder rules in the [folder README](../README.md) (no code
   files, no numbered directories under `upskilling/`), and at least one risk
   must be about test discovery picking up copied files (F-19 in the
   register is the time that already happened).
4. Name who decides and by when. Circulate it as a draft PR, or self-review
   after 48 hours with [the review checklist](../templates/review-checklist.md).
5. Close it with a decision record in `decisions/`. "We decided not to" is a
   valid outcome.

Done when the doc is in a PR, fits in two pages, has at least one risk with
an owner and a date, every comment on it is answered, and a decision record
links to it with a status.

Write in your journal: what did the problem section rule out that you had
planned to build?
