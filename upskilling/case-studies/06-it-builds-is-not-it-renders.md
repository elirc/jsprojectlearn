# 06. "It builds" is not "it renders"

TypeScript tells you the app compiles. It does not tell you a route throws on
first render, a hook runs twice, or a click does nothing. This case is about
how DevPath tests the running app without adding a test framework, what that
harness could not see, and one constraint that is real but not enforced.

## The decision

Commit `2220491` (2026-09-09) added `app/src/app.smoke.test.ts`: it built a
jsdom window, patched its globals onto Node's `globalThis`, served the
generated content through a fake `fetch` that reads `app/public/` off disk,
mounted the real `App` under `HashRouter`, and clicked through the main
routes in 11 tests. The commit message states the reason: "A small esbuild
loader hook lets `node --test` run JSX, so the app needs no separate test
runner."

Two smaller decisions make that possible. First, every import in `app/src`
carries its extension (`'./progress.ts'`), with `allowImportingTsExtensions`
and `verbatimModuleSyntax` in `app/tsconfig.app.json`. Node 24 strips
TypeScript types by itself, so `node --test` can import `lib/*.ts` as they
are, with no build step. Second, Node does not transform JSX, so
`app/test/jsx-hooks.mjs` registers a module hook that runs only `.tsx` files
through esbuild, which Vite already installs. `app/test/register.mjs` loads
it, and in 2220491 the root `npm test` was one command: `node --import
./app/test/register.mjs --test`, with no file list.

The alternatives: vitest (excluded by the stack rule the repo owner set for
this work, though
worth arguing on the merits: it would give you jsdom setup, fake timers and
watch mode for free), Playwright against a real browser, typechecking only,
or React Testing Library on top of the same harness. The choice bought one
runner, no new dependency, and tests that run against the real generated
content rather than fixtures. It paid in hand-written global patching, a
`settle(turns = 6)` heuristic for waiting on async loads, and a single
mounted app shared by every test in the file. For the test layers themselves,
read [testing-strategy.md](../../content/modules/testing-strategy.md); this
case is about the infrastructure decision, not the pyramid.

## What it hid

**The harness did not use StrictMode, and the app did.** `main.tsx` wraps the
app in `StrictMode`; the 2220491 harness called
`root.render(createElement(HashRouter, null, createElement(App)))`
(`git show 2220491:app/src/app.smoke.test.ts | sed -n 90p`). In development,
StrictMode runs state updaters twice to flush out impure ones. The drill's
`Countdown` called `onExpire` from inside a `setLeft` updater. Under
StrictMode a timed-out question was graded twice: two lapses, ease down 0.4
instead of 0.2, the question listed twice in "What you missed", and a
five-question drill summarised as "n/6". Production builds do not
double-invoke, so real learners were unaffected; every developer running
`npm run dev` was. The smoke test could not see it, because it rendered the
app in a configuration nobody ships or develops in.

**Tests depended on their order.** One app was mounted in `before()`. The first
tests asserted on the dashboard because nothing had navigated yet. The drill
test answered a question, which called `gradeCard`, which wrote to jsdom's
`localStorage` for every test after it. And `progress.ts` reads storage once
at import, so there was no way to start a test from a known state.

**A constraint lived in people's heads.** Node's type stripping only handles
syntax that can be erased: no `enum`, no `namespace`, no constructor parameter
properties. TypeScript has a flag that enforces exactly that,
`erasableSyntaxOnly`; with the installed 5.9.3 on 2026-09-24, an enum under that
flag fails with `TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is
enabled`. It is not set in `app/tsconfig.app.json`. So an `enum` added to `lib/`
passes `npm run typecheck` and fails `npm test` at import time.

## How it was found

The StrictMode bug began as a hypothesis in the plan for this journal. The
adversarial review of that plan, on 2026-09-23, reproduced it experimentally:
a probe mirroring `Countdown` and `answer()` under React 19.3 in development
mode, in jsdom, with real timers and no `act`. With StrictMode the updater ran
twice per tick, `onExpire` fired twice, and the grading function ran twice; the
`chosen !== undefined` guard in `answer()` did not stop the second call
because it read a stale closure. Without StrictMode, everything ran once.
React also logged "Cannot update a component while rendering a different
component". The finding moved from "I think" to "here is the log".

Order dependence was found by reading the file top to bottom and asking what
each test assumed. The review listed the specific collisions. The binary
`lib.test.ts` (a literal NUL byte in a fuzz string that made git treat the
file as binary) was found the same week by looking at a commit's `--stat`
line (`Bin 0 -> 9209 bytes`); the register records it as
[F-03](../loose-threads.md). The worked
[postmortem](../examples/postmortem-strictmode-double-grade.md) covers the
StrictMode double-grade.

## What changed

`git diff 2220491 -- app/src/app.smoke.test.ts` shows most of the old file
deleted. The harness moved to `app/src/testing/harness.ts`, and the suite
split into four files.

- `boot()` (`harness.ts:53-183`) mounts inside `StrictMode` (`:179`), with
  the reason in the header: "double-invoked effects and updaters are
  exercised here rather than discovered in dev" (`:4-6`).
- A `seed` option runs before any app module is imported (`:47-48`, `:107`),
  which is the only way to give `progress.ts` a starting state, because it
  reads storage at import. `close()` unmounts and closes the jsdom window
  (`:172-175`).
- `app.drill.smoke.test.ts`, `app.loop.smoke.test.ts` and
  `app.nav.smoke.test.ts` each call `boot()` once and reset the store in
  `beforeEach` with `progressStore.replaceForTests()`. `app.smoke.test.ts`
  (14 tests) still has no `beforeEach`; its first three tests read the
  dashboard before anything navigates, so order still matters within that
  file.
- `Countdown` (`DrillSession.tsx:416-464`) now counts against a fixed deadline
  and calls `onExpire` from the interval callback, never from an updater, with
  a `fired` ref as a once-guard. `app.drill.smoke.test.ts:137` is the
  regression test: "a timeout grades the question exactly once under
  StrictMode".
- `jsx-hooks.mjs` and `register.mjs` are unchanged in substance.
- The root `test` script now passes explicit globs instead of none.

That last change has a story. On 2026-09-24, runs of `npm test` from the repo
root reported 4,075, 2,693 and 3,546 tests, because `node --test` with no file
list also discovered the copies of project tests under `app/public/docs/` and
`app/dist/docs/`. A test count that depends on which build folders are on
your disk is itself a finding. With the globs in place, the same command on
the same day reported 996 tests, 0 failing, in 38 s
([F-19](../loose-threads.md)). The fix has a cost you should notice: a test
file outside the four globs now silently does not run.

## Exercise

Take [LT-08](../loose-threads.md), the unenforced erasable-syntax
constraint. Its runtime half is marked "reproduce first". Prove it, then fix
it.

On a throwaway branch, add `export enum Level { Junior = 1 }` to
`app/src/lib/format.ts`. Run `npm run typecheck` and record the result. Run
`node --import ./app/test/register.mjs --test app/src/lib/format.test.ts` and
record the error. Then add `"erasableSyntaxOnly": true` to
`app/tsconfig.app.json` and run `npm run typecheck` again.

Done when: a PR (or, solo, a branch reviewed after 48 hours with
[the review checklist](../templates/review-checklist.md)) adds the flag,
contains no enum, and its description shows the three outputs above with the
date, so a reviewer sees typecheck pass, the test run fail, and typecheck fail
once the flag is on. `npm run typecheck`, `npm test` and `npm run build` pass
on the branch. If `npm run typecheck` fails for a reason other than your
enum, stop and record that instead; it is a finding. Move LT-08 to the
register's fixed table with a link to the PR. [LT-07](../loose-threads.md),
the fresh-clone failure, is the next thread for this case.

Write in your journal: one rule your team follows that no tool enforces, and
what it would take to make a tool enforce it.
