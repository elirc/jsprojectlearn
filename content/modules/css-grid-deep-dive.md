# CSS Grid deep dive

Grid is the layout system for anything with rows *and* columns: page shells, dashboards,
card lists, forms whose labels line up. It replaced a decade of float and flexbox hacks,
and interviewers now expect you to read a grid definition at a glance, predict where
auto-placed items land, and explain the one-liner responsive grid instead of copying it.

## Vocabulary

- **Tracks** are rows and columns. **Lines** are the edges between them, numbered from 1,
  and from −1 counting back from the end.
- **Cells** are single row/column intersections; **areas** are rectangles of cells.
- The **explicit grid** is what `grid-template-columns` and `grid-template-rows` define. Items
  that do not fit create **implicit** tracks, sized by `grid-auto-rows` and
  `grid-auto-columns`.

```css
.dashboard {
  display: grid;
  grid-template-columns: 240px 1fr 1fr;
  grid-template-rows: auto 1fr;
  gap: 16px 24px;          /* row-gap, then column-gap */
}
```

## Track sizing

| Value | Meaning |
| --- | --- |
| `200px`, `20rem` | fixed |
| `1fr` | a share of the leftover space, **after** fixed tracks and gaps |
| `auto` | sized by content, and stretches to fill spare space |
| `min-content` / `max-content` | narrowest / widest the content can be |
| `minmax(200px, 1fr)` | at least 200px, at most one share |
| `fit-content(300px)` | content size, capped at 300px |

Because gaps are taken off before `fr` shares are handed out, `repeat(3, 1fr)` with a
10px gap in a 620px container gives three 200px columns. `repeat(3, 33.33%)` with the same
gap overflows, since percentages ignore the gaps.

### The `1fr` minimum

`1fr` is shorthand for `minmax(auto, 1fr)`, and the `auto` minimum is the content's
min-content size. One unbreakable string, such as a long URL or a line in a `<pre>`, makes
the track wider than its share and the page scrolls sideways:

```css
.layout { grid-template-columns: 250px minmax(0, 1fr); } /* not 250px 1fr */
pre     { overflow-x: auto; }
```

`minmax(0, 1fr)` lets the track shrink below its content. It is the grid version of
`min-width: 0` on a flex item, and it belongs in almost every main-content column.

## Placing items

```css
.header  { grid-column: 1 / -1; }        /* span every explicit column */
.sidebar { grid-row: 1 / span 2; }       /* start at line 1, cover two rows */
.chart   { grid-column: span 2; }        /* auto-placed, two columns wide */
```

Named areas make page layouts readable, and you can redefine them in a media query without
touching the markup:

```css
.page {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  grid-template-areas:
    "header header"
    "nav    main"
    "footer footer";
}
.page > header { grid-area: header; }
.page > nav    { grid-area: nav; }
.page > main   { grid-area: main; }

@media (width < 700px) {
  .page {
    grid-template-columns: 1fr;
    grid-template-areas: "header" "main" "nav" "footer";
  }
}
```

Each string is a row and each word a cell; repeating a name spans it, and `.` leaves a cell
empty. Areas must be rectangles.

## Auto-placement

Items without an explicit position are placed in source order, left to right, filling
each row before moving on. Two behaviours cause surprises:

- **Holes.** If an item spans two columns and only one cell is left in the row, it moves to
  the next row and, in the default "sparse" mode, the placement cursor never goes back. The
  empty cell stays empty.
- **Dense packing.** `grid-auto-flow: dense` backfills those holes with later items. Great
  for a photo wall; bad for anything with an order, because visual order no longer matches
  the DOM and keyboard focus jumps around.

Implicit rows default to `auto`, so a grid with `grid-template-rows: 100px 100px` and nine
items in three columns has a third row sized by its content. Set `grid-auto-rows:
minmax(100px, auto)` when every row should share a minimum height.

## The responsive grid one-liner

```css
.cards {
  display: grid;
  gap: 20px;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
}
```

The browser creates as many columns as fit at their **minimum** size, including gaps, and
then `1fr` stretches them. In a 1000px container: four columns would need 4 × 250 + 3 × 20 =
1060px, so it makes three, each (1000 − 40) ÷ 3 = 320px. No media queries.

`auto-fill` versus `auto-fit` only matters when there are fewer items than columns:

| | `auto-fill` | `auto-fit` |
| --- | --- | --- |
| Empty tracks | kept, so items stay at their natural share | collapsed to zero |
| Two cards in 1000px, `minmax(200px, 1fr)` | 200px each, three empty tracks | 500px each |

Use `auto-fill` when a lone card should not stretch across the page. A common refinement
caps the minimum so it never overflows a narrow phone:
`minmax(min(250px, 100%), 1fr)`.

## Alignment

Grid has two sets of alignment: items inside their cells, and the whole grid inside the
container.

| Property | Aligns | Axis |
| --- | --- | --- |
| `justify-items` / `justify-self` | items in their cells | inline (row) |
| `align-items` / `align-self` | items in their cells | block (column) |
| `justify-content` / `align-content` | the tracks within the container | when tracks are smaller than the container |
| `place-items` | shorthand for align + justify items | both |

`display: grid; place-items: center;` is the shortest way to centre one child both ways.

## Subgrid

Cards in a row often need their titles, bodies and footers to line up, even when titles
wrap to different lengths. Before subgrid, you faked it with fixed heights. Now a card can
adopt its parent's row tracks:

```css
.products {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 1rem;
}
.card {
  display: grid;
  grid-row: span 3;                 /* title, body, footer */
  grid-template-rows: subgrid;
}
```

Each row of the product grid is now as tall as the tallest title in it, and every section
lines up across the cards. Subgrid is supported in all current browsers. Do not confuse it
with `display: contents`, which removes the wrapper's box entirely so its children become
grid items directly, which is handy for markup a framework controls, but you lose the
wrapper's styling.

## Animating grid tracks

Track sizes interpolate, which gives a JavaScript-free way to animate an accordion to its
content height, something `height: auto` cannot do without the newer `interpolate-size`:

```css
.panel         { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.25s; }
.panel.open    { grid-template-rows: 1fr; }
.panel > .inner { min-height: 0; overflow: hidden; }
```

## Grid or flexbox?

Grid when the layout decides the sizes and things must align in two directions; flexbox
when content decides the sizes and items flow in one direction. See the
[flexbox deep dive](flexbox-deep-dive.md) for the other half, and
[CSS layout and responsive design](css-layout-and-responsive.md) for how they fit with
positioning and responsive design. The [infinite gallery](../../73-infinite-gallery/) and
[spreadsheet](../../78-spreadsheet-mini/) projects are good grid practice.

## What you should be able to answer

- What does `1fr` mean, how do gaps affect it, and why can a `1fr` column overflow?
- How do you make an item span every column, and what do negative line numbers mean?
- Why does a two-column item leave a hole in an auto-placed grid, and what does `dense`
  trade away to fill it?
- How does `repeat(auto-fill, minmax(250px, 1fr))` decide the number of columns, and how
  does `auto-fit` differ?
- What problem does subgrid solve, and how is it different from `display: contents`?
- When would you use grid rather than flexbox for the same component?
