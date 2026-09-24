# Loose threads

This is the one register of known weaknesses in DevPath. Every other file in
`upskilling/` links here instead of restating a finding. Each finding appears
once, with where it lives, how it was verified, and which case study owns the
analysis.

It doubles as your evidence index. When you fix an open thread, move it to
the fixed table with the fix in one line and a link to your PR. Then cite
the row in your matrix self-assessment.

## Status words

- **verified**: checked against the current code with the command or reading
  given. You can state it as fact.
- **reproduce first**: the code reading says it is so, but nobody has watched
  it happen. Reproduce it (preferably in a test) before you state it or fix it.
- **latent**: the weakness is real, but nothing is broken today. It needs a
  specific future change to bite.
- **question**: a design choice worth arguing about, not a defect.
- **FIXED in this iteration**: fixed in the working tree on
  `feat/devpath-v2` after commit `2220491`, during the adversarial-review
  iteration of 2026-09-23/24. The row gives the fix in one line.

All checks below were run on 2026-09-24 with Node v24.19.0, from the repo
root, against the working tree after the last fix of that iteration landed.

## Open

| ID | Finding | Where | Status and evidence | Owner |
|---|---|---|---|---|
| LT-03 | Two validation styles. `validateRoadmap` collects every problem and throws once; `loadQuestions` throws on the first bad question. | [scripts/build-content.mjs](../scripts/build-content.mjs) | **question**: verified by reading. Which one do authors want when they have five mistakes? | [01](case-studies/01-fail-the-build-on-dangling-references.md) |
| LT-04 | In-app links with nothing behind them. The root `README.md` links six directories: `upskilling/`, `react/`, `typescript/`, `csharp/`, `content/modules/` and `content/questions/` (lines 28, 116–118, 290 and 293). They work on GitHub. In the app, `resolveHref` turns each one into a `#/doc/<dir>` route, and no file exists at that path. | `resolveHref` in [app/src/lib/markdown.ts](../app/src/lib/markdown.ts); `copyDocsInto` in [scripts/build-content.mjs](../scripts/build-content.mjs) | **verified** on 2026-09-24. A throwaway script walked the 752 `.md` files under `app/public/docs`, collected links with marked's lexer (so code spans are skipped), passed each through the real `resolveHref` and checked the target on disk: 197 in-app links, 6 with nothing behind them, all six listed here. What a click shows is **reproduce first**. The two links from `86-sqlite-orders/README.md` into `../content/modules/` used to break too; `resolveHref` now maps `content/modules/<id>.md` to `#/guide/<id>` (`markdown.test.ts`, "a README link into content/modules/ opens the guide route…"). Earlier counts of four and seven predate that change. | [03](case-studies/03-hashrouter-and-links-at-render-time.md) |
| LT-07 | A fresh clone's `npm test` fails until `npm run content` has run. The smoke suites and one selectors test read generated files. | `boot` in `app/src/testing/harness.ts`; the migration test in [app/src/lib/selectors.test.ts](../app/src/lib/selectors.test.ts) | **verified** by reading. Both say "run `npm run content` first". | [06](case-studies/06-it-builds-is-not-it-renders.md) |
| LT-08 | Node runs the `.ts` sources by stripping types, but `erasableSyntaxOnly` is not set. An `enum` added to `app/src/lib/` would pass `npm run typecheck` and fail at `npm test` runtime. | [app/tsconfig.app.json](../app/tsconfig.app.json) | The missing flag is **verified** with `grep -n erasable app/tsconfig*.json` (no output). The runtime failure is **reproduce first**. | [06](case-studies/06-it-builds-is-not-it-renders.md) |
| LT-09 | The scheduler's constants. A wrong answer takes a flat 0.2 off ease, wherever SM-2's formula would put it. A slow correct answer (quality 3.5) lowers ease by 0.065. The 8-second "quick" threshold is the same for a one-line question and a 20-line code snippet. | `scheduleCard` in [app/src/lib/progress.ts](../app/src/lib/progress.ts) | **question**: verified by reading. 0.1 − 1.5 × (0.08 + 1.5 × 0.02) = −0.065. | [02](case-studies/02-sm2-trimmed-for-multiple-choice.md) |
| LT-10 | Backups nobody can restore. The migration writes the raw v1 payload to `devpath.progress.v1.backup`, and an unreadable payload goes to `devpath.progress.corrupt-<ms>`. No code reads either key back, so restoring means opening devtools. | `read` in [app/src/lib/progress.ts](../app/src/lib/progress.ts) | **verified**: `git grep -n -e V1_BACKUP_KEY -e corrupt- app/src` finds the constant, the corrupt-payload write, and one line whose `getItem` only stops the backup being overwritten. Nothing restores from either key. | [08](case-studies/08-merge-on-read-schema-evolution.md) |
| LT-12 | The content pipeline imports app source. `build-content.mjs` imports `stepTarget` from `../app/src/lib/types.ts`, and `headingIds` and `tableOfContents` from `../app/src/lib/markdown.ts`. The build script therefore depends on Node's type stripping, on the app's file layout, and (through `markdown.ts`) on `marked` and `highlight.ts`. | lines 22–23 of [scripts/build-content.mjs](../scripts/build-content.mjs) | **question**: verified by reading. The import buys one source of truth for the key and the heading ids, and the price is coupling. Compare LT-08. | [09](case-studies/09-the-roadmap-as-data-and-stable-step-keys.md) |
| LT-13 | The roadmap's shape is not validated. `validateRoadmap` checks references and uniqueness, but not that a step has a `title` or a numeric `minutes`. A typo in either reaches the app. | `validateRoadmap` | **verified** by reading. | [09](case-studies/09-the-roadmap-as-data-and-stable-step-keys.md) |
| LT-14 | The product boundary lives in two places with two wordings: `README.md` line 30 ("Deliberately not here: LeetCode and DSA grinding") and `notOnThisPath` in `content/roadmap.json` line 5. | [README.md](../README.md), [content/roadmap.json](../content/roadmap.json) | **question**: `git grep -n -i -e dsa -e leetcode -- README.md content/roadmap.json`. Where should a scope decision live so it can't drift? | [07](case-studies/07-deleting-the-dsa-track.md) |
| LT-15 | Editing a step's target in place orphans its tick. Keys are `module/kind:target`, so a change to a drill's deck or tags, a build's project, or a read step's doc or anchor creates a new key. Every learner's tick on the old key stays in storage with no step to show it. The build passes, because the new target exists. | `stepKey` and `stepTarget` in [app/src/lib/types.ts](../app/src/lib/types.ts); the coverage test in [app/src/lib/selectors.test.ts](../app/src/lib/selectors.test.ts) | **verified** by reading and counting on 2026-09-24. The test "every migrated v1 tick lands on a real step…" guards only the 195 keys in `legacy-step-keys.json`. 88 of today's 283 step keys are not in that table (`grep -c 86-sqlite app/src/lib/legacy-step-keys.json` prints 0). What the learner sees is **reproduce first**. | [09](case-studies/09-the-roadmap-as-data-and-stable-step-keys.md) |

## Fixed in this iteration

A row that started as an open thread keeps its old ID in brackets, so links
and self-assessments that cite it still resolve.

| ID | Finding | Fix, in one line | Regression guard | Owner |
|---|---|---|---|---|
| F-01 | `#/drill/:deck?count=abc` showed "Nothing due here" for a full deck: `Number('abc')` is `NaN`, and `slice(0, NaN)` is `[]`. | `parseDrillParams` in `app/src/lib/session.ts` parses every drill URL; a non-finite count falls back to 15 (40 for a mock) and the rest are clamped to 1–60. | `session.test.ts` "parseDrillParams clamps count"; `app.drill.smoke.test.ts` "a hand-typed count=abc…" | [weekly entry example](examples/weekly-entry-2026-w39.md) |
| F-02 | In development (StrictMode), a timed-out question was graded twice: two lapses, ease −0.4, a duplicated summary row. | `Countdown` in `DrillSession.tsx` counts against a fixed deadline and calls `onExpire` from the interval callback, never inside a state updater, behind a once-ref; `answer` also guards with `answeredIndex`. | `app.drill.smoke.test.ts` "a timeout grades the question exactly once under StrictMode" | [postmortem example](examples/postmortem-strictmode-double-grade.md), [06](case-studies/06-it-builds-is-not-it-renders.md) |
| F-03 | A literal U+0000 in a test string made git treat `app/src/lib/lib.test.ts` as binary, so its tests never appeared in a diff. | The literal is now an escape sequence. `git diff --no-index --numstat /dev/null app/src/lib/lib.test.ts` now reports 258 text lines. | none: a control-character check is still open work | [06](case-studies/06-it-builds-is-not-it-renders.md) |
| F-04 | Importing a file whose `settings` was partial left `maxLevel` undefined, so every drill rendered empty until reload. | `parseImport` runs `parseProgress(migrate(raw))`, and `parseSettings` defaults each field on its own. | `progress.test.ts` "import with partial settings keeps the defaults…" | [08](case-studies/08-merge-on-read-schema-evolution.md) |
| F-05 | With two tabs open, the last `commit()` overwrote the other tab's whole state. | A `storage` event listener in `progress.ts` re-reads and notifies. | `app.nav.smoke.test.ts` "another tab's write reaches this tab…" | [05](case-studies/05-local-first-progress-and-a-hand-rolled-store.md) |
| F-06 | Step ticks were keyed by array index (`stage/module/index`), so inserting a step moved everyone's ticks. | `stepKey(moduleId, step)` is `module/kind:target`; v1 keys migrate once through the frozen `legacy-step-keys.json`. | `progress.test.ts` "v1 → v2 …" tests; `selectors.test.ts` 0-orphans test; `app.nav.smoke.test.ts` "a v1 profile is migrated on load…" | [09](case-studies/09-the-roadmap-as-data-and-stable-step-keys.md), [decision record example](examples/decision-record-step-keys.md) |
| F-07 | Bare `#section` links in the TS and C# handbooks became the route `/section` and landed on NotFound. | `resolveHref` prefixes the current document's `routePath`. | `markdown.test.ts`; `app.nav.smoke.test.ts` | [03](case-studies/03-hashrouter-and-links-at-render-time.md) |
| F-08 | TOC links and heading ids came from separate slug logic and could disagree. | One `slugify` and a per-document `createSlugger` used by both the renderer and `headings()`. | `markdown.test.ts` "every TOC entry of every real doc lands…" | [03](case-studies/03-hashrouter-and-links-at-render-time.md) |
| F-09 | `highlightMarkup` could corrupt its own spans; a dead `const flags = lang === 'sql' ? '' : ''` sat in the keyword rule. | Markup highlighting rewritten, the dead line removed, and a `css` branch added. | `highlight.test.ts` | [04](case-studies/04-a-hundred-line-highlighter.md) |
| F-10 | `useKey` swallowed Enter and Space on a focused button or link. | `shouldIgnoreKey` in `hooks.ts` leaves them to any activatable element. | `app.drill.smoke.test.ts` "Enter on a focused choice is left to the button…" | none |
| F-11 | A comment said interval 0 meant "again this session"; the session's question list is fixed at start. | The comment now says "due now: the next drill serves it first". | none (a comment) | [02](case-studies/02-sm2-trimmed-for-multiple-choice.md) |
| F-12 | `topicStats` counted never-seen questions as due. | Unseen questions are counted as `fresh`, never `due`. | `lib.test.ts` "topicStats counts totals…" | [02](case-studies/02-sm2-trimmed-for-multiple-choice.md) |
| F-13 | `vite.config.ts` raised `chunkSizeWarningLimit` to 900 to silence a warning that was not firing. | The override is gone. `npm run build` on 2026-09-24 produced a 399,437-byte main chunk, under Vite's 500 kB default. | Vite's own warning | [01](case-studies/01-fail-the-build-on-dangling-references.md) |
| F-14 | Link `title` attributes were interpolated unescaped. | `escapeAttr` on `href` and `title`. | `markdown.test.ts` "link titles and hrefs are attribute-escaped" | [03](case-studies/03-hashrouter-and-links-at-render-time.md) |
| F-15 | In 91% of questions the correct choice was the longest, so "pick the long one" scored about 90% (measured 2026-09-23). | `scripts/check-questions.mjs` fails any deck above 40%, and the content build runs it. | the gate itself | [01](case-studies/01-fail-the-build-on-dangling-references.md) |
| F-16 (was LT-01) | `read` steps were not validated. A step pointing at a missing doc or a stale `#anchor` passed the build. | `validateRoadmap` fails a read step whose `doc` is not a shipped doc, or whose anchor is not a heading id. The ids come from `headingIds`, imported from `markdown.ts`, so the check uses the renderer's own slugger rather than a copy. | `build-content.test.mjs` "read steps: an unshipped doc fails, an anchor that is not a heading fails, a real heading passes" | [01](case-studies/01-fail-the-build-on-dangling-references.md) |
| F-17 (was LT-02) | The `headingIds` doc comment said it was "used by the content build to validate anchors", and nothing called it. | The caller now exists (F-16), so the comment is true. | the F-16 test | [01](case-studies/01-fail-the-build-on-dangling-references.md) |
| F-18 (was LT-05) | Search built guide-section links by running `slugify` over the raw markdown heading. The renderer slugs rendered text and numbers duplicates, so the two could disagree. | The content build writes each guide's `headings` into `guides.json` as `{ id, text }[]` from `tableOfContents`, and `buildSearch` in `search.ts` uses those ids. | `app.loop.smoke.test.ts` "a section hit lands on a heading that exists in the rendered guide"; `markdown.test.ts` duplicate-heading test | [03](case-studies/03-hashrouter-and-links-at-render-time.md) |
| F-19 (was LT-06) | `npm test` ran `node --test` with no file list, so it also found the copies of project tests under `app/public/docs/` and `app/dist/docs/`. The count depended on which generated folders were on disk: 2,693, 3,546 and 4,075 in separate runs on 2026-09-24. | The root `package.json` `test` script passes explicit globs: `app/src/**/*.test.ts`, `scripts/**/*.test.mjs`, `[0-9][0-9]-*/**/*.test.js`, `react/**/*.test.js`. After the fix, `time npm test` on 2026-09-24 reported 996 tests, 0 failing, in 38 s on the machine used for this journal. | none: a test file outside those four globs would silently not run | [06](case-studies/06-it-builds-is-not-it-renders.md) |
| F-20 (was LT-11) | The legacy-key generator carried its own `target()` with the comment "Must match stepKey()", but had no branch for the tags suffix `stepTarget` adds to a tagged drill. | `scripts/gen-legacy-step-keys.mjs` imports `stepKey` from `app/src/lib/types.ts`, so there is one definition. | `selectors.test.ts` 0-orphans test; the table is frozen, and the generator refuses to overwrite it without `--force` | [09](case-studies/09-the-roadmap-as-data-and-stable-step-keys.md) |
| F-21 | `migrate()` dropped v1 step ticks whose key the legacy table did not know, although the migration spec said never to delete a tick. | `LEGACY[oldKey] ?? oldKey` keeps an unknown key verbatim. Nothing renders it, but it survives export and import, and the raw v1 payload is still backed up. | `progress.test.ts` "v1 → v2 rekeys steps through the frozen map, applies overrides, keeps unknown keys verbatim" | [08](case-studies/08-merge-on-read-schema-evolution.md) |

## Adding a finding

1. Reproduce it, or mark it **reproduce first**. Don't state what you haven't
   seen.
2. Give it the next `LT-` number (the next free one is LT-16). Numbers are
   never reused, so links stay valid.
3. Name the file and the symbol, the command or reading that verified it, the
   date, and the case study that owns the analysis. Write "none" when no case
   study owns it.
4. When you fix it, move the row to the fixed table with the next `F-`
   number, keep the old ID in brackets ("F-22 (was LT-08)"), write the fix
   in one line and link your PR.
