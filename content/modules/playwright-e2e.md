# End-to-end testing with Playwright

Most teams now use Playwright for end-to-end tests, and most of them have a
suite that is slower and flakier than it should be. Interviewers ask about
Playwright to find out whether you can write E2E tests that stay green: stable
locators, isolated state, fast authentication, and CI that tells you why
something failed. [Testing React apps](frontend-testing.md) introduces the
tool; this guide covers running it in a real project.

## Locators and strictness

A locator describes how to find an element; it doesn't find it until you act
on it. Prefer the user-facing locators, in roughly this order:

| Locator | Use for |
|---|---|
| `getByRole('button', { name: 'Save order' })` | Anything with a role: buttons, links, headings, checkboxes, rows |
| `getByLabel('Email')` | Form fields |
| `getByPlaceholder`, `getByText` | Non-interactive text, or fields with no label (fix the label) |
| `getByTestId('order-total')` | Last resort, when nothing user-visible is stable |

Role locators double as a cheap accessibility check: if you can't find the
button by role and name, neither can a screen reader user. CSS selectors and
XPath tied to class names break when the markup changes.

Locators are **strict**. An action on a locator that matches more than one
element throws instead of picking the first. That's a feature: it means your
test was ambiguous. Narrow it rather than reaching for `.first()`:

```ts
const row = page.getByRole('row').filter({ hasText: 'ORD-1042' });
await row.getByRole('button', { name: 'Cancel' }).click();
await expect(page.getByRole('heading', { name: 'Orders', exact: true })).toBeVisible();
```

`name` matches substrings case-insensitively by default; pass `exact: true`
when "Save" must not also match "Save draft".

## Auto-waiting and web-first assertions

Before an action, Playwright waits for the element to be attached, visible,
stable, enabled and able to receive events. Web-first assertions on locators
retry until they pass or time out (5 seconds by default):

```ts
await expect(page.getByRole('status')).toHaveText('Order saved');
await expect(page.getByRole('row')).toHaveCount(11);
await expect(page).toHaveURL(/\/orders\/\d+$/);
```

The mistake is reading a value and asserting on it with a plain `expect`:
`expect(await locator.textContent()).toBe('Saved')` reads once, immediately,
and fails if the UI hasn't updated yet. Always `await expect(locator)...`. For
conditions that aren't about a locator, `expect.poll(() => fn())` retries a
function. `page.waitForTimeout` exists, but a fixed sleep in a test is a bug.

## Isolation, fixtures and test data

Every test gets a fresh **browser context**: a new, incognito-like profile with
its own cookies, storage and cache. That's cheap (milliseconds, not a new
browser) and it means tests can't leak login state into each other.

The database is the part Playwright can't isolate for you. Seed through the
API rather than the UI, and make each test create its own data with unique
values so parallel tests never collide. Fixtures package that setup and
teardown:

```ts
import { test as base, expect } from '@playwright/test';

type Fixtures = { order: { id: number; ref: string } };

export const test = base.extend<Fixtures>({
  order: async ({ request }, use) => {
    const ref = `ORD-${crypto.randomUUID().slice(0, 8)}`;
    const res = await request.post('/api/test/orders', { data: { ref, status: 'open' } });
    const order = await res.json();
    await use(order);                               // the test runs here
    await request.delete(`/api/test/orders/${order.id}`);
  },
});
export { expect };

test('cancels an order', async ({ page, order }) => {
  await page.goto(`/orders/${order.id}`);
  await page.getByRole('button', { name: 'Cancel order' }).click();
  await expect(page.getByRole('status')).toHaveText(/cancelled/i);
});
```

Fixtures are lazy: a test that doesn't ask for `order` never creates one. The
built-in `request` fixture shares `baseURL` and, with the setup below, the
signed-in cookies.

## Authentication with a setup project

Logging in through the form in every test is slow and adds a failure point to
every test. Log in once in a **setup project**, save the context's cookies and
storage with `storageState`, and start every other test already signed in:

```ts
// tests/auth.setup.ts
import { test as setup, expect } from '@playwright/test';

setup('sign in', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(process.env.E2E_USER!);
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation')).toContainText('Account');
  await page.context().storageState({ path: 'playwright/.auth/user.json' });
});
```

Add `playwright/.auth` to `.gitignore`: it contains live session tokens. For
tests that need several roles, save one file per role and switch with
`test.use({ storageState: ... })`. Tests of the login page itself opt out with
`test.use({ storageState: { cookies: [], origins: [] } })`.

## Configuration for CI

One config ties it together: the setup project, the app server, retries and
traces.

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'blob' : 'html',
  use: { baseURL: 'http://localhost:4173', trace: 'on-first-retry' },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/user.json' },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});
```

- **`webServer`** starts the app before the tests and waits for the URL to
  respond. Test the production build, not the dev server.
- **`forbidOnly`** fails CI if someone commits `test.only`.
- **Parallelism.** `fullyParallel` runs tests within a file in parallel too,
  across worker processes. It only works if tests are isolated as above.
- **Sharding** splits the suite across machines: `npx playwright test
  --shard=2/4`. Each shard writes a blob report; a final job runs `npx
  playwright merge-reports --reporter html ./all-blob-reports` to produce one
  report.
- **Retries and flakiness.** A test that fails and then passes on retry is
  reported as *flaky*, not passed. Track those and fix them; `--fail-on-flaky-tests`
  makes CI strict about it. More than one retry mostly hides problems.

## Debugging with the trace viewer

With `trace: 'on-first-retry'`, every retried failure in CI records a trace:
each action, DOM snapshots before and after, network requests, console output
and the source line. Download it from the CI artefacts and open it with `npx
playwright show-trace trace.zip`, or drop it on trace.playwright.dev. It's the
fastest way to find out why a test passes locally and fails in CI. Locally, `npx
playwright test --ui` gives the same timeline with watch mode, and `npx
playwright codegen` records locators for you to clean up.

## Controlling the network

Your own API should be real in E2E tests; that's the point of the layer. Use
`page.route` for what you don't control: payment providers, analytics, maps,
feature-flag services.

```ts
await page.route('**/api.stripe.com/**', (route) => route.fulfill({ json: { status: 'succeeded' } }));
await page.route('**/*.{png,jpg}', (route) => route.abort());   // speed up image-heavy pages
await page.route('**/api/orders', (route) => route.fulfill({ status: 503 })); // error-path check
```

Mocking your own API in a few targeted tests is fine for hard-to-reproduce
states (a 503, a slow response), but if most tests mock it you have expensive
component tests. Component-level network mocking belongs to MSW; see [Mocking
the network with MSW](msw-network-mocking.md).

## Visual comparisons, locale and time

`await expect(page).toHaveScreenshot()` compares against a stored baseline and
fails on differences beyond a threshold (`maxDiffPixels`, `maxDiffPixelRatio`).
Mask dynamic regions with `mask: [page.getByTestId('timestamp')]`. Rendering
differs across operating systems and fonts, so generate and compare baselines
in the same container image in CI, and update them deliberately with
`--update-snapshots`.

Dates, numbers and currencies depend on the browser's locale and timezone.
Pin them so a UK developer and a US CI runner get the same output, and test
other locales explicitly:

```ts
test.use({ locale: 'de-DE', timezoneId: 'Europe/Berlin' });

test('shows German dates', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-03-29T09:00:00Z'));
  await page.goto('/orders');
  await expect(page.getByRole('cell', { name: '29.03.2026' }).first()).toBeVisible();
});
```

`page.clock` controls `Date` and timers in the page, which makes "expires in 5
minutes" and daylight-saving edge cases testable.

## What belongs in E2E

E2E tests are the slowest and most expensive layer, so keep them for journeys
that cross the whole stack: sign-in, the core create-edit-delete flow, checkout,
permissions that the server enforces, and anything that has broken in
production. Validation messages, empty states and formatting belong in
component tests, which run in milliseconds. A mid-sized app is well served by
dozens of E2E tests, not thousands. [A testing strategy you can defend](testing-strategy.md)
explains the balance, and [react/60](../../react/60-testable-components/) shows
the component side.

## What you should be able to answer

- Why prefer `getByRole` over CSS selectors, and what does it mean that locators are strict?
- Why is `expect(await locator.textContent()).toBe(...)` flaky, and what do you write instead?
- How do you avoid logging in through the UI in every test?
- How would you seed test data so tests can run in parallel without colliding?
- When would you use `page.route` in an E2E suite, and when is mocking a smell?
- A test passes locally and fails in CI. What do you look at first?
