# HTML that does the work for you

CRUD is forms and tables. Get the HTML right and you get keyboard support,
autofill, validation and screen-reader output without writing a line of
JavaScript. Get it wrong and you spend a sprint rebuilding what the browser
already had. Most "React form bugs" are HTML bugs: an accidental submit, a
missing `name`, an input with no label.

## Semantics is behaviour, not decoration

Choosing an element is choosing a behaviour. Compare:

```html
<div class="btn" onclick="save()">Save</div>
<button type="button" onclick="save()">Save</button>
```

The `<div>` is a bug. It is not in the tab order, so keyboard users cannot reach
it. It does not fire on Enter or Space. A screen reader announces it as plain
text, not "Save, button". It cannot be `disabled`. It does not take part in form
submission. Adding all of that back means `tabindex="0"`, `role="button"`, a key
handler for two keys and `aria-disabled`, and you will still miss something.

The rule: reach for the native element first. Only build a custom widget when no
element does the job, and read [the accessibility guide](accessibility-fundamentals.md)
before you start.

## Page structure

Screen-reader users navigate by landmarks and headings the way you skim by
scanning bold text. Give them something to skim:

```html
<header>…logo, account menu…</header>
<nav aria-label="Main">…</nav>
<main>
  <h1>Orders</h1>
  <section aria-labelledby="open-h">
    <h2 id="open-h">Open orders</h2>
  </section>
</main>
<footer>…</footer>
```

- One `<main>` per page, and one `<h1>` that names the page.
- Headings describe structure, not font size. Don't skip from `h2` to `h4`
  because `h4` looked right; restyle the `h3`.
- In a single-page app, update `document.title` on every route change. It is
  the first thing a screen reader announces on a new page.

## Links vs buttons

A **link** goes somewhere. A **button** does something.

| | `<a href>` | `<button>` |
|---|---|---|
| Purpose | Navigation to a URL | An action on this page |
| Keyboard | Enter | Enter and Space |
| Middle-click, "open in new tab", copy link | Yes | No |
| Followed by search engines | Yes | No |

`<a onClick>` with no `href` is not focusable and is not a link. A `<button>`
that calls `navigate('/orders/7')` loses middle-click and the URL preview. If it
changes the URL, it is a link; your router's `<Link>` renders a real `<a>`.

## Anatomy of a form

```html
<form method="post" action="/orders">
  <label for="email">Email</label>
  <input id="email" name="email" type="email" autocomplete="email" required>

  <fieldset>
    <legend>Delivery</legend>
    <label><input type="radio" name="delivery" value="standard" checked> Standard</label>
    <label><input type="radio" name="delivery" value="express"> Express</label>
  </fieldset>

  <button>Place order</button>
</form>
```

- **`<label for>`** (or a wrapping `<label>`) gives the input its accessible
  name and a bigger click target. A placeholder is not a label: it disappears
  as soon as the user types, it usually fails contrast, and it is not reliably
  announced as the field's name.
- **`name`** is what the field is submitted as. No `name`, no value in the
  request and no value in `FormData`.
- **`fieldset`/`legend`** group related controls. Radio groups need them, or a
  screen reader announces "Express, radio button" without saying express *what*.
- **`FormData`** reads the whole form in one call, which is why an uncontrolled
  form is often simpler than a `useState` per field:

```js
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.currentTarget));
  // { email: '…', delivery: 'standard' }
});
```

## Input types, `inputmode` and `autocomplete`

The right attributes give mobile users the right keyboard and let password
managers do their job.

| Field | Markup |
|---|---|
| Email | `type="email" autocomplete="email"` |
| Phone | `type="tel" autocomplete="tel"` |
| Login password | `type="password" autocomplete="current-password"` |
| Sign-up password | `type="password" autocomplete="new-password"` |
| One-time code | `inputmode="numeric" autocomplete="one-time-code"` |
| Postcode | `autocomplete="postal-code"` |
| Card number | `type="text" inputmode="numeric" autocomplete="cc-number"` |
| Account ID, reference | `type="text" inputmode="numeric"` |

Don't use `type="number"` for things that are digits but not quantities. It
accepts `e` and `-`, shows spinner arrows, treats `007` as the number 7, and in
some browsers changes value when the user scrolls over it. Use it for quantities; use
`inputmode="numeric"` for identifiers.

## Submit behaviour

Three facts cause most form bugs:

1. **A `<button>` inside a form defaults to `type="submit"`.** Your "Add another
   line" button submits the form. Every non-submit button needs `type="button"`.
2. **Pressing Enter in a text input submits the form** (implicit submission)
   through the first submit button. That is a feature: keep it, and don't wire
   saving to a button's `onClick`. Handle the form's `submit` event.
3. **A form works without JavaScript.** `method` and `action` send a real
   request. That is progressive enhancement: the page still works before your
   bundle loads, or if it fails to.

React 19 builds on the same model. `<form action={fn}>` passes the form's
`FormData` to your function and resets uncontrolled fields when it succeeds.
[The modern React guide](modern-react.md) covers actions and `useActionState`.

## Native constraint validation

The browser validates before the `submit` event fires:

```html
<input name="qty" type="number" min="1" max="99" required>
<input name="sku" pattern="[A-Z]{3}-[0-9]{4}" title="Format: ABC-1234">
```

For rules the attributes can't express, set a message and the field becomes
invalid; an empty string makes it valid again:

```js
confirmField.setCustomValidity(confirmField.value === pw.value ? '' : 'Passwords do not match');
```

Style errors with **`:user-invalid`**, not `:invalid`. `:invalid` matches an
empty required field on page load, so the form is red before the user has
touched it; `:user-invalid` only applies after the user has interacted with the
field. It is Baseline.

Native error bubbles look different in every browser and can't be styled. The
common production pattern: put `novalidate` on the form, keep the attributes
(they still drive `form.checkValidity()` and each field's `validity` object),
and render your own messages linked with `aria-describedby` and `aria-invalid`.
Either way, the server validates again. Client validation is UX, never security.

## Tables for tabular data

Orders, users, invoices: if it has rows and columns, it is a `<table>`.

```html
<table>
  <caption>Open orders</caption>
  <thead><tr><th scope="col">Order</th><th scope="col">Total</th></tr></thead>
  <tbody><tr><th scope="row">#1042</th><td>£84.00</td></tr></tbody>
</table>
```

In a real table a screen reader announces "Total, column 2, £84.00" and lets
the user move cell by cell. A grid of `<div>`s styled to look like a table gives
none of that; the user hears a flat stream of text. Keep the table element and
use CSS for layout; [the CSS guide](css-layout-and-responsive.md) covers making
it usable on a phone.

## Modern built-ins

These are all Baseline and replace code you used to write yourself:

- **`<dialog>`** with `showModal()` puts the dialog in the top layer (no
  `z-index` battles), makes the rest of the page inert, moves focus inside, and
  closes on Esc. `<form method="dialog">` closes it on submit.
  [react/52](../../react/52-accessible-modal-focus/) builds the same behaviour
  by hand, which is worth doing once so you know what the element saves you.
- **`popover`** gives menus and tooltips light dismiss (click outside, Esc) and
  top-layer rendering with no JavaScript:
  `<button popovertarget="m">Menu</button><div id="m" popover>…</div>`.
- **`inert`** removes a subtree from focus and the accessibility tree. Use it on
  the page behind a custom drawer.
- **`loading="lazy"`** on below-the-fold images and iframes.
- **`width` and `height` on `<img>`** let the browser reserve space before the
  image loads, which prevents layout shift (CLS).

## What you should be able to answer

- Why is a clickable `<div>` a bug, and what exactly do you lose?
- What happens when you press Enter in a form input, and how do you stop a
  secondary button submitting the form?
- Why isn't a placeholder a substitute for a label?
- How do native validation and your own validation messages coexist?
- When is something a link and when is it a button?
- What does `showModal()` give you that a positioned `<div>` doesn't?
