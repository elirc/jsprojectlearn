# Testing React apps: Testing Library, MSW and Playwright

"How would you test this component?" is standard in React interviews, and a
vague answer about "unit tests" doesn't pass. [react/60](../../react/60-testable-components/)
teaches you to write testable components without any tools. This guide covers
the tools the job uses: Vitest, Testing Library, MSW and Playwright, and how to
keep the resulting suite fast and trustworthy.

## What to test in a UI, and what not to

The layers and the pyramid-vs-trophy argument are in
[the testing strategy guide](testing-strategy.md). For a UI, the rule is:
**test behaviour the user can observe.** Given this data, the user sees these
rows. When they click Delete and confirm, the row disappears. When the server
returns 422, the error appears next to the field.

Don't test React itself (that `useState` updates state), implementation details
(a component's internal state, which hook it calls, CSS class names), or markup
with whole-DOM snapshots that fail on every change. Query the way a user would:

```jsx
// Brittle: coupled to class names and a test-only API
wrapper.find('.btn-primary').simulate('click');

// Resilient, and checks accessibility as a side effect
await user.click(screen.getByRole('button', { name: 'Save order' }));
expect(await screen.findByText('Order saved')).toBeVisible();
```

If a refactor that changes nothing for the user breaks a test, the test was
testing the wrong thing.

## Runners and environments

| Runner | Notes |
|---|---|
| **Vitest** | The default for Vite projects. Jest-compatible API, native ESM and TypeScript, fast watch mode. |
| **Jest** | Still in many existing codebases. ESM and TypeScript need extra config. |
| `node --test` | Built into Node, zero dependencies. DevPath's own suite uses it with jsdom. |

Component tests run in a simulated DOM: **jsdom** (most complete) or
**happy-dom** (faster, less complete). Neither does layout, so anything that
depends on real sizes, scrolling or CSS (`IntersectionObserver`, virtualised
lists, `:hover` styles) is untestable or needs mocking. **Vitest browser
mode**, stable in Vitest 4, runs the same tests in a real browser through
Playwright when that matters.

```js
// vitest.config.js
export default { test: { environment: 'jsdom', setupFiles: ['./test/setup.js'] } };
// test/setup.js
import '@testing-library/jest-dom/vitest';   // toBeVisible, toHaveValue, …
```

## Testing Library and the query priority

Testing Library renders a component and gives you queries that find elements
the way users and assistive technology do. Use them in this order:

1. **`getByRole`** with a name: `getByRole('button', { name: /save/i })`. It
   fails if the element isn't exposed as a button with that accessible name, so
   a clickable `<div>` fails the test, correctly.
2. **`getByLabelText`** for form fields. If this can't find your input, neither
   can a screen reader.
3. **`getByText`** for non-interactive content.
4. **`getByTestId`** only when nothing above can work, such as a chart canvas.

The variants: **`getBy`** throws if absent, **`queryBy`** returns `null` (use it
to assert something is *not* there), **`findBy`** returns a promise and waits.

## User events and async UI

```jsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

test('adds an order line', async () => {
  const user = userEvent.setup();
  render(<OrderForm />);

  await user.type(screen.getByLabelText('SKU'), 'ABC-1234');
  await user.click(screen.getByRole('button', { name: 'Add line' }));

  expect(await screen.findByRole('row', { name: /ABC-1234/ })).toBeInTheDocument();
});
```

**`user-event` over `fireEvent`.** `fireEvent.click` dispatches one event.
`user.click` does what a browser does: pointer events, focus, mousedown,
mouseup, click. It also throws if the element has `pointer-events: none`, and
a click on a disabled button does nothing, as in a real browser.
`user.type` fires keydown, keypress, input and keyup per character.

**Async UI.** Anything that appears after a promise needs **`findBy*`** or
**`waitFor`**, which retry until the assertion passes or a timeout expires.
They also wrap updates in `act()`, which is why using them makes the "not
wrapped in act(...)" warning go away. That warning means state changed after
your test stopped watching: the test is asserting too early, or something is
still in flight when it ends. Fix the wait, don't silence the warning. Never
use `setTimeout` to wait in a test.

## Network: mock at the network layer with MSW

Don't mock `fetch`, your API client or your `useOrders` hook. Each of those
mocks encodes your assumptions about the code under test and skips the part
most likely to be wrong: URL building, headers, JSON parsing and error
handling. **Mock Service Worker** intercepts real requests at the network level:

```js
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

export const server = setupServer(
  http.get('/api/orders', () => HttpResponse.json([{ id: 1, sku: 'ABC-1234' }])),
);
// setup file: beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
//             afterEach(() => server.resetHandlers()); afterAll(() => server.close());

test('shows a server error', async () => {
  server.use(http.get('/api/orders', () => new HttpResponse(null, { status: 500 })));
  render(<Orders />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not load/i);
});
```

The component runs its real fetching code. Swap the fetch for axios or TanStack
Query and the tests still pass. The same handlers run in the browser during
development and in Storybook. If you use a query library, create a fresh
`QueryClient` per test with `retry: false`, or a failed request retries three
times and the test times out.

## Hooks and reducers

Extract logic first. A reducer is a pure function: call it with a state and an
action and assert on the result, with no rendering at all. A formatter or
validator is the same. That covers most of the branching.

For a custom hook that must be tested as a hook, use `renderHook`:

```js
import { renderHook, act } from '@testing-library/react';

const { result } = renderHook(() => useCounter(5));
act(() => result.current.increment());
expect(result.current.count).toBe(6);
```

If a hook is only used by one component, test it through that component.

## End to end with Playwright

Playwright drives real Chromium, Firefox and WebKit against the running app. It
catches what component tests can't: routing, real CSS and layout, cookies and
auth, the real API and database, and third-party scripts.

```ts
test('creates an order', async ({ page }) => {
  await page.goto('/orders/new');
  await page.getByLabel('SKU').fill('ABC-1234');
  await page.getByRole('button', { name: 'Save order' }).click();
  await expect(page.getByRole('status')).toHaveText('Order saved');
});
```

- **Locators and auto-waiting.** Actions wait for the element to be visible,
  enabled and stable. `expect(locator)` assertions retry until they pass. You
  never need a manual sleep.
- **Fixtures** give each test what it needs (a page, a seeded user) and clean
  up after.
- **Reuse auth state.** Log in once in a setup project, save cookies and
  storage with `storageState`, and start every test already signed in. Logging
  in through the UI in every test is slow and flaky.
- **Trace viewer.** Record traces on the first retry in CI. A trace has every
  action, a DOM snapshot before and after, network calls and console output.
  It's the first thing to open when a CI failure doesn't reproduce locally.

## Accessibility and visual regression

Add axe to both layers. In component tests, `vitest-axe` (or `jest-axe`) runs
axe on the rendered output. In Playwright, `@axe-core/playwright`:

```ts
const results = await new AxeBuilder({ page }).analyze();
expect(results.violations).toEqual([]);
```

This catches missing labels, bad ARIA and contrast failures automatically. It
doesn't replace a keyboard and screen-reader pass; [the accessibility
guide](accessibility-fundamentals.md) explains why. For visual regression,
`await expect(page).toHaveScreenshot()` compares against a stored baseline. Run
it in one pinned browser and OS (usually a container), because font rendering
differs between machines.

## Flakiness

| Cause | Fix |
|---|---|
| Asserting before async UI settles | `findBy*`, `waitFor`, Playwright's retrying `expect` |
| Fixed sleeps | Wait for a condition, never for time |
| Shared state between tests (database rows, a module-level cache, a shared `QueryClient`) | Isolate: fresh data and clients per test |
| Real time and timezones | Fake timers; pin `TZ` in CI |
| Tests depending on order | Run in random order to expose it |
| Animations | Disable them in the test environment |
| Unmocked network | MSW with `onUnhandledRequest: 'error'` |

In CI, shard a large E2E suite across machines (`--shard=1/4`). Allow at most
one retry, and treat a test that passes only on retry as a bug to fix within
days, not a pass. [The testing strategy guide](testing-strategy.md) explains
why a flaky test is worse than none.

## What you should be able to answer

- `getByRole` vs `getByTestId`: which, and why?
- Why use MSW instead of mocking `fetch` or your data hook?
- What does Playwright catch that Testing Library can't?
- What does the "not wrapped in act(...)" warning mean, and how do you fix it?
- How do you debug an E2E test that fails only in CI?
