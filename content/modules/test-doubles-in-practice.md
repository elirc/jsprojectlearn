# Test doubles in practice

Knowing the words stub, mock, fake and spy gets you through the first
question. The follow-ups are practical: how does the double get into the code,
when is a fake better than a mock, why did this module mock not apply, and how
do you stop your fakes drifting from reality? This guide answers those with
Vitest examples; the ideas carry straight over to xUnit and NSubstitute.

The definitions and the "mocks couple you to implementation" warning are in
[A testing strategy you can defend](testing-strategy.md). Start there if the
vocabulary is new.

## Pick the lightest double that does the job

| You need the collaborator to... | Use | Vitest shape |
|---|---|---|
| Exist, and never be used | Dummy | `{}` or `null` cast to the type |
| Return canned answers | Stub | `vi.fn().mockResolvedValue(user)` |
| Record calls you will assert on | Spy | `vi.spyOn(obj, 'method')` or `vi.fn()` |
| Fail the test if called wrongly | Mock | `vi.fn()` plus `toHaveBeenCalledWith` |
| Behave realistically, with state | Fake | An in-memory repository, a fake clock, an outbox |

Most tests need a stub or a fake. Reach for interaction assertions only when
the call *is* the behaviour: an email sent, a payment requested, an audit event
written. For everything else, assert on the outcome (the returned value, the
row in the fake repository) so the test survives refactoring.

## Create a seam: pass dependencies in

A double is only useful if it can get into the code. The simplest seam in
JavaScript is a parameter. Group the dependencies into one object and give the
function no way to reach the outside world except through it:

```js
export async function placeOrder({ repo, clock, newId, mailer }, input) {
  const order = { id: newId(), customerId: input.customerId, total: input.total, placedAt: clock.now() };
  await repo.save(order);
  await mailer.send({ to: input.email, template: 'order-placed', orderId: order.id });
  return order;
}
```

The composition root (your `server.js` or DI container) builds the real
dependencies once. Tests build whatever they need:

```js
test('places an order and sends one confirmation', async () => {
  const repo = createInMemoryOrderRepo();
  const mailer = { send: vi.fn().mockResolvedValue(undefined) };
  const deps = { repo, mailer, clock: { now: () => new Date('2026-03-01T09:00:00Z') }, newId: () => 'o-1' };

  await placeOrder(deps, { customerId: 'c1', total: 30, email: 'ada@example.com' });

  expect(await repo.findById('o-1')).toMatchObject({ customerId: 'c1', total: 30 });
  expect(mailer.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ orderId: 'o-1' }));
});
```

Notice what got a double: the repository (a fake, asserted by state), the
mailer (a mock, because sending *is* the behaviour), and time and id generation
(stubs, because they are non-deterministic inputs). Nothing got a double just
because it was a different class. In .NET the same seam is constructor
injection; see [Dependency injection, in both stacks](dependency-injection-explained.md).

## Fakes you can trust: share a contract suite

An in-memory fake is faster and less brittle than a mock, but it can lie: if
the real repository returns `null` for a missing id and the fake returns
`undefined`, every service test passes against behaviour production never has.
The cure is to run **the same tests against both implementations**:

```js
export function orderRepoContract(name, makeRepo) {
  describe(`${name} satisfies the OrderRepo contract`, () => {
    let repo;
    beforeEach(async () => { repo = await makeRepo(); });

    test('returns null for an unknown id', async () => {
      expect(await repo.findById('missing')).toBeNull();
    });
    test('does not leak later mutations of a saved object', async () => {
      const order = { id: 'o1', customerId: 'c1', total: 30 };
      await repo.save(order);
      order.total = 999;
      expect((await repo.findById('o1')).total).toBe(30);
    });
  });
}

orderRepoContract('in-memory repo', () => createInMemoryOrderRepo());
orderRepoContract('postgres repo', () => createPgOrderRepo(testPool)); // integration run
```

The second test catches a classic fake bug: storing the caller's object by
reference, so mutations after `save` silently change "the database". The
in-memory fake uses `structuredClone` on the way in and out for exactly this
reason. Typing both implementations against one TypeScript interface adds a
compile-time check on top.

## Module mocking: the last resort

`vi.mock('./mailer.js')` replaces a module for every importer in the test file.
It is handy for code you cannot restructure, but it has sharp edges:

- **It is hoisted.** Vitest moves `vi.mock` above the imports, so its factory
  cannot use variables declared in the file. Use `vi.hoisted()` to create
  shared mocks.
- **The factory replaces the whole module.** Spread
  `await importOriginal()` to keep the real exports you are not faking.
- **It cannot reach internal calls.** If `price()` calls `rate()` in the same
  module, mocking the export `rate` does not change what `price` calls. This is
  the single most common "why is my mock ignored?" question.
- **It hides design problems.** Needing six module mocks for one test usually
  means the function does too much. Extract the logic into something pure and
  test that with plain values instead.

## Time, randomness and the network

These are the non-deterministic inputs every CRUD app has:

| Input | Seam | In the test |
|---|---|---|
| Current time | A `clock` dependency, or `TimeProvider` in .NET | Fixed date; or `vi.useFakeTimers()` plus `vi.setSystemTime()` |
| Timers and retries | The same fake timers | `await vi.advanceTimersByTimeAsync(ms)` when promises are involved |
| Ids and random values | A `newId` or `rng` dependency | Return a known value, or a seeded generator |
| Outbound HTTP | An adapter class you own | A fake adapter for services; MSW or undici's `MockAgent` for the adapter itself |

For outbound HTTP, mocking `fetch` with `vi.fn()` couples every test to the
exact call shape. Intercepting at the network layer, as MSW does, lets the
adapter be refactored freely; the browser-side version is in [Testing React
apps](frontend-testing.md).

## Mock lifecycle, so nothing leaks

Doubles that outlive their test cause the order-dependent failures described
in [Flaky tests](flaky-tests.md). Set the defaults once in `vitest.config.ts`
rather than remembering them in every file:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    clearMocks: true,     // forget recorded calls before each test
    restoreMocks: true,   // put spied-on methods back after each test
    unstubEnvs: true,     // undo vi.stubEnv
    unstubGlobals: true,  // undo vi.stubGlobal
  },
});
```

| Method | Recorded calls | Fake implementation | Original method |
|---|---|---|---|
| `mockClear()` | Cleared | Kept | Still replaced |
| `mockReset()` | Cleared | Removed | Still replaced |
| `mockRestore()` | Cleared | Removed | Put back (for `spyOn`) |

## Smells that mean you are over-mocking

- The test re-states the implementation: every internal call is mocked and
  then asserted in order.
- A refactor that changes no behaviour breaks dozens of tests.
- You mock a type you do not own (an ORM's `DbContext`, an SDK client) and
  script its fluent methods. Wrap it in an adapter you own, or use the real
  thing in an integration test.
- The mock returns data shapes the real service never would, because nobody
  checked. Contract tests and shared types fix this.
- The only thing asserted is that a mock was called, and the result of the
  function is never checked.

When a service mostly moves data to and from the database, stop mocking and
write an integration test against a real database instead; the logic worth
unit testing is usually small enough to extract. [The mini test framework
project](../../45-mini-test-framework/) is a good way to see how spies and
assertions work underneath.

## What you should be able to answer

- How do you choose between a stub, a mock and a fake for a given
  collaborator?
- What is a seam, and what is the simplest way to create one in JavaScript?
- How do you stop an in-memory fake repository drifting from the real one?
- Why might `vi.spyOn(module, 'fn')` have no effect on a call inside that
  same module?
- What configuration stops mocks and stubs leaking between tests?
- What are the signs that a test suite is over-mocked?
