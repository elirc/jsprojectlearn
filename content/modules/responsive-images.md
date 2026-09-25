# Responsive images

Images are usually the heaviest thing on a page, and a single `<img src="hero.jpg">` sends
the same 2,400-pixel file to a phone on 4G and a desktop on fibre. The platform has had the
fix for years (`srcset`, `sizes` and `<picture>`), but most developers only half understand
it. Interviewers ask about it because the mechanism is precise and the mistakes are
expensive: the wrong `sizes` value can quietly triple the bytes you download.

## Three different problems

Keep these apart; each has its own tool.

| Problem | Example | Tool |
| --- | --- | --- |
| Fixed-size image, different screen densities | a 120×40 logo on 1× and 3× screens | `srcset` with `x` descriptors |
| Variable-size image, many layouts | a product photo that is full width on phones, a third of the page on desktop | `srcset` with `w` descriptors, plus `sizes` |
| Different image at different sizes | a wide landscape hero on desktop, a tight portrait crop on phones | `<picture>` with `<source media>` |
| Newer formats with a fallback | AVIF, then WebP, then JPEG | `<picture>` with `<source type>` |

The first two are **resolution switching**: the candidates are the same picture at
different sizes, and the browser is free to choose. The third is **art direction**: the
images differ, and the browser must obey your conditions.

## Density descriptors for fixed-size images

```html
<img src="logo-120.png"
     srcset="logo-120.png 1x, logo-240.png 2x, logo-360.png 3x"
     width="120" height="40" alt="Acme">
```

The browser picks by device pixel ratio, and it may pick a lower density on a slow or
metered connection. `src` is the fallback and the 1× candidate.

## Width descriptors and `sizes`

For images whose rendered width depends on the layout, tell the browser how wide each file
is, and how wide the image will be displayed:

```html
<img
  src="shoe-800.jpg"
  srcset="shoe-400.jpg 400w, shoe-800.jpg 800w, shoe-1200.jpg 1200w, shoe-1600.jpg 1600w"
  sizes="(min-width: 1200px) 380px, (min-width: 700px) 50vw, 100vw"
  width="1600" height="1200"
  alt="Red trail running shoe, side view">
```

Why `sizes` is needed: the browser chooses a file while parsing the HTML, long before CSS
layout, so it cannot measure the slot. `sizes` is your promise about the slot width.

How the browser uses it:

1. Walk the `sizes` list and take the **first** entry whose media condition matches (the
   last entry has no condition and is the default).
2. Multiply that slot width by the device pixel ratio.
3. Pick a candidate at least that wide (browsers may pick smaller on a poor connection, or
   reuse a larger one already in the cache).

On a 390px-wide phone at 3×, the slot is `100vw` = 390px, so it needs about 1,170 physical
pixels and picks `shoe-1200.jpg`. On a 1440px laptop at 2×, the slot is 380px, so 760
pixels, and it picks `shoe-800.jpg`.

Two mistakes to spot in review:

- **No `sizes` at all.** The default is `100vw`, so an image shown in a 300px sidebar on a
  1440px screen downloads a file fit for 1440px or more.
- **Conditions in the wrong order.** `sizes="(min-width: 600px) 50vw, (min-width: 1000px)
  33vw, 100vw"` never reaches the second entry, because anything at least 1000px wide already
  matched the first. List conditions from widest to narrowest when using `min-width`.

For lazy-loaded images, `sizes="auto"` lets the browser use the real layout width, since it
does not fetch until layout is known. Support is not universal yet, so include a fallback
list after it: `sizes="auto, (min-width: 700px) 50vw, 100vw"`.

## Art direction with `<picture>`

```html
<picture>
  <source media="(width < 600px)" srcset="hero-portrait-600.jpg 600w, hero-portrait-1200.jpg 1200w" sizes="100vw">
  <source media="(width >= 600px)" srcset="hero-wide-1200.jpg 1200w, hero-wide-2400.jpg 2400w" sizes="100vw">
  <img src="hero-wide-1200.jpg" width="2400" height="1000" alt="Our team at the spring meetup">
</picture>
```

The browser uses the first `<source>` whose `media` and `type` match; each source can still
carry its own `srcset` and `sizes` for resolution switching within that crop. The `<img>` is
required: it is the element that actually renders, it carries `alt`, `width`, `height`,
`loading` and styling, and it is the fallback when no source matches.

Hiding one `<img>` with `display: none` in a media query is not art direction: the hidden
image is usually still downloaded.

## Modern formats

```html
<picture>
  <source type="image/avif" srcset="chart.avif">
  <source type="image/webp" srcset="chart.webp">
  <img src="chart.png" width="800" height="450" alt="Monthly revenue, rising from £12k to £19k">
</picture>
```

Order matters: the first supported `type` wins, so put the most efficient format first.
AVIF and WebP are both supported in every current browser, so for new work the JPEG or PNG
fallback mostly serves email clients and very old devices. Many teams skip `<picture>` for
formats entirely and let an image CDN negotiate the format from the `Accept` header.

## Reserve the space

Always give `<img>` its intrinsic `width` and `height` attributes, even when CSS makes it
fluid:

```css
img { max-width: 100%; height: auto; }
```

The browser uses the attributes' ratio to reserve the right box before the file arrives, so
text does not jump when the image loads. For CSS-sized boxes, `aspect-ratio` does the same
job. Layout shift and its metric are covered in
[what the browser does with a URL](browser-rendering-and-network.md).

## Fitting images into boxes

| Need | CSS |
| --- | --- |
| Fill a fixed box, cropping the excess (avatars, cards) | `object-fit: cover` |
| Show the whole image, letterboxed | `object-fit: contain` |
| Choose which part survives the crop | `object-position: top` or `30% 20%` |
| Fixed shape for a fluid box | `aspect-ratio: 4 / 3` |
| Remove the gap under an inline image | `display: block` |

## Loading behaviour

- `loading="lazy"` defers off-screen images until the user scrolls near them. Never lazy-load
  the main above-the-fold image; it delays the most important paint.
- `fetchpriority="high"` on the hero image tells the browser to fetch it before other images.
- `decoding="async"` lets the browser decode large images off the critical path.

How these affect loading metrics is a performance topic; the markup habits above are the
part you should apply by default.

## Alt text is part of the markup

`alt` describes the image's purpose in context: "Red trail running shoe, side view" for a
product, `alt=""` for purely decorative images so screen readers skip them. It belongs on
the `<img>` inside `<picture>`, never on `<source>`. More in
[accessibility fundamentals](accessibility-fundamentals.md) and
[HTML that does the work for you](html-semantics-and-forms.md).

Take the [infinite gallery](../../73-infinite-gallery/) project and give every thumbnail a
`srcset` with three widths and an accurate `sizes` for its grid. Then open DevTools, filter
the Network panel to images, and confirm the file chosen changes as you resize the window
and switch device emulation between 1× and 3×.

## What you should be able to answer

- When do you use `x` descriptors, when `w` descriptors, and when `<picture>`?
- Why does the browser need `sizes`, and what happens if you leave it out?
- Walk through how the browser picks a file from `srcset` for a given viewport and pixel
  ratio.
- What is the difference between resolution switching and art direction?
- How do you serve AVIF with a JPEG fallback, and why does the order of `<source>` elements
  matter?
- Why should every `<img>` have `width` and `height` attributes even when CSS resizes it?
