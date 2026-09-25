# Colour, contrast and motion

Contrast failures are the single most common WCAG failure on the web, year
after year, and they are among the easiest to prevent. Motion and colour-only
signals are close behind. You rarely choose the brand palette, but you do write
the CSS, build the design tokens and review the PR, so interviewers expect you
to know the ratios, what they apply to and how to honour user preferences.

## The contrast requirements

WCAG 2.2 AA sets minimum contrast ratios between foreground and background.

| What | Ratio | Criterion |
|---|---|---|
| Normal text | 4.5:1 | 1.4.3 Contrast (Minimum) |
| Large text: 24 CSS px, or about 18.7 px bold | 3:1 | 1.4.3 |
| UI component boundaries (input borders, toggle tracks) | 3:1 against adjacent colours | 1.4.11 Non-text Contrast |
| Meaningful graphics (chart lines, status icons) | 3:1 | 1.4.11 |
| Focus indicator | 3:1 against what's around it | 1.4.11 (plus 2.4.13 at AAA) |
| Text at AAA | 7:1, or 4.5:1 for large | 1.4.6 Contrast (Enhanced) |

Exemptions: disabled controls, pure decoration, logos and text that is part of
a photo. Placeholder text is **not** exempt, which is one more reason not to
use it as a label: the typical light grey placeholder fails 4.5:1.

The ratio is `(L1 + 0.05) / (L2 + 0.05)`, where L is the relative luminance of
the lighter and darker colour. You never calculate it by hand; you need to know
it ranges from 1:1 (same colour) to 21:1 (black on white), and that mid-greys
fail more often than you'd guess. `#767676` on white is about 4.5:1, the
lightest grey that passes for body text; `#999999` is only about 2.8:1.

A newer model, APCA, is being explored for WCAG 3 and handles dark mode and
font weight better, but it is not a WCAG 2.2 requirement. Contracts and audits
test against the 2.2 ratios.

## Checking contrast in practice

- **DevTools colour picker.** Click any colour swatch for a text rule in Chrome
  or Firefox DevTools; it shows the ratio against the computed background, with
  AA and AAA lines drawn on the picker.
- **axe and Lighthouse** flag text contrast automatically, but only for plain
  backgrounds. Text over images, gradients or semi-transparent overlays is
  reported as "needs review", so check those by hand.
- **Design tokens.** Put the check where the colours are defined. If your
  palette is tokens, a unit test can assert that every foreground/background
  pairing you use meets 4.5:1, and the problem never reaches a component.

```ts
// Relative luminance per WCAG, for sRGB hex colours
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
ratio('#767676', '#ffffff'); // 4.54
```

## Dark mode and themes

Every theme must pass independently. Common dark-mode failures:

- **Brand colours reused as-is.** A blue link that passes on white often fails
  on near-black. Define a separate token per theme rather than one colour.
- **Pure white on pure black** passes easily but causes halation for some
  readers with astigmatism; off-white on dark grey is kinder and still passes.
- **Borders that vanish.** Input borders tuned for a light background drop
  below 3:1 on dark surfaces.
- **Shadows as the only separation.** Shadows barely show on dark backgrounds;
  cards need a border or a lighter surface colour.

Use `color-scheme: light dark` so native controls and scrollbars follow the
theme, and test both themes in your contrast checks.

## Never colour alone

WCAG 1.4.1 (Use of Color) says colour must not be the only way information is
conveyed. About one in twelve men has some form of colour-vision deficiency,
and red/green confusion is the most common.

| Colour-only design | Add |
|---|---|
| Red border on an invalid field | An error message and icon |
| Links shown only by colour in body text | Underline (or 3:1 contrast with surrounding text plus a non-colour cue on hover and focus) |
| Green and red status dots | Text labels or distinct icons: "Paid", "Overdue" |
| Line chart series in different colours | Direct labels, markers or dash patterns |
| Required fields shown in a different colour | "(required)" in the label |

Chrome DevTools can emulate deuteranopia, protanopia, tritanopia and blurred
vision (Rendering panel, "Emulate vision deficiencies"), which makes the
problem visible to the whole team in seconds.

## Forced colours and high-contrast modes

Windows' contrast themes replace your colours with the user's chosen palette,
and CSS can detect it with `@media (forced-colors: active)`. In this mode
background images, box shadows and most custom colours are removed. Things that
break:

- Icons drawn with `background-image` disappear. Use inline SVG with
  `fill: currentColor`.
- Focus rings made only from `box-shadow` vanish. Use `outline`, even a
  transparent one (`outline: 2px solid transparent`), which forced-colours mode
  makes visible.
- Custom checkboxes built from styled `<div>`s lose their borders.

```css
@media (forced-colors: active) {
  .badge { border: 1px solid CanvasText; }   /* system colour keywords */
}
```

Use `forced-color-adjust: none` only on small elements where you truly need
your colours, such as a colour swatch picker.

## Motion and animation

Motion can cause nausea, dizziness and migraines for people with vestibular
disorders, and flashing content can trigger seizures.

| Requirement | Level | Meaning |
|---|---|---|
| 2.3.1 Three Flashes or Below Threshold | A | Nothing flashes more than three times per second |
| 2.2.2 Pause, Stop, Hide | A | Anything that moves, blinks or scrolls automatically for over 5 s can be paused |
| 2.3.3 Animation from Interactions | AAA | Motion triggered by interaction can be disabled |

The AAA criterion is not formally required at AA, but honouring
`prefers-reduced-motion` is expected practice and cheap:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

A blanket reset like this is a safe baseline. Better still, design the reduced
version deliberately: replace large slides, parallax and zooms with a fade,
keep small feedback such as a button's colour change, and never remove
information that was only shown through animation. In JavaScript-driven
animation, check `matchMedia('(prefers-reduced-motion: reduce)').matches`
before starting it; libraries such as Motion expose a hook for this.

Carousels need a visible pause button, must not auto-advance while focused or
hovered, and must be keyboard operable. Autoplaying background videos need a
pause control too.

## Text spacing, zoom and reflow

Visual accessibility also covers how your layout copes with bigger text.

- **1.4.4 Resize Text:** usable at 200% browser zoom. Use `rem` for font sizes
  so users' default font size is respected.
- **1.4.10 Reflow:** no horizontal scrolling at 320 CSS px wide (equivalent to
  400% zoom on a 1280 px screen), except for content like data tables and maps.
- **1.4.12 Text Spacing:** no content lost when users increase line height to
  1.5, paragraph spacing to 2× and letter spacing to 0.12em. Fixed heights on
  text containers are the usual culprit.

[The CSS layout guide](css-layout-and-responsive.md) covers the responsive
techniques that make these pass.

## What you should be able to answer

- What are the AA contrast ratios for body text, large text and UI components?
- Which things are exempt from contrast rules, and is placeholder text one of
  them?
- Give three ways to show an invalid field that don't rely on colour.
- How does `prefers-reduced-motion` work, and what should a reduced-motion
  version keep?
- What breaks in Windows' forced-colours mode, and how do you keep focus rings
  visible there?
- Why does a palette that passes in light mode often fail in dark mode?
