# CSS layout and responsive design, for people who'd rather write JavaScript

A full-stack CRUD developer owns their screens. "Centre this", "why won't my
`z-index` work" and "make this table usable on a phone" are daily tasks, and
flex vs grid, specificity and stacking contexts are standard screening
questions. You don't need to be a designer. You need the mental models that stop
CSS feeling random.

## The box model

Every element is a box: content, then padding, then border, then margin. By
default `width` sets only the content box, so `width: 300px` plus
`padding: 20px` renders 340px wide. Nearly every codebase opts out globally:

```css
*, *::before, *::after { box-sizing: border-box; }
```

Now `width` includes padding and border, which is how you think about it anyway.
Vertical margins between blocks also *collapse*: two adjacent 16px margins give
16px, not 32px. Flex and grid children don't collapse, which is one reason
`gap` has replaced most margin juggling.

## The cascade

When two rules set the same property, the browser picks a winner in this order:

1. **Origin and importance.** `!important` beats normal declarations.
   Among `!important` declarations the layer order flips: earlier layers win,
   so a reset's `!important` beats a component's.
2. **Cascade layers.** Later `@layer`s beat earlier ones, and unlayered styles
   beat all layered ones.
3. **Specificity**, counted as (IDs, classes/attributes/pseudo-classes,
   elements). `#nav a` is (1,0,1) and beats `.menu .link` at (0,2,0).
4. **Source order.** Last one wins.

Inline `style` beats any selector. `:where()` contributes zero specificity,
which makes it ideal for base styles that are easy to override; `:is()` and
`:not()` take the specificity of their most specific argument.

```css
@layer reset, base, components;
@layer base { :where(a) { color: var(--link); } }
@layer components { .btn { color: white; } }
```

`!important` is a smell because it escalates: the next person needs another
`!important` to beat yours. When a style "doesn't apply", open DevTools, find
the struck-through declaration, and it tells you which rule won. Inheritance is
separate: `color` and `font` inherit from the parent; `margin`, `border` and
`background` don't.

## Units that matter

| Unit | Relative to | Use for |
|---|---|---|
| `rem` | Root font size | Font sizes, spacing. Respects the user's browser setting. |
| `em` | The element's own font size | Padding that scales with a button's text |
| `px` | Nothing (a CSS pixel) | Borders, hairlines |
| `%` | The parent (width for most properties) | Fluid widths |
| `vw`, `dvh` | The viewport | Full-screen sections |

On mobile, `100vh` includes the area behind the browser toolbar, so a
`100vh` layout gets cut off. `100dvh` tracks the visible area. For fluid type
without breakpoints, use `clamp(min, preferred, max)`:

```css
h1 { font-size: clamp(1.5rem, 1rem + 2vw, 2.5rem); }
```

## Flexbox: one dimension

Flex lays items out along a **main axis** (the `flex-direction`) and aligns them
on the **cross axis**. `justify-content` works on the main axis;
`align-items` on the cross axis. Centring anything:

```css
.centre { display: flex; justify-content: center; align-items: center; }
```

`flex: 1` is shorthand for `flex: 1 1 0%`: grow, shrink, start from zero width,
so siblings with `flex: 1` share space equally.

**The overflow trap.** A flex item's default `min-width` is `auto`, meaning it
won't shrink below its content. A long URL or an unbroken string pushes the
whole layout off-screen, and `overflow: hidden` on the item appears not to
work. The fix is `min-width: 0` on the flex item (and `text-overflow: ellipsis`
if you want the dots).

## Grid: two dimensions

Grid defines rows and columns up front and places items into them.

```css
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: 1rem;
}
.page {
  display: grid;
  grid-template-areas: "nav header" "nav main";
  grid-template-columns: 14rem 1fr;
}
```

`fr` is a fraction of the leftover space. The `auto-fit` + `minmax()` line is a
responsive card grid with no media query. `subgrid` lets a child grid reuse its
parent's tracks, so the titles and prices in a row of cards line up.

| Use flex when | Use grid when |
|---|---|
| Content decides the size (a toolbar, tags, a button row) | The layout decides the size (a page shell, a dashboard) |
| One row or one column | Rows and columns must line up |
| Items should wrap naturally | You want named areas or explicit placement |

Most screens use both: grid for the page, flex inside the components.

## Positioning and stacking contexts

`position: relative` offsets an element from where it would be and becomes the
anchor for absolutely positioned children. `absolute` takes it out of flow.
`fixed` pins it to the viewport. `sticky` scrolls until it hits an offset and
then sticks within its parent.

Why `z-index: 9999` does nothing: `z-index` only competes within the same
**stacking context**. A parent with `transform`, `opacity` below 1, `filter`,
`isolation: isolate`, or `position` plus a `z-index` creates a new one. Your
modal at 9999 is on top *inside* a parent sitting at 1, underneath a sibling at 2.
No number fixes that. The fixes are to render the modal elsewhere in the DOM (a
portal, [react/38](../../react/38-portal-modal/)) or use `<dialog>` with
`showModal()`, which renders in the top layer above everything.

## Responsive design

Write the mobile layout first, then add complexity as space allows:

```css
.list { display: grid; gap: .5rem; }
@media (min-width: 48rem) { .list { grid-template-columns: 1fr 1fr; } }
```

**Container queries** respond to the component's container, not the viewport.
A card in a narrow sidebar and the same card in the main column can lay out
differently without knowing where they live:

```css
.card-slot { container-type: inline-size; }
@container (min-width: 30rem) { .card { display: flex; } }
```

Use media queries for page layout and container queries for reusable
components. For images, `srcset` and `sizes` let the browser download the
smallest file that looks sharp; `<picture>` switches the image itself (a
cropped version on phones).

**Data tables on a 375px screen.** Pick one:

- Wrap the table in a container with `overflow-x: auto`, and give that container
  `tabindex="0"`, `role="region"` and an `aria-label` so keyboard users can
  scroll it. Keep the first column sticky.
- Hide low-priority columns below a breakpoint and show them in the detail view.
- Render a card list on narrow screens. Keep the `<table>` markup
  ([the HTML guide](html-semantics-and-forms.md) explains why) and test the
  result with a screen reader, because changing `display` on table elements can
  strip their semantics in some browsers.

## Modern CSS worth knowing

All of these are Baseline in 2026:

- **Nesting**: `.card { &:hover { … } .title { … } }` without a preprocessor.
- **`:has()`**, the parent selector: `.field:has(input:user-invalid) { … }`
  styles a whole field wrapper when its input is invalid.
- **Custom properties** for theming. Define tokens on `:root`, redefine them for
  dark mode, and components just use `var(--surface)`. This is how DevPath
  itself is styled.
- **`prefers-color-scheme`** for a default theme, and **`prefers-reduced-motion`**
  to turn off non-essential animation for users who have asked for that.

```css
:root { --surface: #fff; --text: #111; }
@media (prefers-color-scheme: dark) { :root { --surface: #111; --text: #eee; } }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
```

## Styling in a React codebase

You'll meet all of these; know what each trades.

| Approach | How it works | Trade-off |
|---|---|---|
| Plain CSS + custom properties | Global stylesheets, naming conventions | Zero tooling; naming discipline is on you |
| CSS Modules | `.module.css` files, class names scoped at build time | Scoping for free; styles live in a separate file |
| Runtime CSS-in-JS (styled-components, Emotion) | Styles generated in JavaScript at render | Co-located and dynamic; runtime cost, and styled-components is in maintenance mode |
| Zero-runtime CSS-in-JS (vanilla-extract, Panda) | Written in TS, extracted to CSS at build | Type-safe tokens; more build setup |
| Utility-first (Tailwind v4) | Small classes in markup; v4 configures in CSS with `@theme` | Fast and consistent; long class strings, a vocabulary to learn |

Interviewers want to hear that you understand the trade-offs and can work in
whichever one the team has chosen.

## What you should be able to answer

- Flex or grid for this layout, and why?
- Explain specificity. Why doesn't my style apply?
- Why is my `z-index` ignored, and what are the two fixes?
- When would you use a container query instead of a media query?
- How would you make a data table usable on a 375px screen?
- Why does a flex item with long text overflow its container?
