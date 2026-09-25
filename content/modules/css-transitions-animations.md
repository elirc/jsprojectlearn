# CSS transitions and animations

Motion in a CRUD app is small: a menu that fades in, a toast that slides up, a row that
highlights after saving, a skeleton that shimmers. Doing it well means knowing which tool
fits, which properties are cheap to animate, and how to animate things that appear from
`display: none`, which until recently needed JavaScript. Interviewers ask about it to see
whether you can add polish without adding jank or ignoring users who turn motion off.

## Transitions versus keyframe animations

| | Transition | Keyframe animation |
| --- | --- | --- |
| Triggered by | a property value changing (class, `:hover`, state) | being applied (class added, element rendered) |
| Steps | start → end | any number of keyframes |
| Repeats | no | `animation-iteration-count`, including `infinite` |
| Good for | hover, open/close, state changes | loaders, attention cues, entrance effects |

```css
.menu {
  opacity: 0;
  translate: 0 -4px;
  transition: opacity 150ms ease-out, translate 150ms ease-out;
}
.menu.open { opacity: 1; translate: 0 0; }

@keyframes shimmer {
  from { background-position: -200px 0; }
  to   { background-position: 200px 0; }
}
.skeleton { animation: shimmer 1.2s linear infinite; }
```

## Where the `transition` declaration goes

A transition uses the `transition` value of the state being **entered**. Put it only on
`:hover` and the effect animates in but snaps back when the pointer leaves, because the base
rule has no transition:

```css
.btn { background: white; transition: background-color 200ms; } /* both directions */
.btn:hover { background: gold; }
```

List the properties you mean. `transition: all` animates whatever happens to change,
including `width` or `padding` from a responsive rule or colours during a theme switch,
which causes surprise motion and layout work.

## What is cheap to animate

The browser turns styles into pixels in stages: style, layout, paint, composite. Animating
a property re-runs every stage from the one it affects:

| Property changed | Work per frame | Verdict |
| --- | --- | --- |
| `transform` (`translate`, `scale`, `rotate`), `opacity` | composite only | smooth, even on slow devices |
| `color`, `background-color`, `box-shadow` | paint + composite | fine for small elements |
| `width`, `height`, `top`, `left`, `margin`, `padding` | layout + paint + composite | avoid for motion |

So move things with `translate`, not `left`; grow them with `scale`, not `width`; fade with
`opacity`. `will-change: transform` hints that an element will animate so the browser can
promote it to its own layer in advance, but each layer costs memory: apply it to the few
elements that need it, never to `*`. The full pipeline is in
[what the browser does with a URL](browser-rendering-and-network.md).

## Timing and easing

- `ease` (the default) speeds up then slows down, which is why a spinner using the default
  visibly lurches each turn; spinners need `linear`.
- `ease-out` feels responsive for things entering; `ease-in` suits things leaving.
- `cubic-bezier()` and `linear()` let you define custom curves, including springy ones.
- Durations of 150–300ms suit most UI state changes. Longer feels sluggish.

Useful animation properties:

| Property | Use |
| --- | --- |
| `animation-fill-mode: forwards` | keep the final keyframe after the animation ends |
| `animation-fill-mode: backwards` | apply the first keyframe during an `animation-delay` |
| negative `animation-delay` | start part-way through; stagger skeleton rows without waiting |
| `animation-direction: alternate` | play forwards, then backwards |
| `animation-play-state: paused` | freeze, for example while off-screen |

A toast that slides in and then jumps back to its hidden position is missing
`forwards`, or better, its end state should be its normal style so no fill mode is needed.

## Animating in from `display: none`

Popovers, dialogs and newly rendered elements start from `display: none` or from not
existing. There is no "before" style to transition from, so the element simply appears at
its end state. Two modern features fix this without JavaScript:

```css
[popover] {
  opacity: 1;
  translate: 0 0;
  transition:
    opacity 200ms,
    translate 200ms,
    display 200ms allow-discrete,
    overlay 200ms allow-discrete;
}

@starting-style {
  [popover]:popover-open { opacity: 0; translate: 0 8px; }
}

[popover]:not(:popover-open) { opacity: 0; translate: 0 8px; }
```

- `@starting-style` supplies the styles to transition **from** the first time the element
  is rendered, giving you the fade-in.
- `transition-behavior: allow-discrete` (the `allow-discrete` keyword above) lets `display`
  and `overlay` change at the end of the exit transition rather than instantly, giving you
  the fade-out. `overlay` keeps a top-layer element in the top layer until it finishes.

Before these existed, the pattern was: add the element, force a reflow or wait a frame,
then add the "open" class; on close, listen for `transitionend` and only then remove it.
You will still see that in older codebases.

## Animating to `height: auto`

`height` cannot transition to `auto` by default, because the browser cannot interpolate
between a length and a keyword. Options, from best supported:

1. **Grid rows.** Transition `grid-template-rows` from `0fr` to `1fr` on a one-row grid,
   with `min-height: 0` on the child. Works in every current browser.
2. **`interpolate-size: allow-keywords`** on `:root`, which lets `height: auto` animate
   directly. Newer and not in every engine yet, so treat it as an enhancement.
3. **`max-height` hacks**, which need a guessed maximum and give uneven timing. Avoid.
4. **Measure in JavaScript**, or use the FLIP technique for reordering lists.

## Transition and animation events

JavaScript can react when motion ends:

```js
panel.addEventListener('transitionend', (e) => {
  if (e.propertyName !== 'opacity') return; // fires once per transitioned property
  panel.remove();
});
```

`transitionend` fires once **per property**, so a transition on `opacity` and `translate`
fires twice. It does not fire if the transition is interrupted or the element is removed
first; listen for `transitioncancel` too, or use `el.getAnimations()` and await each
animation's `finished` promise. For animations written in JavaScript, the Web Animations
API (`el.animate(keyframes, options)`) gives you the same engine with promises and
playback control.

## Respect reduced motion

Some users get dizzy or nauseous from motion and turn it down at the OS level. Honour it:

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

A blanket rule like this is a safe default; better still, swap large movements (slides,
parallax, zooms) for simple fades rather than removing all feedback. Durations of `0.01ms`
rather than `0` keep `transitionend` and `animationend` firing, so code that waits for them
does not hang. This is one of the legitimate uses of `!important`.

## Practice

The [FLIP animation project](../../react/57-flip-animation/) animates list reordering with
transforms, and the [drag-and-drop kanban](../../react/56-drag-drop-kanban/) is a good place
to add enter and exit transitions. Grid track animation is covered in the
[grid deep dive](css-grid-deep-dive.md), and custom-property animation with `@property` in
[custom properties and theming](css-custom-properties-theming.md).

## What you should be able to answer

- When would you use a transition and when a keyframe animation?
- Why does a transition declared only on `:hover` animate in but not out?
- Which properties are cheap to animate, and why is animating `left` or `width` janky?
- How do you animate an element in from `display: none` without JavaScript?
- How do you animate an accordion to its content height?
- How should your CSS respond to `prefers-reduced-motion`, and why use `0.01ms` rather than
  `0`?
