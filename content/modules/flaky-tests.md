# Flaky tests: causes, diagnosis and policy

A flaky test passes and fails on the same code. One is an annoyance; twenty
teach a team to press "re-run" without reading the failure, and then a real bug
walks through. "A test fails in CI one run in ten. What do you do?" is a
standard mid-level question, and the good answer has three parts: how you
reproduce it, the usual causes, and what the team does while it is being fixed.

UI-specific flakiness (animations, `findBy` versus `getBy`, Playwright
auto-waiting) is covered in [Testing React apps](frontend-testing.md). This
guide is about the causes every suite shares, with backend and Node examples.

## Flaky, brittle or failing?

| Symptom | Name | Fix goes in |
|---|---|---|
| Fails sometimes, same code | Flaky | The test or the code's non-determinism |
| Fails whenever internals change, behaviour unchanged | Brittle | The test's assertions |
| Fails every run since a commit | Failing | The code (or the test caught a real change) |

The distinction matters because a flaky test is sometimes right. A race
condition in your code produces exactly the same symptom as a race condition in
your test, so "it's just flaky" is a hypothesis to check, not a diagnosis.

## The usual causes

| Cause | Typical symptom | Fix |
|---|---|---|
| Unawaited async work | Passes locally, random failures or stray "unhandled rejection" errors | `await` everything; `for...of` or `Promise.all` instead of `forEach(async ...)`; lint with `no-floating-promises` |
| Fixed sleeps | Fails on slow CI runners | Wait on the real completion signal, or poll with a timeout |
| Shared mutable state | Fails only when run with other tests, or in a different order | Fresh state in `beforeEach`; restore mocks, env and globals |
| Real time and dates | Fails at midnight, month ends, daylight-saving changes, or in another time zone | Inject a clock or use fake timers; pin the time zone in formatting |
| Unseeded randomness | Fails "about once a week" | Seeded generators; log the seed |
| Unordered results | Fails after a database upgrade or under load | `ORDER BY` in the query, or compare without order |
| Parallel collisions | Unique-key violations, `EADDRINUSE`, files overwritten | Per-worker databases, port 0, unique data and temp directories |
| External services | Fails when staging or a vendor API is slow or down | Fakes or containers for tests; a few separate smoke tests for the real thing |
| Resource limits | Timeouts only on CI, which has fewer cores | Find the slow part; raise timeouts per test, not globally |

Two of these deserve a closer look because they cause most backend flakes.

**Waiting.** A background job, a queue consumer or an event handler finishes
"soon". A sleep guesses how soon; polling asks:

```js
// Flaky: a guess about CI speed
await new Promise((r) => setTimeout(r, 200));
expect(await exportExists(jobId)).toBe(true);

// Stable: retry the assertion until it passes or the timeout expires
await expect.poll(() => exportExists(jobId), { timeout: 5_000 }).toBe(true);
```

`vi.waitFor(callback)` does the same for a block of code that throws until it
is ready. Better still, when the work is yours, make it awaitable: return the
job's promise, or run queued jobs in-process in tests so there is nothing to
wait for.

**Shared state.** Order-dependent failures come from anything that outlives a
test: module-level variables, spies that were never restored, `process.env`
changes, rows left in a shared database, files in a fixed temp path. Vitest
isolates modules between *files*, not between tests in one file, and nothing
isolates your database for you. Configure `restoreMocks`, `unstubEnvs` and
`unstubGlobals` once (see [Test doubles in practice](test-doubles-in-practice.md))
and give each test its own data.

## Reproducing a flake

You cannot fix what you cannot see fail. In rough order of effort:

1. **Read the failure properly.** Timeout, assertion mismatch and unhandled
   error point at different causes. Note the time, the runner and the seed.
2. **Run it alone, then with its file, then with the full suite.** Passing
   alone and failing with others means shared state; find the polluter by
   bisecting which tests run before it.
3. **Repeat it.** Vitest can run a single test many times:

```js
test('reserves the last ticket once', { repeats: 200 }, async () => {
  // ...
});
```

4. **Shuffle the order.** `vitest run --sequence.shuffle` exposes hidden
   dependencies; the printed seed (`--sequence.seed=1234`) replays the exact
   order.
5. **Make the machine slower.** Run with more workers than cores, or on a
   throttled container, to widen race windows the way a busy CI runner does.
6. **Collect evidence from CI.** Upload logs and test reports as artefacts, and
   log the inputs that vary: seeds, generated ids, current time, time zone.

## Time and time zones

Date bugs deserve their own section because they flake on a calendar, not at
random, so they look like "it fixed itself".

- Tests that use the real current date fail on specific days: 29 February,
  31 January plus one month (which JavaScript turns into early March),
  daylight-saving transitions. Freeze the clock and add those dates as
  explicit cases.
- Formatting uses the machine's time zone. A date-only ISO string such as
  `2026-03-01` is parsed as UTC midnight, which is still 28 February in New
  York. Set `TZ=UTC` for the test process for consistency, and pass a
  `timeZone` wherever the code formats dates for a user.
- Database defaults such as `DEFAULT now()` use the database server's clock,
  which fake timers in Node do not touch. Pass timestamps from the application,
  or assert ranges.

## Parallelism without collisions

Parallel test files are the cheapest speed-up in a suite and the most common
source of new flakes. The rule: anything two workers can both touch needs a
per-worker or per-test name.

| Resource | Collision-free approach |
|---|---|
| HTTP ports | Listen on port 0, or pass the app to supertest |
| Database | One database or schema per worker (`VITEST_POOL_ID`), or unique data per test |
| Unique columns | Random suffixes: `ada+${randomUUID()}@test.dev` |
| Files | `fs.mkdtemp(path.join(os.tmpdir(), 'test-'))` per test |
| Global stubs | Keep tests that stub globals out of `test.concurrent` |

## Team policy: keep the signal trustworthy

A pipeline is only useful if red means "something is wrong". A workable policy:

- **Retries are allowed but visible.** Configure CI retries if you must, and
  report every test that passed only on retry. A rising count is a bug backlog,
  not noise.
- **Quarantine with an owner.** A test that flakes twice moves to a
  non-blocking job, with a ticket, an owner and a deadline. Deleting or
  skipping it loses the coverage and the signal.
- **Fix the cause, not the timing.** Raising a sleep or a timeout moves the
  failure rate; it rarely removes it.
- **Track the flake rate.** Most CI systems and test reporters can show tests
  whose result changed without a code change. Review the top offenders in the
  same meeting as production incidents.

The CI side of this (sharding, caching, which tests run on which trigger) is in
[CI/CD pipelines](ci-cd-pipelines.md). If the flaky test is guarding a real
race, [A debugging playbook](debugging-playbook.md) covers how to chase it
in production code.

## What you should be able to answer

- A test fails in CI roughly one run in ten. Walk through how you would
  reproduce and fix it.
- Name five common causes of flaky tests and the fix for each.
- Why is a fixed `sleep` in a test a problem, and what do you use instead?
- A test passes alone but fails when the whole file runs. What is going on and
  how do you find the culprit?
- How do you run test files in parallel against one database without
  collisions?
- What should a team's policy on retries and quarantining look like?
