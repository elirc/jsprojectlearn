# A testing strategy you can defend in an interview

"What's your approach to testing?" is asked in almost every interview above
junior level, and most answers are either "I write unit tests" or a recited
pyramid diagram. This guide is what a good answer contains.

## What tests are actually for

Not proving correctness. Three concrete things:

1. **Design pressure.** Code that is hard to test is usually hard to change.
   If you cannot test a function without spinning up three mocks, that is
   information about the function.
2. **Regression protection.** The bug you fixed stays fixed.
3. **Refactoring confidence.** You can restructure code and know quickly whether
   you broke it. Without that, code rots because nobody dares touch it.

Every decision below follows from those.

## The layers

| Layer | Tests | Catches | Cost |
|-------|-------|---------|------|
| Unit | One function or class in isolation | Logic errors, edge cases | Cheap, fast |
| Integration | Several pieces together, real database/HTTP | Wiring, SQL, serialisation, config | Moderate |
| End-to-end | The whole app through a browser | Real user journeys | Expensive, slow, flaky |

The classic **pyramid** says many unit, fewer integration, few E2E.

The **trophy** counter-argument says most real defects live in the wiring
between units, so a heavily-mocked unit suite can be entirely green while the
app is broken — and integration tests deserve the largest share.

Both are defensible. What is *not* defensible is having no opinion. A good
answer sounds like:

> "I lean integration-heavy for CRUD work, because the bugs that reach
> production are usually a wrong query, a missing config value, or a
> serialisation mismatch — and none of those show up in a unit test with a
> mocked repository. I still unit test anything with real branching logic:
> pricing rules, validation, state transitions."

## What makes something easy to test

A pure function. Same input, same output, no side effects. No setup, no mocks,
no cleanup — call it and assert.

This is why "separate deciding from doing" is a *testing* strategy, not just a
style preference. Push the decisions into pure functions and the impure shell
around them gets thin enough to cover with a handful of integration tests.

```
// Hard: does everything at once
async function processOrder(id) {
  const order = await db.orders.find(id);
  const discount = order.total > 100 ? 0.1 : 0;
  await db.orders.update(id, { discount });
  await email.send(order.customerEmail, 'Order confirmed');
}

// Easy: the rule is a pure function you can test exhaustively
function discountFor(total) {
  return total > 100 ? 0.1 : 0;
}
```

## Test doubles, named properly

- **Stub** — returns canned values. "When asked for user 7, return this object."
- **Mock** — a stub that also *asserts how it was called*.
- **Fake** — a working lightweight implementation (an in-memory repository).
- **Spy** — records calls for later inspection without changing behaviour.

The important distinction: **mocks couple your test to how the code works.**
Asserting `saveUser was called once with X` breaks when you legitimately
refactor, and passes when the save fails. Assert on the resulting state where
you can.

Heavily mocking a third-party client is a particular trap: your mock encodes
*your assumptions* about that API, so the tests keep passing when the real
service behaves differently. Keep at least one test against the real thing.

## What makes a test brittle

- Asserting on implementation details — internal state, private methods, exact
  call sequences
- Whole-DOM snapshot tests that fail on any markup change
- Depending on test execution order or shared mutable state
- Real timing (`setTimeout` in a test), real network, real current time
- Locale and timezone assumptions

A brittle suite gets a specific fate: people re-run it until it goes green, then
stop trusting it, then stop writing tests. **A flaky test is worse than no
test.**

## Coverage

Coverage tells you which lines executed. It does not tell you whether the
assertions were meaningful — you can hit 100% with tests that assert nothing.

Use it as a **floor** to find untested files. Do not use it as a **target**,
because a coverage target is trivially gamed and turns into busywork.

## TDD, honestly

Red, green, refactor: write a failing test, make it pass simply, then clean up.

The underrated part is not the tests — it is that you cannot write a test for
code whose shape you have not decided. TDD forces the interface design decision
before the implementation.

Also: **watching a test fail first is the only proof it can detect the bug.**
Plenty of tests pass because they assert the wrong thing.

You do not have to do TDD all the time to give a good answer. "I use it when
the logic is intricate or when fixing a bug; less so when exploring" is honest
and reasonable.

## The bug-fix loop

Asked as "walk me through how you fix a production bug." The answer should
include:

1. Reproduce it — ideally as a **failing automated test**
2. Fix it
3. Watch the test go green
4. Ask whether the same class of bug exists elsewhere
5. Ask what would have caught it earlier

Step 1 gives you the cheapest test to justify writing: you already know it
catches a real defect, because it just did.

## Where tests do not pay

Being able to say this is more credible than "test everything":

- Throwaway spikes you will delete
- Tests that only restate the implementation (asserting a getter returns a field)
- Generated code
- Third-party library behaviour — that is their job

## What to run in CI

Everything that must be true before a merge: build, lint, type-check, unit and
integration tests. Anything not in the pipeline will eventually be skipped.

E2E tests are usually too slow for every pull request — run a small critical-path
set on merge and the full suite nightly.

After deploy, run a **smoke test**: hit the health endpoint and one real user
journey. This catches configuration and connectivity failures, which are the
ones no pre-deploy test can find because they only exist in the target
environment.

## The tools, by name

The ideas above are tool-agnostic; interviewers will still ask what you use.

| Job | JS/TS | .NET |
|---|---|---|
| Unit test runner | Vitest, Jest, or the built-in `node --test` | xUnit (v3), NUnit, MSTest |
| Test doubles | `vi.fn()` / `jest.fn()`, MSW for HTTP | NSubstitute, Moq |
| Component tests | Testing Library | bUnit (Blazor) |
| API integration | Supertest against the app | `WebApplicationFactory<Program>` |
| Real database in tests | Testcontainers | Testcontainers |
| End to end | Playwright | Playwright |

Whatever the tool, structure each test as **Arrange, Act, Assert**: set up the
inputs, do the one thing under test, check the outcome. A test with two Acts is
two tests. [Testing .NET APIs](dotnet-testing.md) covers the .NET column in
depth.

## Frontend testing specifically

Component tests query the way a user would (by role, label and text, never by
CSS class), mock the network with MSW rather than `fetch`, and use Playwright
for the journeys that need a real browser. The tools, the query priority and
the flakiness table are in [Testing React apps](frontend-testing.md).

## The 90-second answer

> Unit tests for logic with real branching — pricing, validation, state
> machines — kept pure so they need no setup. Integration tests for anything
> touching the database or HTTP, against a real containerised database, because
> in-memory fakes hide the bugs I actually ship. A handful of end-to-end tests
> for the two or three journeys that lose money if they break. Coverage as a
> floor, never a target. Every production bug gets a failing test before it gets
> a fix.
