# Debugging production

**In production the first job is limiting the damage, then telling the people
affected, and only then finding the cause. The postmortem is part of the fix,
because the fix that matters most is the one that would have caught it
earlier.**

The method of debugging (narrowing, reproducing, bisecting) is in
[debugging-playbook.md](../../content/modules/debugging-playbook.md). Read it
there. This chapter adds the layer on top: owning an incident while it is
happening, and closing the gap that let it happen.

## Mitigate before you understand

When users are being hurt, a revert you understand beats a fix you don't. If
the last deploy is the likely cause, roll it back first and investigate
second. The question is not "do I know the cause?" but "can I stop the harm
without knowing it?"

Fixing forward is right when a revert would cause its own harm. The
classic case is a data migration that has already run: reverting the code
does not un-migrate the data, and the old code may not read the new shape.
That is why migrations need a backup and a way back before they ship, not
after.

## Communicate on a clock

Decide who needs to know, tell them early, and then update them on a
schedule even when nothing has changed. "Investigating; next update in 30
minutes" is a complete message. Silence is read as either "it's fixed" or
"nobody is looking", and both are wrong.

Say the impact in the user's terms first ("some learners' step ticks are
missing"), then what they can do ("don't reset your progress; it is not
lost"), then when you will update them. Leave the cause out until you know
it. A guessed cause that turns out wrong costs you the next message's
credibility.

## Evidence before hypotheses

When you cannot attach a debugger, write down what you know and how you know
it before you theorise. Separate reports ("three users say ticks vanished")
from facts ("the deploy at 14:02 renamed one project folder"). Every
hypothesis should predict something you can check. If it predicts nothing,
it is a story.

## DevPath's production is other people's browsers

DevPath has no server. It is a static bundle; everything a learner does lives
in their browser's `localStorage`. "Production" is thousands of browsers you
cannot see. There are no server logs, no error reports and no database to
query. When something goes wrong, you find out when a user tells you, if
they do.

So your tools are whatever the app gives the user, and what the code keeps
for you:

- **The export file.** Settings downloads the whole progress state as JSON
  (`download` in [Settings.tsx](../../app/src/routes/Settings.tsx), line 25,
  calling `exportState` in [progress.ts](../../app/src/lib/progress.ts), line
  577). Asking a user for their export is the closest thing to reading their
  database row. Treat it as personal data: it contains their notes.
- **The build stamp.** Settings shows when the content was generated
  (`content.stats.generatedAt`, Settings.tsx line 203), so a user can tell you
  which build they are on.
- **The backups.** The v1-to-v2 migration keeps the raw v1 payload under
  `devpath.progress.v1.backup`, and an unreadable payload is kept under
  `devpath.progress.corrupt-<ms>` (`read` in progress.ts, lines 311–350).
  Nothing in the app reads them back yet (LT-10 in
  [loose-threads.md](../loose-threads.md)), so recovery today means walking a
  user through devtools.
- **The error boundary.** A route that throws shows a message with Try again,
  Back to Today and Reload
  ([ErrorBoundary.tsx](../../app/src/components/ErrorBoundary.tsx), lines
  25–49), and logs to the console. The user sees `error.message`, which is
  what they can paste to you.

Because you cannot watch production, most of the detection has to happen
before shipping. That is why the build fails on a roadmap reference to a
missing project, deck or guide
([case study 01](../case-studies/01-fail-the-build-on-dangling-references.md)),
and why schema changes are handled by merge-on-read with a version number
([case study 08](../case-studies/08-merge-on-read-schema-evolution.md)).
[Chapter 10](10-designing-for-operability.md) covers designing for this.

## Close the detection gap

A postmortem that ends with "fixed the bug" has done half the job. For every
incident ask: why did nothing catch this before a user did? The answer
produces a *detect* action item: a test, a build check, a checklist line.
That item is the one that pays off, because it catches the next bug of the
same shape. Use [templates/postmortem.md](../templates/postmortem.md), and
mark each action item as prevent, detect or mitigate.

## What this looks like in DevPath

Step keys are now derived from what a step points at: `module/kind:target`
(`stepKey` in [types.ts](../../app/src/lib/types.ts), line 171). That
fixed the old failure, where inserting a step moved ticks. It created a
different one, which the roadmap review named in advance: changing a step's
*target* changes its key. Rename the project `js/86-sqlite-orders` (step in
`m-sql`, [roadmap.json](../../content/roadmap.json) line 759) and update the
roadmap to match, and the content build passes, because the new target
exists. Every learner's tick for that step is now stored under a key no step
uses. The tick is not deleted: `parseProgress` keeps any numeric step entry
(progress.ts, line 212), and the selectors look up only keys that exist on
the roadmap ([selectors.ts](../../app/src/lib/selectors.ts), line 14). The
data is intact and invisible.

Would a test catch it? Only for old steps. The test "every migrated v1 tick
lands on a real step" ([selectors.test.ts](../../app/src/lib/selectors.test.ts),
line 64) fails if one of the 195 targets in the legacy table disappears, so
renaming `js/01-fizzbuzz` would be caught. `js/86-sqlite-orders` was added
this iteration and is not in the table (`grep -c 86-sqlite
app/src/lib/legacy-step-keys.json` prints 0 on 2026-09-24), so nothing
guards it. The register tracks this gap as LT-15 in
[loose-threads.md](../loose-threads.md); 88 of the 283 step keys are
unguarded in the same way.

That last fact decides the mitigation. Because the old key survives, a
forward fix is possible: a small, versioned rename map applied on read, the
same mechanism as the legacy table. A revert of the content alone would also
work for learners who have not re-ticked the step since.

## Common failure modes

- You chase the cause while users are still being hurt, when a revert was
  available.
- You go quiet for two hours because there is "nothing new to say".
- You announce a cause before you have evidence, and have to retract it.
- You ship a migration with no backup, so the only mitigation is "sorry".
- The postmortem's action items all prevent this exact bug and none would
  detect the next one.

## Exercise

A tabletop exercise, in `journal/`, on the rename scenario above. Do not
change the roadmap on `main`.

1. Confirm the mechanism on a throwaway branch: tick the `m-sql` step for
   `js/86-sqlite-orders` in the app and export your progress. Rename the
   folder and its project id, update the step, run `npm run content` and
   `npm test`, and record which checks pass. Import the export and check
   what the Path page shows. Repeat the rename with `js/01-fizzbuzz` and
   record which test fails.
2. Write the timeline from the first user report, and the message you would
   post to learners in the first 30 minutes (under 80 words, impact first).
3. Choose revert or fix forward and say why in three sentences. Sketch the
   fix-forward: where the rename map would live, which schema version it
   needs, and what `migrate` would do.
4. Write the postmortem with [templates/postmortem.md](../templates/postmortem.md).
   At least one action item must be *detect*: something that fails the build
   or a test when a step's key changes between two versions of the roadmap.

Done when the entry contains the verified mechanism (with the command
output), the user message, the mitigation choice, and a postmortem with a
detect item. Add your reproduction to the LT-15 row in
[loose-threads.md](../loose-threads.md), with the date, so the row's
"reproduce first" becomes "verified". If step 1 does *not* reproduce the
gap, that is the more important finding: write down which check caught it.

Write in your journal: what would have told you about this incident if no
learner had reported it?
