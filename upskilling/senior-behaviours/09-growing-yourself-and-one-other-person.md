# Growing yourself and one other person

**Nobody else will manage your growth: you choose deliberate practice on
your weakest dimension and keep the evidence as you go. The same discipline,
pointed at one other person for thirty minutes a week, is what mentoring is,
and it is the part of senior that multiplies.**

More years in a role do not make you senior. More of the same work makes you
faster at that work. Growth comes from work chosen because it is hard for
you, done with feedback, and written down so you can see the change.

## The matrix is a map, not a scorecard

[competency-matrix.md](../competency-matrix.md) has ten dimensions and three
columns. Use it to choose the next piece of work, not to grade yourself. Its
rules are the useful part: every claim links to evidence, and a level is held
when you have done it twice, unprompted. Expect to be uneven. Your two
weakest dimensions are where the next month goes.

## Deliberate practice, and where to find it

Deliberate practice has three parts: a task slightly beyond you, fast
feedback, and repetition on the weak spot rather than the whole skill. You
do not need a new job for it. This repo lists its real open work in
[loose-threads.md](../loose-threads.md), and each row names the file, the
evidence and the case study that owns it. Pick rows by dimension:

| Weakest dimension | A row that exercises it |
|---|---|
| Testing | LT-07: a fresh clone's tests depend on generated files |
| Design | LT-12: the pipeline imports app source |
| Debugging | LT-08: an `enum` would pass typecheck and fail at test runtime |
| Ownership | LT-10: backups nobody can restore |
| Operating in ambiguity | LT-14: the product boundary lives in two places |

Ask for the next role's work before you have the title. Offering to write
the design doc, run the incident review or review the risky PR is how you
get the evidence the title needs.

Avoid the tool-collector trap: learning a new framework feels like growth
and rarely touches your weakest dimension. If your weakest dimension is
communication, a new state library will not move it.

## Keep the evidence trail

Write the weekly entry ([template](../templates/weekly-entry.md)) in
`journal/`. Put decisions in `decisions/`. Link both from your
self-assessment every 30 days. The trail has two uses: it shows you the
change you cannot feel week to week, and it is the raw material for the
stories in [interview-playbook.md](../../content/modules/interview-playbook.md).

## Growing one other person: the weekly 30 minutes

Pick one person earlier on the path than you, and meet for 30 minutes at
the same time every week. The DevPath roadmap gives the sessions a spine:
12 stages, each module with a `why`, interview focus points and steps. Use
this agenda and keep to it.

1. **Five minutes: their week.** They show you what they did. The Progress
   page's heatmap
   ([ProgressView.tsx](../../app/src/routes/ProgressView.tsx), line 41) shows
   cards and steps per day, if they choose to share it. Ask what was hard,
   not what was done.
2. **Fifteen minutes: one artefact, and they drive.** A `build` step they
   finished, or a drill question they got wrong twice. They explain it; you
   ask questions. "What would break if this input were empty?" teaches more
   than the answer. Resist taking the keyboard.
3. **Five minutes: one piece of feedback** in the form from
   [chapter 08](08-giving-feedback.md): situation, behaviour, impact, one
   suggestion. One piece, not five.
4. **Five minutes: their next commitment**, written by them, with a
   "done when". Next week starts by checking it.

Delegate real work, not errands. A good first delegation is a loose thread
with a clear verification step, such as LT-13, where "done" is a build
that fails on a step with no `title`, proved by a test. Check the row is
still in the Open table first; the register moves fixed rows as they land.

## Assessing someone against the matrix

Assess only two dimensions at a time, and have them self-assess first. Your
job is to compare their evidence with the cells, not to hand down a grade.
For each dimension ask: which link shows this? Was it prompted? Has it
happened twice? Where you disagree, name the missing evidence ("I haven't
seen a failing-first test yet") rather than the level. Record the result in
their journal, using the table at the bottom of the matrix, so the next
assessment starts from something written.

## The solo substitute

If you have nobody to mentor, write for the next learner instead. Write a
walkthrough of one file (`progress.ts` is the obvious candidate: store,
validation and migration in one place) as a numbered list of things to read
and questions to answer. Then have the next learner of this repo follow it,
or, if there is none, follow it yourself in 30 days without your notes. Log
every place it failed: a step that assumed knowledge, a question with no
findable answer, a line number that had drifted. Those failures are your
mentoring feedback.

## What this looks like in DevPath

The `check-questions.mjs` gate is mentoring at scale. A reviewer noticed that
in 91% of questions the longest choice was the correct one (measured
2026-09-23), so "pick the long one" scored about 90%. Instead of telling
each deck author, the fix became a gate: `scripts/check-questions.mjs`
fails any deck above 40% (F-15 in [loose-threads.md](../loose-threads.md)).
Every future author learns the rule from the build without anyone having to
explain it. When you answer the same question twice, look for the version of
the answer that does not need you.

## Common failure modes

- You self-assess as a scorecard, feel bad or good, and choose no work.
- You grow the dimension you already enjoy.
- Mentoring sessions become you solving their problem while they watch.
- You give five pieces of feedback per session, and none is acted on.
- The sessions are never written down, so neither of you can see progress.

## Exercise

Run four weekly sessions with one person, or the solo substitute.

- **With a mentee:** use the agenda above for four weeks. After week four,
  assess two matrix dimensions with them, and ask them in writing: "What
  should I stop doing in these sessions?"
- **Solo:** write a walkthrough of
  [progress.ts](../../app/src/lib/progress.ts) with at least ten numbered
  steps and five questions, as a section of that week's
  `journal/YYYY-Www.md` entry. Follow it after 30 days (or have another learner
  follow it) and log every failure point.

Done when your journal has four dated session notes, each ending with the
mentee's written commitment, plus the two-dimension assessment and their
answer to the "stop doing" question. Solo, done when the walkthrough is
committed, the 30-day follow-through log lists every failure point, and the
walkthrough has been revised to fix them.

Write in your journal: what did you do in the sessions that made the other
person slower, and how do you know?
