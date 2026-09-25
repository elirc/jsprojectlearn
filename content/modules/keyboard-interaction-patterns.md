# Keyboard interaction patterns

"Unplug your mouse and use the page" is the fastest accessibility test there is,
and the one most CRUD apps fail. Interviewers ask about keyboard behaviour
because it shows whether you have actually built a menu, a modal or a data
table rather than dropping one in. This guide covers the conventions users
expect and the two techniques for implementing them.

## The baseline every page must meet

These are WCAG 2.2 AA requirements, not extras:

| Criterion | What it means in practice |
|---|---|
| 2.1.1 Keyboard | Every action works without a pointer |
| 2.1.2 No Keyboard Trap | You can always Tab (or Esc) out of a component |
| 2.4.3 Focus Order | Tab order follows a meaningful sequence, usually DOM order |
| 2.4.7 Focus Visible | You can always see where focus is |
| 2.4.11 Focus Not Obscured (Minimum) | Sticky headers and banners don't completely cover the focused element |
| 2.1.4 Character Key Shortcuts | Single-key shortcuts can be turned off or remapped |

Native controls already behave correctly: buttons activate on Enter and Space,
links on Enter, checkboxes toggle on Space, a `<select>` opens with Alt+Down or
Space. Most keyboard bugs appear when a `<div>` replaces one of them.

## Tab versus arrow keys

The core convention: **Tab moves between components; arrow keys move within
one.** A toolbar with eight buttons, a set of tabs, a radio group, a menu and a
listbox are each one Tab stop. Arrow keys move inside, and Tab leaves.

This matters because a keyboard user tabbing through an admin screen with a
50-row table of "Edit / Delete" buttons would otherwise need 100 key presses to
get past it. Composite widgets keep the page navigable.

| Widget | Tab | Arrows | Other keys |
|---|---|---|---|
| Tabs | Into the selected tab, then into the panel | Left/Right between tabs | Home/End first/last |
| Radio group | Into the checked radio | Move and select | — |
| Menu (menu button) | Onto the button | Up/Down between items | Enter/Space activate, Esc closes and returns focus |
| Listbox | Into the list | Up/Down move | Type-ahead, Space selects in multi-select |
| Toolbar | Into the toolbar | Left/Right between controls | Home/End |
| Grid | Into the grid | All four directions by cell | Home/End, Ctrl+Home/End |
| Dialog | Cycles within the dialog | — | Esc closes |

These come from the WAI-ARIA Authoring Practices Guide (APG), which has a
worked example for each pattern. Follow it; users of screen readers and
switch devices rely on the conventions being the same everywhere.

## Technique 1: roving tabindex

Exactly one item in the group has `tabindex="0"`; all others have
`tabindex="-1"`. Arrow keys move the `0` to the next item and call `focus()`
on it. When the user tabs away and back, focus returns to the last active
item.

```tsx
function Toolbar({ items }: { items: string[] }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: React.KeyboardEvent) {
    const last = items.length - 1;
    const next =
      e.key === 'ArrowRight' ? (active === last ? 0 : active + 1) :
      e.key === 'ArrowLeft' ? (active === 0 ? last : active - 1) :
      e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
    if (next === null) return;
    e.preventDefault();
    setActive(next);
    refs.current[next]?.focus();
  }

  return (
    <div role="toolbar" aria-label="Formatting" onKeyDown={onKeyDown}>
      {items.map((label, i) => (
        <button key={label} ref={(el) => { refs.current[i] = el; }}
          tabIndex={i === active ? 0 : -1} onClick={() => setActive(i)}>
          {label}
        </button>
      ))}
    </div>
  );
}
```

Real focus moves, so the browser scrolls the item into view and screen readers
announce it naturally. [react/53](../../react/53-keyboard-nav-menu/) builds a
full menu with this technique.

## Technique 2: `aria-activedescendant`

Focus stays on one element (usually a text input) and
`aria-activedescendant` points at the id of the "virtually focused" option.
This is the standard for comboboxes and autocompletes, where the user must keep
typing while arrowing through suggestions.

```html
<input role="combobox" aria-expanded="true" aria-controls="cities"
       aria-activedescendant="city-3" aria-autocomplete="list">
<ul id="cities" role="listbox">
  <li id="city-3" role="option" aria-selected="true">Leeds</li>
</ul>
```

You are responsible for styling the active option, since it has no real
focus, and for scrolling it into view. Choose roving tabindex for toolbars,
tabs and menus; choose `aria-activedescendant` when typing and navigating
happen together.

## Focus management rules

Focus must never be lost. Every time you remove, hide or replace the focused
element, decide where it goes.

- **Opening a modal:** focus the first meaningful control, or the dialog
  heading for long content. `<dialog>` with `showModal()` does this.
- **Closing a modal, menu or popover:** return focus to the element that
  opened it.
- **Deleting a row:** move focus to the next row's action, or to a sensible
  container, and announce the change in a status region. Deleting the focused
  button leaves focus on `<body>`, and the next Tab starts from the top.
- **Route change in an SPA:** focus the new page's `<h1>` (with
  `tabindex="-1"`) and update `document.title`.
- **Inline validation:** don't move focus while the user types. Move it on
  submit, to the first error or to an error summary.

Use `:focus-visible` for focus styles so keyboard users always see a ring and
mouse users don't get one on click. Check the ring's contrast (3:1 against the
background) and that sticky headers don't hide it; `scroll-padding-top` on the
scroll container keeps the focused element out from under a sticky header.

```css
:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
html { scroll-padding-top: 5rem; } /* height of the sticky header */
```

## Keyboard traps and escape hatches

A trap is legitimate only in a modal, and only while it is open with a visible
way out (Esc and a close button). Everywhere else, Tab must be able to leave.
Common accidental traps:

- A rich text editor or code editor that captures Tab to insert indentation.
  Provide an escape (many editors use Esc then Tab, or Ctrl+M to toggle).
- An embedded map or video iframe that swallows keys.
- A custom dropdown that calls `preventDefault()` on every `keydown`,
  including Tab.

Only call `preventDefault()` for the keys you actually handle.

## Shortcuts and skip links

A **skip link** as the first focusable element lets keyboard users jump past
the header and navigation:

```html
<a class="skip-link" href="#main">Skip to main content</a>
…
<main id="main" tabindex="-1">…</main>
```

Style it off-screen until focused, not `display: none`, or it can never receive
focus.

**Custom shortcuts** such as "/" to search or "e" to edit must not fire while
the user is typing in a field, and single-character shortcuts need a way to
turn them off (WCAG 2.1.4), because speech-input users can trigger them by
accident. Prefer modifier combinations and list the shortcuts somewhere
discoverable.

## Testing keyboard behaviour

Manual first: tab through every page, then try every widget's arrow keys, Esc
and Enter. Watch for focus disappearing, jumping to the top, or landing on
something invisible.

Then automate the flows that matter, which is easy with Testing Library's
`user-event` or Playwright:

```ts
await user.tab();
expect(screen.getByRole('tab', { name: 'Items' })).toHaveFocus();
await user.keyboard('{ArrowRight}');
expect(screen.getByRole('tab', { name: 'Shipping' })).toHaveFocus();
```

A test like this also catches regressions no automated scanner can see: axe
can tell you a button has no name, but not that the arrow keys stopped
working. See [the CI testing guide](accessibility-testing-in-ci.md) for where
this fits.

## What you should be able to answer

- Why do composite widgets use arrow keys inside and a single Tab stop?
- How does roving tabindex work, and when would you use
  `aria-activedescendant` instead?
- Where should focus go after a user deletes the row they were on?
- What is a keyboard trap, and when is trapping focus correct?
- Why use `:focus-visible` rather than removing outlines?
- How would you write a test that proves a menu works with the keyboard?
