# DOM events and delegation

Every interactive screen is event handlers. Interviewers probe events because the model
is small but easy to get subtly wrong: the three phases, `target` versus `currentTarget`,
what `preventDefault` actually cancels, and why one listener on a list beats five hundred.
Get these right and a whole class of "the click does nothing" bugs stops happening.

## The three phases

When the user clicks a `<span>` inside a `<button>` inside a `<li>`, the browser builds a
path from `window` down to the span and dispatches the event along it in three phases:

| Phase | Direction | Who runs |
| --- | --- | --- |
| Capture | `window` → parent of target | listeners added with `{ capture: true }` |
| Target | the target itself | capture listeners first, then bubble listeners |
| Bubble | parent of target → `window` | ordinary listeners (the default) |

```js
list.addEventListener('click', () => console.log('list, bubble'));
list.addEventListener('click', () => console.log('list, capture'), { capture: true });
button.addEventListener('click', () => console.log('button'));
// Clicking the button logs: list, capture → button → list, bubble
```

Most events bubble. The ones that do not are worth knowing by name: `focus` and `blur`
(use `focusin` and `focusout` if you want bubbling), `mouseenter` and `mouseleave`,
`load` on elements, and `scroll` on elements (it bubbles only from the document to `window`).
If a delegated listener never fires, check this first.

## `target` versus `currentTarget`

- `event.target` is the innermost element the event was dispatched to: the span, the SVG
  `<path>` inside an icon, the text in a label.
- `event.currentTarget` is the element whose listener is running right now. It is only
  set during dispatch; log it later and it is `null`.

```js
button.addEventListener('click', (e) => {
  console.log(e.target);        // maybe the <svg> or <path> inside the button
  console.log(e.currentTarget); // always the button
});
```

The classic bug is reading `e.target.dataset.id` on a button that contains an icon: clicking
the padding works, clicking the icon gives `undefined`. Use `currentTarget` for direct
listeners and `closest()` for delegated ones.

## Delegation

Instead of attaching a listener to every row, attach one to a stable ancestor and work out
which row was hit:

```js
const table = document.querySelector('#orders');

table.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn || !table.contains(btn)) return;

  const row = btn.closest('tr');
  if (btn.dataset.action === 'delete') deleteOrder(row.dataset.id);
  if (btn.dataset.action === 'edit') openEditor(row.dataset.id);
});
```

Why it wins:

1. **Rows added later just work.** Rows rendered after a fetch need no new wiring, which is
   the main reason to use it.
2. **One listener instead of N.** Less memory, and nothing to remove when rows are deleted.
3. **Data lives in attributes.** The handler reads `data-id` from the DOM rather than
   closing over a loop variable.

The `table.contains(btn)` check matters when tables nest: `closest()` walks up past the
table you listened on and can find a button in an outer component. It is the same reason
you should not use delegation on `document` for everything; scope it to the component that
owns the markup.

Frameworks do this for you. React attaches one listener per event type to the root
container and dispatches to your handlers itself, which is why `e.nativeEvent` exists and
why `stopPropagation` in React stops React's propagation, not necessarily the native one.

## Cancelling: `preventDefault` versus `stopPropagation`

They do unrelated things, and mixing them up is the most common event bug in code review.

| Call | What it stops | Typical use |
| --- | --- | --- |
| `preventDefault()` | the browser's default action (navigate, submit, check the box, scroll) | handling a form submit with `fetch` |
| `stopPropagation()` | the event reaching further elements on its path | a button inside a clickable card |
| `stopImmediatePropagation()` | further elements *and* other listeners on this element | rarely justified |

```js
form.addEventListener('submit', async (e) => {
  e.preventDefault();                 // no full-page POST
  const data = new FormData(form, e.submitter); // includes the clicked button's name/value
  await fetch(form.action, { method: 'POST', body: data });
});
```

Two details interviewers like:

- `preventDefault()` does nothing if the event is not `cancelable`, and it is ignored in a
  listener registered with `{ passive: true }`. Browsers make `touchstart`, `touchmove` and
  `wheel` listeners on `window`, `document` and `body` passive by default so scrolling
  never waits for JavaScript.
- `stopPropagation()` is a smell. It breaks every delegated listener above you, including
  analytics and "click outside to close" handlers. Prefer checking `e.target` in the outer
  handler or using `e.defaultPrevented` as a signal.

## Listener options and cleanup

```js
const controller = new AbortController();

window.addEventListener('resize', onResize, { passive: true, signal: controller.signal });
dialog.addEventListener('close', onClose, { once: true });

// later, when the widget is destroyed:
controller.abort(); // removes every listener registered with this signal
```

- `once: true` removes the listener after its first call.
- `signal` lets you remove many listeners at once without keeping function references,
  which is the tidy way to clean up in a component or a custom element's
  `disconnectedCallback`.
- `removeEventListener` only works with the *same* function reference and the same
  `capture` flag. Passing a new arrow function removes nothing.

Forgetting cleanup is the classic memory leak in vanilla apps: a global `resize` or
`keydown` listener keeps a detached component alive forever.

## Custom events

Components talk upwards by dispatching events, exactly like native elements do:

```js
card.dispatchEvent(new CustomEvent('order:selected', {
  detail: { id: 42 },
  bubbles: true,   // default false, so ancestors never hear it without this
  composed: true,  // needed to cross a shadow DOM boundary
}));

document.addEventListener('order:selected', (e) => showDetails(e.detail.id));
```

`dispatchEvent` is synchronous: every listener has run by the time it returns, and its
return value is `false` if a listener called `preventDefault()` on a `cancelable` event.
That makes "ask permission" patterns possible (`if (!el.dispatchEvent(evt)) return;`).
Events you dispatch yourself have `isTrusted === false`, and browsers will not treat them
as user activation, so a synthetic click cannot open a popup or start fullscreen.

## Choosing the right event

| You want | Use | Not |
| --- | --- | --- |
| React to every edit, including paste and autocorrect | `input` | `keyup`, which misses paste and IME text |
| Commit when a field is left or a select changes | `change` | `blur` alone |
| Handle submit by Enter or button | `submit` on the form | `click` on the button |
| Keyboard shortcuts | `keydown` and `e.key` | `keypress` (deprecated) or `keyCode` |
| Mouse, pen and touch together | `pointerdown` / `pointerup` | separate mouse and touch handlers |
| Know when a field gains focus inside a form | `focusin` on the form | `focus`, which does not bubble |
| Leave-page warning for unsaved changes | `beforeunload` with `preventDefault()` | a custom modal, which browsers block |

High-frequency events (`input` for search, `scroll`, `resize`, `pointermove`) usually need
debouncing or throttling; the [debounce and throttle project](../../28-debounce-throttle/)
and [search as you type](../../54-search-as-you-type/) build both by hand.

## Where this shows up in real code

- The [kanban](../../64-kanban/) and [drag-and-drop list](../../80-drag-drop-list/) projects
  are delegation plus pointer events on a list that changes under you.
- [Event handlers in React](../../react/14-event-handlers/) shows the same ideas through
  React's synthetic events.
- The rendering side of events (why a long handler freezes the page) is in
  [what the browser does with a URL](browser-rendering-and-network.md), and keyboard
  handling for widgets is in [accessibility fundamentals](accessibility-fundamentals.md).

## What you should be able to answer

- In what order do capture and bubble listeners run for a click on a nested element, and
  which common events do not bubble?
- What is the difference between `event.target` and `event.currentTarget`, and how does
  `closest()` fix the "clicked the icon, got undefined" bug?
- Why is event delegation useful, and what can go wrong if you delegate from too high up?
- What is the difference between `preventDefault()` and `stopPropagation()`, and why is
  `stopPropagation()` often a code smell?
- How do you remove a group of listeners cleanly, and why does
  `removeEventListener(type, () => …)` never work?
- What do `bubbles` and `composed` do on a `CustomEvent`?
