# ARIA without breaking things

ARIA is the part of accessibility where well-meaning code does the most damage.
Interviewers ask "how would you make this dropdown accessible?" to find out
whether you reach for native HTML first and, when you can't, whether you know
the handful of ARIA patterns that are safe and complete. This guide covers
those patterns and the mistakes that make pages worse than no ARIA at all.

## What ARIA can and cannot do

ARIA attributes change the accessibility tree: the structure the browser hands
to screen readers, voice control and other assistive technology. They change
nothing else.

| ARIA gives you | ARIA does not give you |
|---|---|
| A role ("button", "tab", "dialog") | Focusability |
| A name, via `aria-label` or `aria-labelledby` | Keyboard handling |
| States (`aria-expanded`, `aria-checked`) | Visual styles |
| Relationships (`aria-controls`, `aria-describedby`) | Form submission or validation |
| Live announcements (`role="status"`) | Any behaviour at all |

So `<div role="button">` announces as a button but cannot be reached with Tab
and ignores Enter and Space. To finish the job you need `tabindex="0"`, a
`keydown` handler for both keys, a disabled state and a focus style. A
`<button type="button">` already has all of that. This is why the first rule of
ARIA ([see the fundamentals guide](accessibility-fundamentals.md)) is: if a
native element or attribute exists, use it.

## The five rules, as a checklist

The W3C's "Using ARIA" note condenses to five rules you can apply in review:

1. **Prefer native HTML.** `<button>`, `<a href>`, `<input type="checkbox">`,
   `<details>`, `<dialog>`, `<select>`.
2. **Don't change native semantics** unless you really must. `<h2
   role="tab">` removes the heading; wrap it instead.
3. **Every interactive ARIA control must work with a keyboard.** A role is a
   promise about behaviour.
4. **Never put `role="presentation"` or `aria-hidden="true"` on a focusable
   element.** Keyboard users land on something screen readers say doesn't
   exist.
5. **Every interactive element needs an accessible name.**

Rule 4 catches a common bug: hiding an off-canvas menu with `aria-hidden` while
its links are still tabbable. Use the `inert` attribute instead, which removes
the subtree from both the tab order and the accessibility tree.

```html
<nav id="drawer" inert>…</nav>   <!-- closed: not focusable, not announced -->
```

## Pattern: disclosure (show/hide)

The simplest widget and the one you'll build most often: an FAQ answer, a
"More filters" panel, a mobile nav toggle.

```html
<button type="button" aria-expanded="false" aria-controls="filters">
  More filters
</button>
<div id="filters" hidden>…</div>
```

Toggle `aria-expanded` and `hidden` together. The name stays the same ("More
filters"); the state changes ("collapsed" to "expanded"). Changing the button
text to "Hide filters" as well double-announces the state. For static content,
`<details>`/`<summary>` gives you all of this for free.

A disclosure is not a menu. Using `role="menu"` for a site navigation dropdown
is one of the most frequent audit findings: it tells screen readers to expect
application-style arrow-key behaviour, and switches some of them out of their
normal reading mode.

## Pattern: tabs

Tabs need three roles and two relationships:

```html
<div role="tablist" aria-label="Order details">
  <button role="tab" id="t-items" aria-selected="true" aria-controls="p-items">Items</button>
  <button role="tab" id="t-ship" aria-selected="false" aria-controls="p-ship" tabindex="-1">Shipping</button>
</div>
<div role="tabpanel" id="p-items" aria-labelledby="t-items">…</div>
<div role="tabpanel" id="p-ship" aria-labelledby="t-ship" hidden>…</div>
```

Only the selected tab is in the tab order; the arrow keys move between tabs
(the keyboard side is in [the keyboard patterns guide](keyboard-interaction-patterns.md)).
If your "tabs" are really links that change the URL, don't use tab roles: use a
`<nav>` of links with `aria-current="page"` on the active one.

## Pattern: dialogs

Use `<dialog>` and `showModal()`. It handles the top layer, `Esc`, inert
background, initial focus and focus return in all current browsers. What's
left for you:

```html
<dialog aria-labelledby="del-title">
  <h2 id="del-title">Delete order 1042?</h2>
  <p>This cannot be undone.</p>
  <form method="dialog">
    <button value="cancel">Cancel</button>
    <button value="confirm">Delete</button>
  </form>
</dialog>
```

- Give it a name with `aria-labelledby` pointing at the heading.
- Use `role="alertdialog"` only for urgent confirmations that need an immediate
  response.
- Don't call `show()` (non-modal) when you need modal behaviour; nothing is
  trapped or made inert.

The `popover` attribute is for non-modal things that light-dismiss: menus,
toggletips, pickers. It gives you top-layer rendering and `Esc` handling, but
no focus trap and no role; you still add the role that fits the content.
[react/52](../../react/52-accessible-modal-focus/) builds a focus trap by hand
so you know what `<dialog>` is saving you from.

## Pattern: live regions

Screen readers announce what has focus. For anything else, use a live region
that already exists in the DOM before its text changes.

| Use | Markup | Behaviour |
|---|---|---|
| "Saved", "12 results" | `role="status"` | Polite: waits until the user pauses |
| "Payment failed" | `role="alert"` | Assertive: interrupts |
| A log of chat messages | `role="log"` | Polite, appends |

Keep one polite region per page (often in the layout) and write short messages
into it. Don't make large containers live: wrapping a results table in
`aria-live` reads the whole table every time it re-renders.

## Naming: which attribute wins

The accessible name is computed in priority order: `aria-labelledby`, then
`aria-label`, then native sources (`<label>`, content, `alt`, `title` as a last
resort).

- **Icon-only buttons:** `aria-label="Delete order 1042"` and
  `aria-hidden="true"` on the SVG.
- **Visible text exists:** don't override it with `aria-label`. Voice control
  users say what they see, and WCAG 2.5.3 (Label in Name) requires the visible
  text to be part of the name.
- **Repeated links:** "Edit" twenty times in a table is useless in a screen
  reader's link list. Add context: `aria-label="Edit order 1042"`, or visually
  hidden text inside the link.
- **`aria-describedby`** adds a description (hints, error messages) that is
  read after the name and role. It is not a name.

`aria-label` on a `<div>` or `<span>` with no role is ignored by most screen
readers, because naming is prohibited on generic elements.

## Common harmful ARIA, spotted in review

| Code | Problem | Fix |
|---|---|---|
| `<a role="button" href="#">` | Link or button? Enter works, Space doesn't | Pick one: `<button>` for actions |
| `aria-hidden="true"` on a modal's backdrop parent | Hides the modal too, if nested | `inert` on siblings, or `<dialog>` |
| `role="menu"` on site navigation | Wrong mode and expectations | Disclosure with a list of links |
| `aria-label` repeating visible text | Duplicate or mismatched names | Remove it |
| `role="alert"` on every toast | Constant interruptions | `role="status"` |
| `aria-required="true"` on `<input required>` | Redundant, sometimes double-read | Drop the ARIA |
| `tabindex="0"` on non-interactive text | Extra tab stops | Remove; headings aren't controls |

## Reach for a headless library for the hard widgets

Comboboxes, date pickers, tree views and data grids have long keyboard specs,
browser and screen-reader quirks, and many states. In a product team you'd use
a headless library such as React Aria, Radix or Ark UI, which ship tested
behaviour and ARIA and leave styling to you. Saying so in an interview is not
a cop-out; it shows you know the cost of getting it wrong. Build one by hand
once, as in [react/58](../../react/58-command-palette/), so you can review and
debug what the library does.

## What you should be able to answer

- Why is `<div role="button">` not equivalent to `<button>`, and what would you
  have to add?
- What goes wrong when `aria-hidden="true"` sits on a focusable element, and
  what should you use instead?
- How do you mark up tabs, and when should "tabs" really be links?
- Why is `role="menu"` usually wrong for a site's navigation dropdown?
- When does `aria-label` help, and when does it break voice control?
- How do you announce "3 results" without moving focus?
