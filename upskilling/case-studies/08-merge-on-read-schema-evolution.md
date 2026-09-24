# 08. Merge-on-read: schema evolution in someone else's browser

A server-side database gets a migration script. You run it once, you watch it,
you roll it back if it fails. DevPath's database is `localStorage` in every
learner's browser. You cannot run anything against it. The only code that
will ever see an old payload is the app itself, at load time, on a machine you
will never look at. This case is about the pattern that follows from that, and
the bug that came from applying it in one place and not another.

## The decision

In `2220491` (2026-09-09) `read()` in `app/src/lib/progress.ts` did not trust
what it found in storage. It spread the defaults, then the parsed payload,
then merged the nested objects one level deeper, with the reason in a comment:

```ts
    // Merge rather than trust: a state written by an older build is missing keys.
    return {
      ...EMPTY,
      ...parsed,
      steps: parsed.steps ?? {},
      notes: parsed.notes ?? {},
      cards: parsed.cards ?? {},
      sessions: parsed.sessions ?? [],
      streak: { ...EMPTY.streak, ...parsed.streak },
      settings: { ...EMPTY.settings, ...parsed.settings },
    };
```

(`git show 2220491:app/src/lib/progress.ts | sed -n 71,81p`.) This is
merge-on-read. When a new build adds a setting, an old payload lacks it, and
the merge fills in the default. No migration step, no version check, and a
new field costs nothing.

The alternatives were versioned migrations (`v1 → v2` functions run in
order), validate-and-reset (any mismatch wipes the state), or a new storage
key per version. Merge-on-read is the cheapest of these for additive change,
which is most change. What it cannot handle is anything that is not additive:
a renamed field, a removed one, or a field whose *meaning* changes while its
name stays the same. It also validates nothing. `maxLevel: 7` would merge in
happily.

## What it hid

The pattern was applied in `read()` and not in `importState()`, the other
entry point where a whole state arrives:

```ts
  const parsed = JSON.parse(json) as Partial<ProgressState>;
  if (parsed.version !== 1) throw new Error('Unrecognised progress file');
  commit({ ...EMPTY, ...parsed } as ProgressState);
```

That spread is one level deep. Import a file whose `settings` is
`{ "seconds": 30 }` and the whole `settings` object is replaced. `maxLevel`
becomes `undefined`. `buildDrill` filters with `q.level <= options.maxLevel`,
and every comparison with `undefined` is `false`. Every drill in the app
shows "Nothing due here". It stays that way until the next page load, when
`read()` merges the defaults back in and the bug disappears, which makes it
very hard to report accurately.

The second thing it hid was a question nobody had to answer yet. The version
lived in two places: the key suffix (`devpath.progress.v1`) and a `version: 1`
field in the payload. What would v2 look like? The answer came sooner than
expected, because case [09](09-the-roadmap-as-data-and-stable-step-keys.md)
needed to change what every step key *means*. That is exactly the kind of
change merge-on-read cannot express.

## How it was found

A refactor plan written on 2026-09-23 found the
shallow spread by reading `importState` next to `read()` and tracing a partial
file through `buildDrill`. The journal review reached the same line
independently and called the plan's own description ("settings keys missing
until reload") an understatement: the real effect was an app with no
questions. The refactor plan's review then noted the same bug class in
`read()` was already guarded field by field, "so only import is affected
today". Three readers, one finding, and each one sharpened the consequence.
None of them needed to run the app. Reading two functions that should behave
the same, side by side, is the whole technique.

## What changed

`git diff 2220491 --stat -- app/src/lib/progress.ts` reported 429 insertions
and 59 deletions on 2026-09-24.
The parts that matter here:

- **One door.** The header now says it outright: "Everything that reaches
  `state` goes through parseProgress(migrate(raw)), whether it came from this
  tab's storage, another tab's write, or an imported file" (`:8-10`).
  `parseProgress` (`:200-223`) validates field by field and never throws; bad
  cards are dropped one at a time, bad settings fall back per field.
  `parseSettings` (`:169-180`) carries the fix in its comment: a file with
  only `{seconds: 30}` must not blank `maxLevel` (`:200-205`).
  `progress.test.ts:22` pins it ([F-04](../loose-threads.md)).
- **Versioned migration for what merging cannot do.** The payload is now
  `version: 2` (`:77-93`). `migrate()` (`:245-291`) runs only when
  `version === 1`, is shape-only so it needs no fetched content, and rekeys step
  ticks through a frozen table (case 09). A v1 key the table does not know is
  kept verbatim (`LEGACY[oldKey] ?? oldKey`, `:267`): nothing renders it, but
  it survives export and import. An earlier draft dropped such keys, against
  the migration spec's "never delete a tick"; the register records the change
  as [F-21](../loose-threads.md). Merge-on-read did not go away; it became
  `parseProgress`, and `migrate` handles the one non-additive change.
- **The key keeps its old name.** `KEY` is still `devpath.progress.v1`
  (`:14-16`), with the reason: renaming it would orphan every existing
  profile. The version lives in the payload only.
- **A rollback path.** Before migrating, `read()` copies the raw v1 string to
  `devpath.progress.v1.backup` once, then writes the migrated state straight
  back so a reload does not migrate again (`:336-348`). An unparseable payload
  is copied to `devpath.progress.corrupt-<timestamp>` before anything
  overwrites it (`:324-333`).
- **Import refuses the future.** `parseImport` (`:293-304`) rejects a
  `version` newer than `CURRENT_VERSION` with "This file was made by a newer
  DevPath" instead of guessing.

Why is this better than a migration script for browser storage? Because
there is nowhere to run the script. The migration has to live in the app,
run on every load, be idempotent, tolerate every older version for as long as
anyone might still have one, and never throw, because a throw at load time is
a white screen you will never hear about. Merge-on-read plus a small
versioned `migrate()` meets all five. A script meets none.

## What a junior, a mid and a senior would each have done

**Junior.** Writes the import feature by reusing the obvious line,
`{ ...EMPTY, ...parsed }`, because it looks like what `read()` does. Tests it
by exporting and re-importing their own state, which always has every field,
so the test passes. Sees nothing wrong.

**Mid.** Notices `read()` and `importState()` do the same job and extracts
one `normalise()` both call. Adds a test with a partial file. When the step
key change arrives, writes a `v1 → v2` function and bumps the version. Renames
the key to `devpath.progress.v2` to be tidy, and in doing so orphans every
existing profile, because nothing reads the old key any more. It is caught in
review if the reviewer thinks about installed users; otherwise in production,
silently.

**Senior.** Does what the mid did except the rename, and adds the three things
you only think of if you picture the data sitting in a stranger's browser: a
one-time backup of the raw payload before the first migration, a written
rule that `migrate()` must never throw, and a refusal for files from a
*newer* version. Then they write the migration down as a decision record,
because it is a one-way door for every learner who loads the new build. They
say in the PR who is affected ("anyone with v1 progress, on first load"),
what they see (nothing, if it works), and how to recover if it does not.

## Exercise

This case owns [LT-10](../loose-threads.md): both safety copies are
write-only. `git grep -n -e V1_BACKUP_KEY -e corrupt- app/src` finds the
constant, the corrupt-payload write, and the line that writes the backup.
That line's one `getItem` only checks that the backup is absent so it is not
overwritten; nothing restores from either copy. A learner whose migration
went wrong has a backup they can only reach through browser devtools, and
nobody has told them it exists. `migrate()` now keeps every v1 tick, even one
it cannot place on the path, so the migrated state itself loses nothing. The
backup is still the only copy of the payload *as it was*, and it is the thing
you would need if the legacy table itself turned out to be wrong.

Decide what recovery should look like, write it as a decision record in
`../decisions/` using [the template](../templates/decision-record.md), and
implement it on a branch. One option is a "Restore pre-upgrade progress"
button in `Settings.tsx` that appears only when the backup key exists and
feeds it through `parseImport`.

Done when: the record states who can lose data today and how they would find
out; a learner with a `devpath.progress.v1.backup` key can restore it without
devtools; a test (in `progress.test.ts` or a smoke file) seeds a backup,
restores it, and asserts the migrated ticks appear; and `npm test` passes. If
you decide recovery is not worth building, the record says why and names the
signal that would change your mind.

Write in your journal: the last schema change you made, and which old copies
of the data you could not reach to migrate.
