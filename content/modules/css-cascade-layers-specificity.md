# The cascade, specificity and cascade layers

"Why is my style not applying?" is the most common CSS question in any team, and
interviewers use it to separate people who add `!important` until it works from people who
can explain which declaration wins and why. The model has more steps than specificity, and
cascade layers, added to every browser in 2022, changed how large codebases manage it.

## The order the browser uses

When several declarations set the same property on the same element, the browser compares
them in this order and stops at the first step that separates them:

1. **Origin and importance.** Browser defaults, your styles, and `!important` versions of
   each (plus animations and transitions, which have their own slots).
2. **Context.** For shadow DOM: styles from the outer page against a component's own.
3. **Style attribute.** Declarations in a `style=""` attribute beat stylesheet rules of the
   same origin and importance.
4. **Layers.** Which cascade layer the rule is in.
5. **Specificity.** How specific the selector is.
6. **Order of appearance.** The later declaration wins.

Most bugs live in steps 4–6, but steps 1 and 3 explain the surprises: an inline
`style="color: red"` loses to a stylesheet `color: blue !important`, because importance is
compared before anything else.

For normal declarations, author styles beat browser defaults. For `!important`, the order
of origins reverses, so a user's `!important` accessibility stylesheet beats yours. The same
inversion applies to layers, as you will see below.

## Specificity, properly

Specificity is three separate counts, compared left to right, never added into one number:

| Column | Counts | Example |
| --- | --- | --- |
| A | id selectors | `#main` |
| B | classes, attributes, pseudo-classes | `.card`, `[type="email"]`, `:hover` |
| C | type selectors and pseudo-elements | `a`, `li`, `::before` |

`*`, combinators and `:where()` add nothing.

```css
#main a            { color: blue; } /* (1,0,1) */
.nav .link.active  { color: red;  } /* (0,3,0) — loses: column A decides */
```

No number of classes beats one id. The functional pseudo-classes are where people get
caught:

| Selector | Specificity rule | Result |
| --- | --- | --- |
| `:is(#a, .b) p` | most specific argument | (1,0,1), even when `.b` matched |
| `:not(#intro)` | most specific argument | (1,0,0) |
| `:has(> img)` | most specific argument | (0,0,1) |
| `:where(#a, .b) p` | always zero | (0,0,1) |
| `:nth-child(2 of .row)` | pseudo-class plus its argument | (0,2,0) |

That makes `:where()` the tool for library defaults that should be trivially overridable:

```css
:where(.btn) { padding: 0.5rem 1rem; border-radius: 6px; } /* (0,0,0) */
.checkout .btn { padding: 1rem; }                          /* wins easily */
```

Native CSS nesting follows the same rule. A nested rule under `.a, #b` behaves like
`:is(.a, #b) .c`, so it carries id weight even when it matched through `.a`. Sass expanded
the same code into two separate selectors, so migrating a Sass file to native nesting can
change which rule wins.

## Inheritance is not the cascade

The cascade picks a value for properties that are *set* on an element. Inheritance only
supplies a value when nothing is set. That is why this surprises people:

```css
body   { font-family: Inter, sans-serif; }
button { /* the UA stylesheet sets font here */ }
```

Buttons and inputs get their `font` from the browser's own stylesheet, and any directly set
value beats an inherited one, however specific the parent's selector. Resets add
`font: inherit` to form controls for this reason.

The global keywords give you explicit control:

| Keyword | Meaning |
| --- | --- |
| `inherit` | take the parent's computed value |
| `initial` | the property's initial value from the spec (`color: initial` is usually black) |
| `unset` | `inherit` for inherited properties, `initial` otherwise |
| `revert` | roll back to the previous origin, usually the browser's default |
| `revert-layer` | roll back to the previous cascade layer |

## Cascade layers

Layers let you decide, up front, which *groups* of styles win, whatever their selectors.

```css
@layer reset, vendor, base, components, utilities;

@import url('datepicker.css') layer(vendor);

@layer base {
  a { color: var(--link); }
}
@layer components {
  .card a { color: inherit; }
}
@layer utilities {
  .text-danger { color: var(--danger); }
}
```

The rules:

- **The first mention fixes the order.** The `@layer` statement at the top declares it;
  later layers beat earlier ones for normal declarations, wherever their blocks appear.
- **Layer beats specificity.** `.text-danger` in `utilities` beats `#app .card a` in
  `components`. Specificity only matters between rules in the same layer.
- **Unlayered styles win.** Normal declarations outside any layer sit in an implicit last
  layer, so they beat every named layer.
- **`!important` reverses the order.** An important declaration in `reset` beats an
  important one in `utilities`. This lets a low layer lock something down deliberately.
- **Layers nest.** `@layer components.forms { … }` creates a sub-layer, ordered inside its
  parent.

### Taming third-party CSS

Importing a vendor stylesheet into a low layer is the cleanest fix for a library with long
selectors: every vendor rule now loses to your unlayered or higher-layer rules, with no
`!important` and no copying selectors. The reverse mistake is common too: putting *your*
code in a layer and leaving the vendor file unlayered hands the vendor the win.

Tailwind v4 uses layers this way itself (`theme`, `base`, `components`, `utilities`), which
is why utility classes beat component styles regardless of selector weight.

## When `!important` is legitimate

`!important` is a tool, not a crime. Reasonable uses:

- Utility classes that must always win, such as `.visually-hidden` or `[hidden] { display: none !important; }`,
  which stops a component's `display: flex` un-hiding an element with the `hidden`
  attribute.
- Overriding inline styles you cannot change, such as those a third-party widget writes.
- Honouring user preferences, such as disabling animations under
  `prefers-reduced-motion`.

Using it to win a specificity fight is the smell: the next person needs another
`!important`, and so on. Layers are the structural fix.

## A debugging routine

When a style does not apply:

1. **Inspect the element** in DevTools and find the property in the Styles pane. A struck
   through declaration lost the cascade; the winner is listed above it.
2. **Check the Computed pane.** It shows the final value and links to the winning rule; an
   inherited value is marked as such.
3. **Look for an invalid value.** A yellow warning triangle means the browser discarded the
   declaration. A `var()` that resolves to nonsense is subtler: it is "invalid at
   computed-value time" and behaves like `unset`, not like the previous rule.
4. **Check layers.** DevTools shows the layer beside each rule; a high-specificity rule in
   a lower layer will lose.
5. **Check that it is the right property.** `z-index` on a static element and
   `vertical-align` on a block are valid and simply do nothing.

The broader layout picture is in
[CSS layout and responsive design](css-layout-and-responsive.md), and the token side of
theming in [custom properties and theming](css-custom-properties-theming.md).

## What you should be able to answer

- In what order does the browser decide between competing declarations, and where do
  `!important` and inline styles fit?
- Why does one id selector beat any number of classes, and what specificity do `:is()`,
  `:not()` and `:where()` have?
- What do `inherit`, `initial`, `unset` and `revert` each do?
- How do cascade layers change the cascade, and why do unlayered styles win?
- How would you stop a third-party stylesheet overriding your components without
  `!important`?
- When is `!important` a reasonable choice?
