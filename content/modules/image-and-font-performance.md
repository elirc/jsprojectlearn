# Image and font performance

Images are the heaviest part of most pages, and the LCP element on most pages
is an image. Fonts are small by comparison but sit on the critical path for
text and cause layout shifts when they swap. Getting both right is mostly
markup, not engineering, which is why interviewers expect a confident answer to
"how would you load this hero image?" and "why does the text jump when the page
loads?".

## Image formats in 2026

| Format | Use for | Notes |
|---|---|---|
| AVIF | Photos and complex images | Usually smallest; slower to encode; supports alpha and HDR |
| WebP | Photos, a safe modern default | Universally supported; faster to encode than AVIF |
| JPEG | Fallback for photos | Use progressive encoding and a modern encoder such as MozJPEG |
| PNG | Screenshots needing lossless, rare | Often beaten by lossless WebP |
| SVG | Icons, logos, illustrations | Scales perfectly; minify it; inline only when small |
| MP4/WebM video | Anything animated | Replace GIFs; often 5 to 20 times smaller |

You can offer several formats with `<picture>`, and the browser takes the first
it supports:

```html
<picture>
  <source type="image/avif" srcset="/p/sofa-800.avif 800w, /p/sofa-1600.avif 1600w">
  <source type="image/webp" srcset="/p/sofa-800.webp 800w, /p/sofa-1600.webp 1600w">
  <img src="/p/sofa-800.jpg" srcset="/p/sofa-800.jpg 800w, /p/sofa-1600.jpg 1600w"
       sizes="(min-width: 60rem) 50vw, 100vw" width="1600" height="1067" alt="Grey three-seat sofa">
</picture>
```

An **image CDN** (Cloudinary, imgix, Cloudflare Images, or your framework's
image component) does this from one URL: it negotiates the format from the
request's `Accept` header, resizes on the fly and caches the result. For a
product with user-uploaded images, that's usually cheaper than building a
pipeline.

## Serving the right size

Most wasted image bytes come from sending a 2,000-pixel image to a 400-pixel
slot.

- **`srcset` with `w` descriptors** lists available widths.
- **`sizes`** tells the browser how wide the image will be displayed, before
  CSS has loaded. Without it, the browser assumes `100vw`, which is wrong for
  anything in a column, grid or sidebar.
- The browser multiplies the slot width by the device pixel ratio and picks the
  smallest candidate that covers it. Capping at 2x is usually fine; 3x images
  on phones cost a lot for little visible gain.

`sizes="auto"` with `loading="lazy"` lets the browser use the laid-out width
instead of your estimate, but only for lazy images, since it needs layout
first. Browser support is still arriving, so keep an explicit fallback list
after it.

## Loading priority: lazy, eager, and high

| Image | Markup |
|---|---|
| The LCP image (hero, main product photo) | `fetchpriority="high"`, never `loading="lazy"` |
| Other images in the first viewport | Default (eager) |
| Below-the-fold images | `loading="lazy"` |
| Carousel slides after the first | `loading="lazy"`, or `fetchpriority="low"` if they must load |

Lazy-loading the LCP image is one of the most common LCP regressions, often
introduced by a component that applies `loading="lazy"` to every image. The
browser can't start the download until layout confirms the image is in the
viewport.

Make sure the LCP image is **discoverable in the HTML**. An `<img>` in the
server's response is found by the preload scanner within milliseconds; a CSS
`background-image` or an image rendered by client-side JavaScript isn't found
until much later. If you can't change that, preload it, using `imagesrcset`
and `imagesizes` so the preload chooses the same file the element will:

```html
<link rel="preload" as="image" fetchpriority="high"
      imagesrcset="/hero-800.avif 800w, /hero-1600.avif 1600w" imagesizes="100vw">
```

## Reserving space

Every `<img>` and `<iframe>` should have `width` and `height` attributes (or
CSS `aspect-ratio`), so the browser reserves the right box before the image
arrives and nothing below it shifts. With `img { max-width: 100%; height: auto;
}` the image stays responsive; the attributes supply the ratio, not the
rendered size. For art-directed `<picture>` sources with different ratios, put
`width` and `height` on each `<source>`.

## Font loading: what happens by default

A web font referenced in CSS isn't requested until the browser has the CSS,
has built the render tree and has found text that uses it. That makes fonts
late-discovered by nature. While the font loads, text is either invisible
(FOIT, "flash of invisible text") or shown in a fallback (FOUT, "flash of
unstyled text"), controlled by `font-display`:

| `font-display` | Behaviour | Best for |
|---|---|---|
| `block` | Invisible for up to about 3 s, then fallback, swap when loaded | Icon fonts (better: use SVG) |
| `swap` | Fallback immediately, swap whenever the font arrives | Brand fonts that must appear |
| `fallback` | Invisible about 100 ms, fallback, swap only within about 3 s | A balance |
| `optional` | Invisible about 100 ms; if not ready, keep the fallback for this view | Body text where stability matters most |

`swap` is good for LCP but can cause a layout shift when the font arrives.
`optional` avoids the shift and still caches the font for the next page.

## Making fonts smaller and earlier

- **Use WOFF2 only.** Every current browser supports it; drop TTF, EOT and
  WOFF fallbacks.
- **Subset.** Remove glyphs you don't use, and split by script with
  `unicode-range` so a Latin-only page never downloads Cyrillic.
- **Fewer files.** Each weight and style is a file. A variable font can replace
  four or more static files when you use several weights.
- **Self-host.** Browsers partition their HTTP cache by site, so a Google Fonts
  file cached on another site isn't reused on yours. Self-hosting removes the
  extra connection to a third-party origin and gives you control of caching.
- **Preload the one or two fonts used above the fold**, with `crossorigin`
  even for same-origin files, because fonts are fetched in CORS mode:

```html
<link rel="preload" href="/fonts/inter-latin-var.woff2" as="font" type="font/woff2" crossorigin>
```

Preloading every weight defeats the purpose; each preload competes with the
LCP image.

## Stopping the font swap from shifting the layout

When the fallback and web font have different metrics, text reflows on swap and
the page shifts. Override the fallback's metrics so it takes up the same space:

```css
@font-face {
  font-family: 'Inter Fallback';
  src: local('Arial');
  size-adjust: 107%;
  ascent-override: 90%;
  descent-override: 22%;
  line-gap-override: 0%;
}
body { font-family: 'Inter', 'Inter Fallback', sans-serif; }
```

The exact values depend on the font pair; tools such as Fontaine or Capsize
calculate them, and Next.js's font module does it automatically. The result is
that swapping fonts changes letter shapes but not line breaks, so CLS from fonts
disappears.

The simplest option of all is a system font stack (`font-family: system-ui,
sans-serif`) for UI text: zero bytes, zero shift, and it looks native on every
platform. Many dashboards and admin apps don't need a web font at all.

## Checking your work

- **Network panel**: filter by Img and Font; sort by size; check the
  `Priority` column shows High for the LCP image.
- **Lighthouse**: "Properly size images", "Serve images in modern formats",
  and "LCP request discovery" insights point at specific files.
- **Performance panel**: the LCP marker shows which element it was, and the
  Layout Shifts track shows which elements moved and when.
- **Field data**: the `web-vitals` attribution build reports the LCP element
  and its URL, so you can confirm the fix for real users
  ([measuring performance](measuring-performance-rum-vs-lab.md)).

Projects to practise on: [js/73](../../73-infinite-gallery/) loads a large
image grid, and [react/54](../../react/54-list-virtualization/) keeps a long
list cheap to render.

## What you should be able to answer

- How would you mark up a responsive hero image that is the LCP element?
- What does `sizes` do, and what happens without it?
- Why is `loading="lazy"` on the LCP image a regression?
- Compare `font-display: swap` and `optional`: which metric does each help?
- Why should you preload a font with `crossorigin`, and why only one or two?
- How do you stop a web font swap from causing layout shift?
