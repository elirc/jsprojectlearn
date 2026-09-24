# 0001. Key step progress by what a step points at, and migrate old keys through a frozen table

*Worked example. This is the real decision behind F-06 in
[loose-threads.md](../loose-threads.md), reconstructed from the planning and
review documents of 2026-09-23 and the code that shipped in the working tree
on `feat/devpath-v2`. The analysis of the trade-off belongs to
[case study 09](../case-studies/09-the-roadmap-as-data-and-stable-step-keys.md);
this file shows what the record looks like.*

- Status: Accepted
- Date: 2026-09-23
- Deciders: the repo author, who accepted it, after the app-refactor plan
  proposed it and the UX and roadmap reviews amended it
- Door: **one-way**. The key is persisted in every learner's `localStorage`
  and in every exported progress file.

## Context

- In commit `2220491`, `stepKey(stageId, moduleId, index)` in
  `app/src/lib/types.ts` returned `` `${stageId}/${moduleId}/${index}` ``.
  `progress.steps` maps that key to a completion timestamp.
- Inserting or reordering a step silently moves every later tick in that
  module onto a different step. It happens in every learner's browser, and
  nobody can see it happen. There is no server to notice.
- The roadmap was about to be re-sequenced: the s6 stage split, five builds
  moved next to their guides, two drill decks swapped. Nine existing steps
  changed module or target. Under index keys, that edit would have corrupted
  existing progress.
- Facts checked on the 2220491 roadmap: 46 module ids, all globally unique;
  195 steps; `kind`+target unique within every module (0 duplicates).
  *Across* modules, 7 drill decks are reused by 2–3 modules each, so a key
  without the module would collide. (On the re-sequenced roadmap of
  2026-09-24 the count is 24 targets: 23 drill decks and one guide.)
- `progress.ts` loads synchronously at import time. The content (and so the
  roadmap) arrives later, by `fetch`. Any migration that needs the roadmap
  cannot run inside `read()`.

## Options

1. **Do nothing, plus a rule: append steps only, never reorder.** Cost:
   relies on every author remembering, forever. It also blocks the
   re-sequencing that was the reason for acting.
2. **An explicit `id` on every step in `roadmap.json`**, validated unique by
   the build (the first plan's proposal). Robust against any edit. Cost: 195
   ids to author now and one more field on every new step. A copied step
   with a copied id is a new failure mode.
3. **`stage/module/kind:target`** (the UX review's proposal). No authoring
   burden. Cost: moving a whole module between stages changes all its keys.
   The re-sequencing moves three modules, so that is nine more map lines.
4. **`module/kind:target`** (the roadmap review's amendment). Module ids are
   already globally unique, so the stage adds nothing but fragility. Cost:
   the build must now enforce module-id uniqueness.
5. **Global `kind:target`**, with no module. Rejected on the facts: seven
   drill decks appeared in more than one module then, and 24 targets do now.

And for the migration of existing v1 keys:

- **(a) Rekey at load time against the current roadmap**, in `ContentGate`
  after content arrives. Cost: couples progress to content. Worse, it reads
  *old positions* through the *new* roadmap, which is exactly wrong once the
  roadmap has been edited.
- **(b) A table generated once from the 2220491 roadmap, frozen**, applied
  by a shape-only `migrate()` that needs no content. Cost: a 14,919-byte
  JSON file in the bundle (`wc -c app/src/lib/legacy-step-keys.json`), and a
  generator that must never be re-run.

## Decision

I will key steps as `module/kind:target` (option 4). The target is the
project, guide or deck id, or `doc#anchor` for a read step. Tagged drills,
added later in the same iteration, extend the target with `|tags`, because
a tagged drill of a deck is a different step from the untagged one. `stepKey(moduleId,
step)` and `stepTarget(step)` in
[app/src/lib/types.ts](../../app/src/lib/types.ts) are the single definition.

I will migrate v1 progress through a frozen table (migration option b).
[scripts/gen-legacy-step-keys.mjs](../../scripts/gen-legacy-step-keys.mjs)
maps each old key mechanically to the same module's `kind:target`, applies
nine hand overrides for the steps that moved, and refuses to overwrite its
output without `--force`. The output,
[app/src/lib/legacy-step-keys.json](../../app/src/lib/legacy-step-keys.json),
has 195 entries. `migrate()` in
[app/src/lib/progress.ts](../../app/src/lib/progress.ts) runs when
`version === 1`. `read()` first saves the untouched v1 string to
`devpath.progress.v1.backup`, then writes the migrated v2 state back so a
reload doesn't migrate again. The storage key keeps its `.v1` name on
purpose, because renaming it would orphan every profile. The version lives
in the payload.

`validateRoadmap` in `scripts/build-content.mjs` fails the build on a
duplicate module id or a duplicate `kind:target` within a module. Those are
the two conditions that would let two steps share one tick.

## Consequences

- Good: inserting or reordering steps no longer moves anyone's ticks, and a
  module can move stage at no cost. On the re-sequenced roadmap (12 stages,
  63 modules, 283 steps on 2026-09-24), all 195 legacy keys land on a real
  step: 0 orphans.
- Good: migration needs no content, so it runs in `read()` before the first
  render.
- Bad: changing a step's *target* (swapping a deck, renaming a project)
  changes its key. From v2 on, that needs a v2→v3 map line. I consider this
  correct: a different target is a different piece of work.
- Bad: v1 keys the table doesn't know are kept verbatim
  (`LEGACY[oldKey] ?? oldKey` in `migrate`). No step renders them, so they
  are invisible, but they survive export and import and nothing is deleted.
  An earlier draft dropped them; F-21 in
  [loose-threads.md](../loose-threads.md) records the change. The raw v1
  payload is also backed up, but nothing restores it (LT-10).
- Bad: only keys in the frozen table are guarded. A later in-place change to
  a step's target orphans its tick and the build still passes (LT-15).
- Follow-up, done: the generator imports `stepKey` from `types.ts` instead of
  carrying its own copy of the target rule (F-20).
- Follow-up, done: the tests in `app/src/lib/progress.test.ts` ("v1 → v2
  rekeys steps through the frozen map, applies overrides, keeps unknown keys
  verbatim"), the test in `app/src/lib/selectors.test.ts` ("every migrated v1
  tick lands on a real step of the current roadmap"), and the smoke test in
  `app/src/app.nav.smoke.test.ts` ("a v1 profile is migrated on load…").

## Revisit when

- a module legitimately needs the same target twice (for example, two
  sections of one doc without anchors);
- a step's target changes on a roadmap that has shipped v2, which requires
  a `version: 3` and a new frozen map;
- someone proposes renaming a module id.
