# 09. The roadmap as data, and stable step keys

Putting a curriculum in a JSON file instead of in code is an easy decision to
agree with. This case is about the coupling it created without anyone
choosing it: every learner's saved progress depended on the *position* of
each step in that file. Three reviews found it independently. The fix is a
good example of changing a key that is already stored in thousands of places
you cannot reach.

## The decision

In `2220491` (2026-09-09) the whole curriculum was `content/roadmap.json`:
9 stages, 46 modules, 195 steps (136 build, 28 drill, 22 guide, 9 read). The
app never hard-codes it. `types.ts` gives it a TypeScript shape and
`validateRoadmap` in `scripts/build-content.mjs` checks that every step points
at something real (case [01](01-fail-the-build-on-dangling-references.md)).

The alternatives were TypeScript modules (typechecked content), markdown with
front matter, a headless CMS, or YAML. JSON bought a file a non-programmer can
edit, that diffs cleanly in review, and that the content pipeline can read
with no parser. It cost typechecking: a missing `title` or a string `minutes`
is caught only if the pipeline checks for it.

To remember which steps a learner had ticked, `types.ts` defined:

```ts
/** A stable id for one step, used as the progress key. */
export function stepKey(stageId: string, moduleId: string, index: number): string {
  return `${stageId}/${moduleId}/${index}`;
}
```

(`git show 2220491:app/src/lib/types.ts | tail -4`.) The comment says "stable".
It was stable for as long as nobody edited the roadmap.

## What it hid

Insert a step at position 1 of a module, and the new step inherits the tick
stored under `.../1`; every later tick in that module slides onto the step
before the one it was earned on. Delete a step and the ticks shift the other
way. Move a module to another stage and all its ticks point at nothing. None of
this throws. The learner opens the path and finds steps marked done that they
never did, and steps they did marked undone. It happens in every browser at
once, the moment a new build loads, and nobody can see it happen.

That is the hidden cost of data-as-schema: the data file had become part of
the storage schema for user state, and editing content had become a schema
migration without anyone deciding so.

## How it was found

Three planning documents written in parallel on 2026-09-23 each found it
without reading the others:

- The roadmap plan put it first among "facts that constrain every change",
  and responded by restricting itself: every edit would be additive only,
  steps appended at the end of modules.
- The review of the UX plan found that the UX plan would make it worse:
  putting the index key into drill URLs (`?step=`) and into session records
  meant bookmarks and history would rot on content edits too.
- The app-refactor plan proposed a v2 key and a migration.

When three people looking at different features trip over the same line,
the line is load-bearing. The additive-only rule was the tell: when a team
starts working around a constraint in every plan, the constraint should be
removed, not documented.

## What changed

The key is now derived from what the step points at, not where it sits
(`git diff 2220491 -- app/src/lib/types.ts`):

- `stepTarget(step)` (`types.ts:150-161`) returns the project, guide, deck (plus
  `|tags` for a tagged drill) or `doc#anchor`. `stepKey(moduleId, step)`
  (`:171-173`) returns `` `${moduleId}/${step.kind}:${stepTarget(step)}` ``,
  for example `m-values/build:js/01-fizzbuzz`.
- The build enforces the two facts that make the key unique: module ids are
  globally unique (`build-content.mjs:299-303`) and `kind:target` is unique
  within a module (`:307-309`). `build-content.mjs` imports `stepTarget` from
  `types.ts` (`:22`) so the build validates the exact key the app stores.
- Old keys are migrated once through a frozen table,
  `app/src/lib/legacy-step-keys.json` (195 entries), produced by
  `scripts/gen-legacy-step-keys.mjs` from the roadmap as it was in 2220491.
  Nine keys are overridden by hand (`gen-legacy-step-keys.mjs:36-46`): seven
  builds that moved module in the re-sequencing, and two drills whose deck was
  swapped. The generator imports `stepKey` from `types.ts` (`:22`), so it
  cannot disagree with the app about what a key looks like
  ([F-20](../loose-threads.md)). It checks each override exists and keeps its
  kind (`:64-71`) and refuses to overwrite its output without `--force`
  (`:48-51`), because a regenerated map would describe the new roadmap, not
  the one old progress was written against. `migrate()` in `progress.ts`
  applies it (case [08](08-merge-on-read-schema-evolution.md)).
- `selectors.test.ts:64-76` checks that every value in the legacy table is a
  real step key on the current roadmap. If a future edit removes a step that
  old progress maps to, that test fails.

**Why the module prefix, and why not the stage.** `kind:target` is unique
within a module but not across modules. On the 2220491 roadmap, 7 drill decks
were used by two or three modules each. On 2026-09-24 the same count over
today's `content/roadmap.json` found 24 targets used in more than one module:
23 drill decks (for example `drill:typescript` in four modules) and one guide
(`dependency-injection-explained` in two). A global `kind:target` key would
merge those ticks, so the module has to be in the key. The stage does not:
module ids are unique across the whole roadmap, so the stage adds no
information, and including it would make moving a module between stages
break every key in it. The roadmap review made that call to drop the stage
prefix, and three modules (`m-rest-api`, `m-sql`, `m-auth`) moved from
`s6-node-backend` to `s6-backend-concepts` in the same change without
touching a single key.

The roadmap is now 12 stages, 63 modules and 283 steps (169 build, 67 drill, 38
guide, 9 read), counted the same day. The worked decision record for the key
itself is
[decision-record-step-keys.md](../examples/decision-record-step-keys.md);
this case does not re-argue it.

## What a junior, a mid and a senior would each have done

**Junior.** Picks the index because it is unique and free, and writes
"stable id" in the comment because it is stable in every test. Nothing
suggests otherwise until a learner complains, and no learner will.

**Mid.** Asks "what happens when someone inserts a step?" before choosing,
and picks a content-derived key. Writes a migration that maps old keys
mechanically: position `n` in module `m` of the old roadmap becomes `m`'s
`kind:target`. Misses that the same release moves seven builds between
modules and swaps two decks, so those ticks land on the wrong step or on
nothing.

**Senior.** Does what the mid did, then treats the old roadmap as frozen
history: generates the map from the roadmap *as it was when v1 shipped*,
hand-writes the nine exceptions with a reason each, and makes the generator
refuse to run twice. Notices that the two deck swaps are a product decision, not
a technical one: someone who completed the "Git, tooling, CI/CD and deployment"
drill in `m-modules-tooling` is now credited with the "Modern JavaScript
(ES2020+)" drill that replaced it. Writes that down and asks whoever owns the
curriculum whether that is acceptable. Adds the coverage test so the next
roadmap edit cannot silently orphan a migrated tick. Then asks what is still
unprotected.

## Exercise

That last question is [LT-15](../loose-threads.md). Target-derived keys fixed
insertion and reordering. They made a different edit dangerous: changing a
step's target in place. Swap a drill's deck, point a build at a different
project, fix a read step's anchor, or change a drill's tags (tags are part of
the target), and the step gets a new key. Every learner's tick on the old key
is orphaned, silently, in every browser. The coverage test only protects the
195 keys in the v1 table; 88 of today's 283 keys were minted since, and
nothing protects them. `js/86-sqlite-orders` in `m-sql` is one of them.

Reproduce it first: on a branch, point one of the 88 unguarded steps at a
different existing target and confirm that `npm run content` and `npm test`
both pass. Then design and build a guard. One approach: commit a snapshot of
every current step key, and fail the content build when a key disappears
from the roadmap without a mapping entry that says where its ticks go. Decide
first where the mapping lives and how `migrate()` would apply it without a v3
schema for every edit. Write that as a decision record in `../decisions/`.

Done when: your reproduction (the edit and both passing commands, with the
date) is in the LT-15 row or your journal; on a branch with your guard, adding
a `tags` array to one drill step in `content/roadmap.json` (choose tags enough
of its deck's questions carry, or the existing pool-size check fails first and
hides your guard) makes `npm run content` exit non-zero with a message naming
the old and new keys; adding a mapping entry makes it pass; a test in
`scripts/build-content.test.mjs` covers both; the decision record explains what
happens to learners' ticks under your mapping; `npm test` passes; and LT-15
has moved to the register's fixed table.

Write in your journal: one identifier in a system you know that is derived
from something that can change, and what breaks when it does.
