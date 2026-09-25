# Flexbox deep dive

Flexbox lays out most of the UI you will build: toolbars, nav bars, form rows, card
footers, media objects. Most people learn it from a cheat sheet and then fight it when
text overflows or a sidebar shrinks. Interviewers probe the sizing algorithm, because
knowing how `flex-grow`, `flex-shrink` and `flex-basis` interact is what lets you fix
layouts on purpose instead of by trial and error.

## Two axes, and which properties use which

A flex container has a **main axis** (the direction of `flex-direction`) and a **cross
axis** at right angles to it.

| Property | Set on | Works along | Default |
| --- | --- | --- | --- |
| `justify-content` | container | main axis | `flex-start` |
| `align-items` | container | cross axis, within each line | `stretch` |
| `align-content` | container | cross axis, spacing between wrapped lines | `normal` (behaves as `stretch`) |
| `align-self` | item | cross axis, overrides `align-items` | `auto` |
| `gap` | container | between items and lines | `0` |
| `flex-wrap` | container | whether items may wrap | `nowrap` |

Switch to `flex-direction: column` and the axes swap: `justify-content: center` now
centres vertically (if the container has spare height), and `align-items` controls width.
That swap explains a common surprise: in a column container, `align-items: center` makes
full-width buttons shrink to their text, because they are no longer stretched across the
cross axis.

The default `align-items: stretch` is why cards in a row are equal height for free, and
also why an image or button in a flex row sometimes stretches tall when you did not
expect it. `align-items: flex-start` (or `start`) turns it off.

## The three sizing properties

Every flex item has:

- `flex-basis`: its starting size along the main axis. `auto` means "use `width` (or
  `height` in a column), and if that is also `auto`, use the content size".
- `flex-grow`: how much of the **leftover** space it takes, relative to the others.
- `flex-shrink`: how much it gives up when there is **too little** space, weighted by its
  basis.

The shorthand is where most confusion lives:

| Shorthand | Expands to | Behaviour |
| --- | --- | --- |
| `flex: initial` (the default) | `0 1 auto` | content-sized, may shrink, never grows |
| `flex: auto` | `1 1 auto` | starts at content size, then shares extra space |
| `flex: 1` | `1 1 0%` | ignores content size; shares all space equally |
| `flex: none` | `0 0 auto` | rigid: exactly its content or `width` |
| `flex: 0 0 280px` | as written | a fixed 280px column |

### Doing the arithmetic

Grow shares the space left **after** the bases:

```css
.row { display: flex; width: 600px; }
.a   { flex: 1 1 100px; }
.b   { flex: 2 1 100px; }
```

Free space is 600 − 200 = 400px, split 1 : 2, so `.a` is 100 + 133⅓ ≈ 233px and `.b` is
100 + 266⅔ ≈ 367px. Only when the bases are zero (`flex: 1` and `flex: 2`) do you get a
clean 200px and 400px split of the whole row. This is why three tabs with `flex: auto`
end up different widths while `flex: 1` makes them identical.

Precedence, for when several sizes are set: `flex-basis` (if not `auto`) replaces `width`,
and then `min-width` and `max-width` clamp the result. An item with `width: 200px;
flex: 0 0 300px; max-width: 250px` ends up 250px.

## Shrinking, and the `min-width: auto` trap

Items shrink by default (`flex-shrink: 1`). Two consequences cause most flexbox bugs.

**Fixed things shrink.** A sidebar with `width: 280px` gets narrower when the main area has
a wide table. Give it `flex-shrink: 0` or `flex: none`.

**Content refuses to shrink.** A flex item's default `min-width` is `auto`, meaning "no
smaller than my content's minimum width". A long title, URL or `<pre>` therefore pushes the
row wider than the container and truncation never kicks in:

```css
.row   { display: flex; gap: 1rem; }
.title {
  flex: 1;
  min-width: 0;            /* allow shrinking below the content width */
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
```

`min-width: 0` (or `overflow: hidden`, which also resets the automatic minimum) is the fix,
and it often needs to go on every flex ancestor between the text and the container. Grid has
the same rule, which is why `minmax(0, 1fr)` exists.

## Alignment tricks worth knowing

- **Push one item to the end.** `margin-left: auto` (or `margin-inline-start: auto`) on the
  last nav item absorbs all the free space before it. Auto margins beat
  `justify-content`.
- **Centre anything.** `display: flex; align-items: center; justify-content: center;` or,
  shorter, `display: grid; place-items: center;`.
- **Baseline alignment.** `align-items: baseline` lines up the text of a label and a
  larger input or a price and its currency symbol.
- **Sticky footer.** Make `body` a column with `min-height: 100dvh` and give `main`
  `flex: 1`, so the footer sits at the bottom on short pages and flows normally on long
  ones.

```css
body   { min-height: 100dvh; display: flex; flex-direction: column; }
main   { flex: 1; }
```

## Wrapping

With `flex-wrap: wrap`, items that do not fit move to a new line, and each line is laid out
independently. That is the key difference from grid: items on different lines do not line
up in columns.

```css
.tags { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.tags > * { flex: 0 0 auto; }
```

Wrapping flex is ideal for tags, chips and button groups whose widths vary. A card grid
where each row should align is a grid job. `align-content` spaces the lines when the
container is taller than they need; `row-gap` sets a fixed gap between them.

## Spacing with `gap`

Use `gap` rather than margins on items. It only adds space *between* items, so you do not
need `:last-child` resets, it works across wrapped lines, and it does not collapse the way
block margins do. Remember that flex items never have collapsing margins, so a stack that
switches from block flow to `display: flex` can suddenly show double spacing if it relied
on margins.

## Order and accessibility

`order` and `flex-direction: row-reverse` change painting order only. Keyboard focus and
screen readers still follow the DOM, so a visually reordered form can tab in a confusing
sequence. Reorder the markup when the order carries meaning, and keep `order` for
decoration. The same caution applies to grid placement; see
[accessibility fundamentals](accessibility-fundamentals.md).

## Flexbox or grid?

| Use flexbox when | Use grid when |
| --- | --- |
| content decides the sizes (toolbars, tags) | the layout decides the sizes (page shells, dashboards) |
| one direction at a time | rows and columns must line up |
| items should wrap independently | cards must align across rows |
| aligning a few things in a row | placing things in named areas |

They combine well: a grid for the page and card list, flexbox inside each card's header
and footer. The grid side is in the [grid deep dive](css-grid-deep-dive.md), and the
overview of both in [CSS layout and responsive design](css-layout-and-responsive.md). For
practice, rebuild the [kanban board](../../64-kanban/) columns and the
[searchable table](../../react/45-searchable-table/) toolbar with flexbox only.

## What you should be able to answer

- Which properties work on the main axis and which on the cross axis, and what changes in a
  column container?
- What do `flex: 1`, `flex: auto` and `flex: none` expand to, and when would you use each?
- Given two items with bases and grow factors, how wide does each end up?
- Why does a long title stop a flex item shrinking, and what does `min-width: 0` do?
- How do you push one item to the far end of a row, and why does it work?
- When would you choose grid over flexbox for the same UI?
