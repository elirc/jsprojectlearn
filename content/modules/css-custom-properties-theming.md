# Custom properties and theming

Custom properties ("CSS variables") are how modern apps do design tokens, dark mode and
per-component variants without a preprocessor. They look like Sass variables but behave
completely differently: they live on elements, inherit, and resolve at runtime. Interviewers
ask about them to see whether you understand that difference, and "how would you add dark
mode?" is a common practical follow-up.

## What they are

A custom property is any property whose name starts with `--`. It holds a list of tokens,
cascades and inherits like `color`, and is read with `var()`:

```css
:root {
  --space-2: 0.5rem;
  --radius: 8px;
  --brand: oklch(55% 0.2 260);
}

.btn {
  padding: var(--space-2) calc(var(--space-2) * 2);
  border-radius: var(--radius);
  background: var(--brand);
}
```

Three facts drive everything else:

1. **They inherit.** Set a value on an ancestor and every descendant sees it; override it
   on a subtree and only that subtree changes.
2. **They are resolved at computed-value time,** per element, after the cascade. Change one
   in DevTools or from JavaScript and everything that uses it updates.
3. **They are untyped by default.** `var()` substitutes tokens; it does no maths and knows
   nothing about lengths or colours unless you register the property.

Names are case-sensitive: `--Brand` and `--brand` are different properties.

## Sass variables versus custom properties

| | Sass `$brand` | CSS `--brand` |
| --- | --- | --- |
| Resolved | at build time, gone in the output | at runtime, per element |
| Scope | lexical, in the source file | the DOM tree, via inheritance |
| Change from JS or a media query | no | yes |
| Use in a media query condition | yes | no |
| Maths and colour functions | Sass functions | `calc()`, `color-mix()`, relative colours |

The one thing Sass can do that custom properties cannot is appear in a media query
condition: `@media (min-width: var(--bp))` is invalid because media queries are evaluated
without an element to read the variable from. Share breakpoints through your build tool
or use container queries.

## Fallbacks, and the "invalid at computed-value time" trap

```css
.badge { background: var(--badge-bg, var(--brand, teal)); }
```

The second argument is used when the property is not defined at all. Fallbacks can nest.

The subtle part is what happens when a variable *is* defined but holds the wrong kind of
value:

```css
p { color: blue; }
p { --c: 20px; color: var(--c); }
```

The second declaration wins the cascade (the parser cannot know what `--c` will hold), then
`20px` turns out not to be a colour. The declaration becomes **invalid at computed-value
time** and behaves like `unset`: the paragraph inherits its parent's colour. The earlier
`blue` rule does not come back. When a themed value "reverts to black" or "ignores my
fallback rule", this is usually why.

Token substitution also explains why `font-size: var(--size)px` with `--size: 12` fails:
the result is the number `12` followed by a separate `px` token, not the length `12px`.
Multiply instead: `calc(var(--size) * 1px)`.

## Design tokens in layers

Most design systems use two tiers of tokens:

```css
:root {
  /* primitives: the palette */
  --blue-600: oklch(50% 0.2 260);
  --grey-50: oklch(98% 0 0);
  --grey-900: oklch(20% 0 0);

  /* semantic tokens: what components actually use */
  --surface: var(--grey-50);
  --text: var(--grey-900);
  --accent: var(--blue-600);
}

.card { background: var(--surface); color: var(--text); }
```

Components only reference semantic tokens (`--surface`, `--text`, `--accent`), so a theme
is just a different mapping of semantic tokens to primitives. Nothing in the component CSS
changes.

## Dark mode with a manual override

The requirement is usually "follow the OS by default, but let the user pick Light or Dark".
A media query alone cannot honour the override, and a class alone ignores the OS. Combine
them:

```css
:root {
  color-scheme: light dark;
  --surface: oklch(98% 0 0);
  --text: oklch(20% 0 0);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --surface: oklch(20% 0 0);
    --text: oklch(95% 0 0);
  }
}

:root[data-theme="dark"] {
  --surface: oklch(20% 0 0);
  --text: oklch(95% 0 0);
}
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"]  { color-scheme: dark; }
```

The toggle only sets `document.documentElement.dataset.theme` and saves the choice in
`localStorage`. Apply the saved value in a tiny inline script in `<head>`, before the
stylesheet renders, or users see a flash of the wrong theme on every load.

`color-scheme` matters more than it looks: it tells the browser to render scrollbars, form
controls, the default page background and system colours in the matching scheme. Without
it, your dark page has glaring white date pickers.

For short cases, `light-dark()` picks between two values based on the element's used colour
scheme, and only works when `color-scheme` allows dark:

```css
.note { background: light-dark(#fff8e1, #3a3000); }
```

## Component variants and the "API" of a component

Because custom properties inherit, they make good component parameters:

```css
.btn {
  --btn-bg: var(--accent);
  --btn-fg: white;
  background: var(--btn-bg);
  color: var(--btn-fg);
  padding: var(--btn-pad, 0.5rem 1rem);
}
.btn.danger { --btn-bg: var(--red-600); }
.toolbar.compact .btn { --btn-pad: 0.25rem; }
```

Variants override one or two variables instead of repeating whole rule sets. Custom
properties also cross shadow DOM boundaries (they inherit like any property), which is why
web components expose theming as documented variables such as `--button-bg`, alongside
`::part()` for structural styling.

## Colour functions

Tokens get much more useful with runtime colour maths:

```css
.btn:hover   { background: color-mix(in oklch, var(--btn-bg), black 15%); }
.btn:disabled { background: oklch(from var(--btn-bg) l c h / 50%); }
```

`color-mix()` blends two colours in a chosen space; relative colour syntax
(`oklch(from …)`) lets you adjust one channel. Both follow whatever the token currently is,
so a theme change reaches hover states without extra tokens. `oklch` is a good default
space because equal lightness steps look equally light, unlike `hsl`.

## Driving CSS from JavaScript

Set one variable and let CSS do the rest:

```js
bar.style.setProperty('--progress', `${percent}%`);
getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
```

That keeps layout logic in CSS and avoids setting half a dozen inline styles. It is also
how pointer-following effects work: write `--x` and `--y` on `pointermove`, and use them in
a `transform` or gradient.

## Registered properties

An unregistered custom property cannot be animated; the browser swaps it at the midpoint.
Register a type with `@property` and it interpolates:

```css
@property --angle {
  syntax: '<angle>';
  inherits: false;
  initial-value: 0deg;
}
.spinner-border {
  background: conic-gradient(from var(--angle), var(--accent), transparent);
  animation: turn 1.2s linear infinite;
}
@keyframes turn { to { --angle: 360deg; } }
```

Registration also makes the browser check values against the type, so a declaration such as
`--angle: red` is dropped at parse time like any other invalid CSS, and `inherits: false`
stops a value leaking into every descendant.

The cascade rules behind all of this are in
[the cascade, specificity and cascade layers](css-cascade-layers-specificity.md). Build the
[theme context](../../react/34-context-theme/) project with a CSS-variable theme instead of
inline styles, and store the choice as described in
[browser storage compared](browser-storage-compared.md).

## What you should be able to answer

- How do custom properties differ from Sass variables, and what can each do that the
  other cannot?
- What happens when a `var()` resolves to a value of the wrong type?
- How would you implement Light, Dark and System themes, and avoid a flash of the wrong
  theme on load?
- What does `color-scheme` change, and why does `light-dark()` depend on it?
- How do custom properties help you build component variants and theme web components?
- Why can a custom property not be transitioned by default, and how does `@property` fix it?
