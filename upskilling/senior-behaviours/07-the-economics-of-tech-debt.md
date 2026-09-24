# The economics of tech debt

**Tech debt is a loan: the principal is what it costs to fix, and the interest
is what it costs you every week you don't. A senior prices both, in hours or
bytes or users affected, and pays down the debt whose interest compounds, not
the debt that offends them most.**

"This code is messy" is not an argument anyone can act on. "This costs every
contributor four minutes per test run, and fixing it takes two hours" is. The
difference is numbers, and the numbers in this chapter come from this repo.

## Principal and interest

The **principal** is the one-off cost of fixing the thing: code, tests,
migration, review, and the risk of the change itself. The **interest** is the
recurring cost of living with it: slower work, bugs of a particular shape,
workarounds, onboarding time, or a cost users pay.

Most debt has low, flat interest. You can carry it for years and never regret
it. Some debt has interest that compounds: every week makes the fix larger.
Those are the ones to pay early, and they are usually about data or
interfaces other people depend on, because those accumulate dependants.

## Worked number 1: the hand-rolled store

`progress.ts` is a hand-rolled external store rather than a library
([progress.ts](../../app/src/lib/progress.ts), header lines 1–11; analysis in
[case study 05](../case-studies/05-local-first-progress-and-a-hand-rolled-store.md)).
On 2026-09-24 the file was 588 lines (`wc -l`). Split by section:

| Section | Lines | Would a library replace it? |
|---|---|---|
| Store plumbing: `read`, `commit`, the `storage` listener, `progressStore` | 307–405 (about 100) | Yes |
| Validation: `parseCard` … `parseProgress` | 111–223 (about 110) | No |
| Migration: `migrate`, `parseImport` | 225–305 (about 80) | No |

For comparison, `zustand` with its `persist` middleware is a few kilobytes.
One measurement on 2026-09-24 (version 5.0.15, bundled alone in a scratch
folder with `npx esbuild entry.js --bundle --minify --external:react`) gave
2,708 bytes, 1,359 gzipped. Repeat it before you quote it. Bytes are not the
argument either way.

The economics: a library would retire about 100 lines of plumbing. It would
not retire the 190 lines of validation and migration, because a persist
layer hands you an unknown stored blob and you still have to parse it. The
interest on the hand-rolled plumbing has been real but small: the two-tab
overwrite (F-05 in [loose-threads.md](../loose-threads.md)) was a plumbing
bug. Check a library's documentation before you claim it would have
prevented that one; cross-tab sync is often opt-in. Against that, the file
is the worked example for two projects in the React track (header lines 5–6),
which is value a library cannot give. Verdict: carry it.

## Worked number 2: the hundred-line highlighter

[highlight.ts](../../app/src/lib/highlight.ts) is 160 lines (6,891 bytes of
source, `wc -c`) instead of highlight.js
([case study 04](../case-studies/04-a-hundred-line-highlighter.md)). Measured
on the morning of 2026-09-24, against the working tree of that moment:

| Build | Main chunk | Gzipped |
|---|---|---|
| `npm run build` as it stood | 398.78 kB | 125.98 kB |
| Same app, highlight.js 11.12.0 core with 8 grammars | 461.85 kB | 146.24 kB |
| Difference | +63.07 kB (+15.8%) | +20.26 kB (+16.1%) |

The app kept changing that day: the last `npm run build` on 2026-09-24
reported a 399.44 kB main chunk, 126.65 kB gzipped. The delta is what
matters, and it should not have moved much, but a number measured against
code that has since changed is a number to re-measure before you quote it.

Method: a scratch Vite config outside the repo pointed `root` at `app/` and
redirected imports of `highlight.ts` to a 25-line shim that registered
JavaScript, TypeScript, C#, SQL, JSON, XML, CSS and Bash. A control build
with the same config and no redirect produced the identical committed chunk
(same hash), so the difference is the library. Nothing in the repo changed.

The interest on the hand-rolled version is approximation bugs:
`highlightMarkup` used to corrupt its own spans (F-09). The principal of
switching is small in code but permanent in weight: every learner downloads
an extra 20 kB gzipped on every cold load, for a highlighter that is
"good enough to read code by" today. Verdict: carry it, and write down the
trigger that would flip it (a fifth language, or a second highlighting bug).

## Worked number 3: the index-based step key

Progress v1 keyed ticks by position (`stage/module/index`). The fix is done:
`stepKey` in [types.ts](../../app/src/lib/types.ts) (line 171), a frozen
195-entry [legacy-step-keys.json](../../app/src/lib/legacy-step-keys.json),
its [generator](../../scripts/gen-legacy-step-keys.mjs) (75 lines),
`migrate` in progress.ts (lines 245–291), a build check
([build-content.mjs](../../scripts/build-content.mjs), lines 299–309) and six
tests. The review that specified it budgeted about three hours.

What would one year of shipping it have cost? A throwaway script on
2026-09-24 looked up what now sits at each old position after this
iteration's single roadmap re-sequencing: of 195 ticks, 7 would point at a
different step and 13 at none. That is one edit.

The compounding part is subtler. A positional key means something only
against the roadmap it was written under, and v1 recorded no roadmap
version. The frozen table works because exactly one roadmap had ever shipped
with v1. After a year of edits, a stored `s0-basics/m-values/2` could refer to
any of a dozen layouts, with nothing in the data to say which. The fix would
no longer be three hours; it might not be possible without losing ticks.
The principal grew with every edit. That is compounding interest, on data in
browsers you cannot reach, and it is why this debt was paid first.

## When not to pay

- The interest is flat and low, and you can name it (the highlighter).
- The code is doing a second job, such as teaching (the store).
- You cannot state the interest in a number. Measure before you argue.
- The fix is a one-way door and the debt is a two-way door. Carrying a
  reversible problem is cheaper than a hasty irreversible fix.

## What this looks like in DevPath

All three decisions above are in this repo, made the same way: price the
principal, estimate the interest, check whether it compounds. The pattern to
copy is the table in each section, with a date and a command behind every
number.

## Common failure modes

- You call something debt because you would have written it differently.
- You argue principal only ("it's a big change") and never state the
  interest, so nobody can compare.
- You pay flat-interest debt first because it is visible, and leave the
  compounding debt in stored data until it cannot be paid.
- Numbers without a date or command. Nobody can check or repeat them.

## Exercise

Price LT-07 in [loose-threads.md](../loose-threads.md): on a fresh clone,
`npm test` fails until `npm run content` has run, because the smoke suites
and one selectors test read generated files. Its sibling, the duplicate test
discovery that made `npm test` report anything from 2,693 to 4,075 tests,
was paid off in this iteration (F-19); compare your pricing with that one.

1. Interest: clone the repo into a scratch folder, run `npm ci` and then
   `npm test`, and record what fails and how long it took you to work out
   why. Count who pays it: every new contributor once, and CI on every run
   (read [ci.yml](../../.github/workflows/ci.yml) to see whether CI already
   works around it, and how).
2. Principal: estimate the fix as a range with assumptions. There are at
   least three shapes: a `pretest` script, tests that build the content they
   need in memory, or a clear failure message and nothing else. Each has a
   different cost to every `npm test` run.
3. Decide pay or carry, and the trigger that would change your mind.

Done when `decisions/NNNN-tests-need-generated-content.md` exists with the
measured interest (what failed, the time, the date), the command output, a
principal range for at least two of the shapes, and a decision.

Write in your journal: which of the three worked numbers surprised you, and
what did you assume before you saw it?
