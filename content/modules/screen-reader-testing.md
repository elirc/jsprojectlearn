# Testing with a screen reader

Automated tools find perhaps a third of accessibility problems. The rest you
find by using the page the way your users do, and for many of them that means a
screen reader. You don't need to be fluent; you need a repeatable ten-minute
routine and enough knowledge of how screen readers work to understand what you
hear. Interviewers ask "how do you test accessibility?" and "have you used a
screen reader?"; this guide gives you an honest yes.

## Which screen reader, with which browser

Screen readers are tested as pairs with a browser, because each browser builds
the accessibility tree slightly differently.

| Screen reader | Platform | Cost | Pair it with |
|---|---|---|---|
| NVDA | Windows | Free | Chrome or Firefox |
| JAWS | Windows | Paid (a 40-minute demo mode) | Chrome or Edge |
| VoiceOver | macOS, iOS | Built in | Safari |
| TalkBack | Android | Built in | Chrome |
| Narrator | Windows | Built in | Edge |

JAWS and NVDA dominate desktop use among screen-reader users, and VoiceOver
on iOS dominates mobile. For a developer, NVDA with Chrome on Windows or
VoiceOver with Safari on a Mac is the practical starting point; a product with
a public audience should also check VoiceOver on an iPhone and one Windows
reader.

## How screen readers read a web page

Two ideas explain most of what you'll hear.

**Screen readers read the accessibility tree, not the screen.** The browser
builds it from the DOM: each node has a role, a name, a state and sometimes a
value and description. CSS that hides something with `display: none` or
`visibility: hidden` removes it from the tree; `opacity: 0` or moving it
off-screen does not. What you hear is exactly what the tree contains, which is
why DevTools' Accessibility pane (in Chrome and Firefox) is your best debugging
companion.

**Desktop screen readers have two modes.** In *browse mode* (NVDA; JAWS calls
it the virtual cursor) the reader intercepts keys: arrow keys read line by
line, `H` jumps to the next heading, `K` to the next link. In *focus mode*
(forms mode) keys go to the page, so typing in a text field works. Readers
switch automatically when focus lands on an input or on a widget with an
application-style role. That is why `role="application"` or a misused
`role="menu"` can make a page feel broken: it switches off the navigation keys
users rely on.

## The commands you need

You can test competently with about a dozen commands.

| Action | NVDA (Windows) | VoiceOver (macOS) |
|---|---|---|
| Start / stop | Ctrl+Alt+N / Insert+Q | Cmd+F5 |
| Stop speaking | Ctrl | Ctrl |
| Read next item | Down arrow | VO+Right (VO = Ctrl+Option) |
| Next heading | H | VO+Cmd+H |
| Next landmark | D | Rotor (VO+U), then Landmarks |
| Next form field | F | VO+Cmd+J |
| List all headings/links | Insert+F7 | VO+U, then Left/Right to switch list |
| Activate | Enter | VO+Space |
| Toggle browse/focus mode | Insert+Space | Not applicable (VoiceOver has no separate mode by default) |

On iOS, VoiceOver uses swipes: swipe right for next item, double-tap to
activate, and the rotor (twist two fingers) to choose headings, links or form
controls. Turn on the Speech Viewer in NVDA (Tools menu) or VoiceOver's caption
panel so you can read what was spoken while you learn.

## A ten-minute routine per page

Do this on every new screen and whenever a component with custom behaviour
changes.

1. **Headings list.** Open the headings list (Insert+F7 or the rotor). Is there
   one `<h1>` that names the page? Do the headings outline the content? Many
   screen-reader users navigate by headings first.
2. **Landmarks.** Is there a `main`, a `nav`, a `header` and a `footer`? If
   there are two `nav` landmarks, do they have different names
   (`aria-label="Primary"`, `"Pagination"`)?
3. **Tab through.** Every interactive element: is its name meaningful out of
   context ("Edit order 1042", not "Edit")? Is its role right (button vs link)?
   Is state announced ("expanded", "selected", "checked")?
4. **Operate every widget.** Open the menu, switch tabs, open and close the
   modal. Is the change announced? Where does focus go?
5. **Fill in a form and submit it wrong.** Is each error read? Do you know
   what to fix? ([accessible forms](accessible-forms-and-errors.md))
6. **Trigger async updates.** Save, filter, delete. Is "Saved" or "12 results"
   announced without you moving? If not, you need a `role="status"` region.
7. **Read the images.** Arrow through: do informative images have useful `alt`,
   and are decorative ones silent?

Write down what you heard next to what you expected. "Heard: 'button'.
Expected: 'Delete order 1042, button'" is a bug report anyone can act on.

## What common bugs sound like

Learning to recognise the symptom saves time.

| You hear | Likely cause |
|---|---|
| "Button" with no name | Icon-only button without `aria-label` or hidden text |
| "Clickable" or nothing at all | A `<div onClick>` with no role or focusability |
| "Link, link, link" through a list | Repeated "Read more" links with no context |
| The whole card read as one long link | A block link wrapping headings, text and buttons |
| "Edit text, blank" | An input whose only label is a placeholder, after typing |
| Nothing when a toast appears | No live region, or the region was inserted along with its text |
| The page behind the modal is readable | Background not inert; not using `showModal()` |
| "Star" after a label | A decorative asterisk not hidden with `aria-hidden` |
| Content read twice | Visible text plus the same `aria-label`, or an image with `alt` inside a link with the same text |
| Nothing after a route change | SPA did not move focus or update the title |

## Debugging with the accessibility tree

When the reader says something unexpected, don't guess. Open DevTools, select
the element, and look at the Accessibility pane: computed role, computed name
(and which source it came from), and states. Chrome's full-page accessibility
tree view (the toggle in the Elements panel) shows the page as a screen reader
sees it.

Most "the screen reader is wrong" reports are really the tree being wrong. The
exceptions are genuine browser or screen-reader bugs; for those, check the
pattern on a second pairing before building a workaround, and look for the
issue on the reader's public tracker.

## Screen-reader checks you can automate

A few things you hear can be asserted in tests, because Testing Library queries
use the same accessible-name computation:

```ts
expect(screen.getByRole('button', { name: 'Delete order 1042' })).toBeVisible();
expect(screen.getByRole('status')).toHaveTextContent('Order saved');
expect(screen.getByRole('dialog', { name: 'Delete order 1042?' })).toBeInTheDocument();
```

Playwright's ARIA snapshots go further, capturing a subtree of the
accessibility tree as YAML and failing when roles or names change:

```ts
await expect(page.getByRole('navigation', { name: 'Primary' })).toMatchAriaSnapshot(`
  - navigation "Primary":
    - link "Orders"
    - link "Customers"
`);
```

These catch regressions in names and roles; they do not tell you whether the
experience makes sense, so they complement the manual routine rather than
replace it. See [a11y testing in CI](accessibility-testing-in-ci.md).

## Limits and etiquette

- A developer using a screen reader for ten minutes is not a screen-reader
  user. Experienced users navigate much faster and in different ways. For
  important flows, usability testing with disabled users finds problems no
  checklist will.
- Don't design around one reader's quirk. Build to the spec and the APG
  pattern, then check on a second pairing.
- Don't turn speech rate down to learn and then judge verbosity; real users
  often listen at two to three times normal speed, and redundant text costs
  them more than it costs you.

## What you should be able to answer

- Why test with a screen-reader and browser pair rather than a screen reader
  alone?
- What are browse mode and focus mode, and why does `role="application"`
  change the experience?
- Walk through how you'd test a new page with NVDA or VoiceOver in ten minutes.
- A toast shows "Saved" but the screen reader says nothing. What do you check?
- How do you find out why an element's accessible name is wrong?
- Which parts of a screen-reader test can be automated, and which can't?
