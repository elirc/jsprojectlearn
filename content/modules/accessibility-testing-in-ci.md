# Accessibility testing in CI

Accessibility regressions arrive the same way other bugs do: someone refactors
a button into a `<div>`, swaps an icon, or changes a colour token. If nothing
fails in the pipeline, you find out from an audit or a complaint. Interviewers
ask "how would you stop accessibility regressing?" to hear a layered answer
with realistic expectations about what automation can catch.

## What automation can and can't catch

Automated rules check things that are machine-decidable from the DOM and
computed styles. Estimates vary, but a fair summary is that tools find around
a third to a half of real WCAG issues by count.

| Automation catches reliably | Automation can't judge |
|---|---|
| Missing form labels and button names | Whether a name makes sense ("Button 1") |
| Images without `alt` | Whether the `alt` describes the image |
| Invalid ARIA: bad roles, missing required attributes | Whether the ARIA pattern behaves correctly |
| Text contrast on solid backgrounds | Contrast over images and gradients |
| Duplicate ids, missing page `lang`, empty headings | Whether heading order reflects the content |
| `aria-hidden` on focusable elements | Focus order, focus traps and focus loss |
| Missing landmarks | Whether announcements happen at the right time |

So automation is a floor. The strategy is to make the floor unbreakable in CI
and spend human time on the rest ([screen-reader testing](screen-reader-testing.md),
[keyboard patterns](keyboard-interaction-patterns.md)).

## Layer 1: lint the source

`eslint-plugin-jsx-a11y` catches mistakes at the moment they're typed: a click
handler on a `<div>` with no key handler, an `<img>` without `alt`, an
`autoFocus`, an invalid `aria-*` attribute.

```js
// eslint.config.js
import jsxA11y from 'eslint-plugin-jsx-a11y';

export default [
  jsxA11y.flatConfigs.recommended,
  // …your other configs
];
```

Linting is static, so it can't see what a component renders at runtime or
through props. It is cheap and fast, which makes it the right first layer, not
the only one.

## Layer 2: component tests with axe

Run axe-core against rendered components in your unit test runner. With
Vitest and `vitest-axe`:

```ts
// vitest.setup.ts
import * as matchers from 'vitest-axe/matchers';
import { expect } from 'vitest';
expect.extend(matchers);
```

```tsx
import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';

test('order form has no axe violations', async () => {
  const { container } = render(<OrderForm />);
  expect(await axe(container)).toHaveNoViolations();
});
```

Two limitations to know:

- **jsdom and happy-dom don't do layout or compute real colours**, so axe's
  colour-contrast rule can't give a meaningful result there. Leave contrast to
  the browser layer.
- **Test states, not just the initial render.** Most accessibility bugs live
  in the error state, the open menu and the loading state. Render or interact
  into each one and run axe again.

Testing Library itself is an accessibility check: `getByRole('button', { name:
'Save' })` fails if the element isn't exposed with that role and name. A suite
that queries by role catches naming regressions without any extra tooling
([the frontend testing guide](frontend-testing.md)).

## Layer 3: axe in real browsers with Playwright

End-to-end tests run in real Chromium, Firefox and WebKit, so layout, contrast
and computed visibility are accurate. `@axe-core/playwright` scans the page at
any point in a flow:

```ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('orders page: no WCAG A/AA violations', async ({ page }) => {
  await page.goto('/orders');
  await page.getByRole('button', { name: 'Filters' }).click();
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .exclude('#third-party-chat')
    .analyze();
  expect(results.violations).toEqual([]);
});
```

- **`withTags`** limits rules to the standard you're held to. axe also has
  "best-practice" rules; decide deliberately whether to enforce them.
- **`exclude`** keeps third-party widgets you can't fix from failing the build,
  but track them separately; you're still accountable for them.
- **Scan after interactions**: dialogs, menus, validation errors and toasts.
- On failure, attach `results.violations` to the test report. Each entry has
  the rule id, help URL and the failing nodes' selectors.

Playwright's `toMatchAriaSnapshot` adds a structural check: it records the
accessibility tree of a region (roles and names) and fails if it changes
unexpectedly. It's useful for navigation, forms and dialogs where names
matter.

## Layer 4: page-level audits

For content-heavy sites, a crawler-style check across many URLs catches
problems in templates and CMS content:

- **Lighthouse CI** can assert a minimum accessibility score per URL, alongside
  performance budgets. The score is a weighted summary of axe results, so use
  it as a trend line rather than a precise gate.
- **Pa11y CI** runs axe or HTML_CodeSniffer against a list of URLs or a
  sitemap.
- **Storybook's a11y addon** runs axe on every story in the UI, and the
  Storybook test runner can fail CI on violations, which covers design-system
  components in every state you've written a story for.

## Rolling it out without blocking everyone

Turning on axe in an existing product usually produces hundreds of violations.
A big-bang "fix everything" PR stalls. What works:

1. **Baseline.** Record current violations per page or component (rule id plus
   selector) in a checked-in file.
2. **Fail only on new violations.** CI compares against the baseline, so no one
   can make things worse.
3. **Burn down.** Fix by rule rather than by page; a single shared component
   fix often clears dozens of entries. Remove entries from the baseline as
   they're fixed.
4. **Tighten.** Once a rule is at zero, enforce it globally with no baseline.

Assign clear ownership of the baseline file, or it becomes a place where
violations are silently added.

## Keeping the signal clean

- **Don't disable rules to make CI green.** If a rule is a false positive,
  disable it for that node with a comment explaining why, and review those in
  code review.
- **Stabilise before scanning.** Wait for data to load and animations to
  finish (Playwright's web-first assertions help), or scans become flaky.
- **Scan both themes** if you have dark mode; contrast failures often appear
  in only one.
- **Pin axe-core's version** and upgrade deliberately. New rules and rule
  changes can turn a green build red on an unrelated PR.

## What CI can't replace

A green pipeline tells you that nothing machine-detectable regressed. It
doesn't tell you a new feature is usable. Add to your definition of done for UI
changes:

- a keyboard-only pass of the changed flow,
- a short screen-reader check of new custom widgets,
- a 200% zoom check,
- and, for major features, testing with disabled users.

In an interview, the strong answer names all four layers, says roughly what
fraction automation catches, and explains how you'd introduce it to an existing
codebase without freezing delivery.

## What you should be able to answer

- What kinds of accessibility problems can automated tools find, and which
  can't they?
- Why can't axe check colour contrast reliably in jsdom?
- How would you add axe to Playwright tests, and which states would you scan?
- How do you introduce accessibility checks to a product that already has
  hundreds of violations?
- What does `eslint-plugin-jsx-a11y` catch that runtime checks don't, and
  vice versa?
- What manual checks belong in the definition of done for a UI change?
