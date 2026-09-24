# Accessibility: the parts you're accountable for

In 2026 accessibility is a contractual requirement, not a nice-to-have, and
"how would you make this accessible?" gets asked about every modal, menu and
form in a frontend interview. You don't need to be a specialist. You need to
know the handful of rules that cover most real failures, and how to check them.

## Who it's for, and why it's now a requirement

Users who navigate by keyboard, screen reader, voice control or switch device;
users with low vision, colour blindness, tremors or vestibular disorders; and
everyone on a phone in sunlight. The standard is **WCAG 2.2, level AA**. The
European Accessibility Act has applied to consumer-facing digital services
since June 2025, the US ADA Title II rule sets WCAG 2.1 AA for public-sector
sites, and enterprise and government contracts routinely name WCAG 2.2 AA.

WCAG organises its criteria under four principles:

| Principle | Means | Typical failure |
|---|---|---|
| Perceivable | Users can perceive the content | Image with no alt text, low contrast |
| Operable | Users can operate the UI | Mouse-only controls, keyboard traps |
| Understandable | Content and behaviour are predictable | Errors with no explanation, focus jumping |
| Robust | Assistive technology can interpret it | Custom widgets with no role or state |

WCAG 2.2 also removed criterion 4.1.1 (Parsing), so "valid HTML" is no longer a
success criterion in its own right.

## Semantics first, and the first rule of ARIA

The cheapest accessibility work is using the right element: `<button>`, `<a
href>`, `<label>`, `<table>`, `<dialog>`. They come with roles, keyboard
behaviour and states built in ([the HTML guide](html-semantics-and-forms.md)
lists what you lose with a `<div>`).

ARIA changes what assistive technology is *told*. It changes nothing about
behaviour. `role="button"` does not make a `<div>` focusable or clickable with
Enter. Hence the first rule of ARIA: if a native element does the job, use it.
"No ARIA is better than bad ARIA" is borne out by audits, which consistently
find more errors on pages with ARIA than on pages without it.

## Names, roles and states

A screen reader describes every control as *name, role, state*: "Save order,
button", "Remember me, checkbox, checked", "Filters, button, collapsed".

- **Role** comes from the element (`<button>` is a button) or `role`.
- **Name** comes, in priority order, from `aria-labelledby`, then `aria-label`,
  then the native source (`<label>`, the button's text, `alt`).
- **State** comes from native attributes (`checked`, `disabled`) or ARIA
  (`aria-expanded`, `aria-pressed`, `aria-selected`).

```html
<button aria-expanded="false" aria-controls="filters">Filters</button>
<button aria-label="Delete order 1042"><svg aria-hidden="true">…</svg></button>
```

`aria-label` is right for an icon-only button. It is the wrong fix when there is
visible text, because it replaces that text for screen-reader users and breaks
voice control ("click Save" fails if the name is "Submit form"). It is ignored on
elements with no role, such as a plain `<div>` or `<span>`. And it is often not
translated by browser translation tools. If there's a visible label, point at it
with `aria-labelledby` or use a real `<label>`.

## Keyboard

Every action must work with a keyboard alone.

- **Focus order follows DOM order.** If CSS reorders things visually, tab order
  no longer matches what the user sees. Fix the DOM, not `tabindex`.
- **Focus must be visible.** Never `outline: none` without a replacement. Style
  `:focus-visible`, which shows the ring for keyboard users but not mouse
  clicks. WCAG 2.2 adds that a focused element must not be completely hidden by
  sticky headers or cookie banners.
- **`tabindex="0"`** puts a custom element into the natural tab order.
  **`tabindex="-1"`** makes it focusable from script but not by Tab, which is
  what you use for a heading you move focus to. **Never use a positive
  `tabindex`**; it creates a separate tab order that nobody can maintain.
- Composite widgets (menus, tabs, listboxes) use one tab stop and arrow keys
  within. [react/53](../../react/53-keyboard-nav-menu/) builds this "roving
  tabindex" pattern.

## Focus management in single-page apps

In a server-rendered site the browser resets focus on navigation. An SPA swaps
content and leaves focus on the link that was clicked, or on `<body>`. You
manage it:

- **Route change:** move focus to the new page's `<h1>` (with `tabindex="-1"`)
  and update `document.title`.
- **Modal opens:** move focus inside, trap Tab within the dialog, close on Esc,
  and make the background inert.
- **Modal closes:** return focus to the element that opened it. Forgetting this
  drops keyboard users back at the top of the page.

`<dialog>` with `showModal()` does all of the modal work for you: focus moves inside, Tab is trapped, Esc closes, the page behind is inert, and focus returns to the opener on close.
[react/52](../../react/52-accessible-modal-focus/) builds a trap by hand so you
know what's involved.

## Dynamic content

Screen readers announce what has focus. Anything that changes elsewhere is
silent unless you put it in a **live region**:

```html
<div role="status">Order saved</div>        <!-- polite: waits for a pause -->
<div role="alert">Payment failed</div>      <!-- assertive: interrupts -->
```

The region must already be in the DOM when its content changes; inserting a
region and its text together is often not announced. Render the empty
container once and update its text. Use `status` for toasts and "12 results",
and keep `alert` for things that genuinely need to interrupt.

Form errors need a link between the field and its message:

```html
<input id="email" aria-invalid="true" aria-describedby="email-err">
<p id="email-err">Enter an email address like name@example.com</p>
```

On a failed submit, move focus to the first invalid field or to an error
summary at the top of the form.

## Visual requirements

| Requirement | What to meet |
|---|---|
| Text contrast | 4.5:1; 3:1 for large text (24px, or about 19px bold) |
| Contrast of UI parts (input borders, focus rings, icons) | 3:1 |
| Colour alone | Never the only signal: add an icon, text or pattern |
| Target size (new in 2.2) | At least 24×24 CSS px, or enough spacing around it |
| Motion | Nothing flashes more than 3 times a second; honour `prefers-reduced-motion` (AAA, but expected) |
| Zoom | Usable at 200% zoom and at 320px wide without horizontal scrolling |

A red border on an invalid field fails "colour alone" for colour-blind users.
Add the error text.

## Drag and drop needs an alternative

WCAG 2.2 criterion 2.5.7 (Dragging Movements) requires that anything done by
dragging can also be done with single clicks or taps. A kanban board needs a
"Move to…" menu on each card; a sortable list needs up and down buttons. Those
controls also give keyboard users a way in, which a drag library alone often
doesn't. [js/64](../../64-kanban/) and
[react/56](../../react/56-drag-drop-kanban/) are good places to add one.

## Testing it

1. **Automated checks.** axe DevTools or Lighthouse in the browser, and axe in
   your component and E2E tests ([the frontend testing guide](frontend-testing.md)
   shows how). These catch missing names, contrast and invalid ARIA, but only a
   minority of real issues, commonly quoted as 30 to 40 per cent. A clean axe
   report is the start of testing, not the end.
2. **Keyboard pass.** Unplug the mouse. Tab through the page. Can you reach
   and operate everything? Is focus always visible? Can you escape every
   popup?
3. **Five-minute screen-reader smoke test.** VoiceOver on macOS (Cmd+F5) or
   NVDA on Windows. Tab through a form and listen: does every field have a
   name, and is every error announced?
4. **Zoom to 200%** and check nothing overlaps or disappears.

For complex widgets (combobox, date picker, data grid), don't build from
scratch. Headless libraries such as Radix, React Aria and Ark UI supply the
behaviour and ARIA wiring, and you supply the styles. That's the pragmatic
answer interviewers want to hear.

## What you should be able to answer

- How would you make this custom dropdown accessible?
- What does `aria-label` do, and when is it the wrong fix?
- How do you announce "saved" to a screen-reader user?
- What has to happen to focus when a modal opens and when it closes?
- Why is `tabindex="3"` a bug?
- What can automated tools not tell you, and how do you check it?
