# Accessible forms and error handling

Every CRUD app is mostly forms, and forms are where accessibility audits find
the most failures: errors nobody can hear, hints nobody can find, and submit
buttons that silently do nothing. Interviewers ask "how do you show validation
errors?" to see whether your answer works for someone who can't see the red
border. [The HTML guide](html-semantics-and-forms.md) covers labels, input types
and native validation; this guide covers what happens when things go wrong.

## The WCAG criteria that apply

| Criterion | Level | In practice |
|---|---|---|
| 1.3.1 Info and Relationships | A | Labels, groups and errors are programmatically linked, not just near each other |
| 1.3.5 Identify Input Purpose | AA | Personal-data fields have the right `autocomplete` |
| 3.3.1 Error Identification | A | The field in error is identified and the error is described in text |
| 3.3.2 Labels or Instructions | A | Required fields and formats are stated before the user gets it wrong |
| 3.3.3 Error Suggestion | AA | Say how to fix it, not only that it's wrong |
| 3.3.4 Error Prevention | AA | Legal or financial submissions can be reviewed, corrected or reversed |
| 3.3.7 Redundant Entry | A (new in 2.2) | Don't make users re-type what they already gave you in the same process |
| 3.3.8 Accessible Authentication (Minimum) | AA (new in 2.2) | No cognitive test to log in: allow paste and password managers |
| 4.1.3 Status Messages | AA | "Saved" and "3 errors" are announced without moving focus |

The two new 2.2 criteria catch real code. Blocking paste on a "confirm
password" or one-time-code field fails 3.3.8. Asking for the delivery address
again on the billing step, with no "same as delivery" option, fails 3.3.7.

## Before the error: instructions and required fields

Most errors are prevented by telling people the rules up front.

```html
<label for="ref">Order reference <span aria-hidden="true">*</span></label>
<p id="ref-hint" class="hint">Format ABC-1234, printed on your receipt</p>
<input id="ref" name="ref" required aria-describedby="ref-hint"
       autocomplete="off" spellcheck="false">
```

- **Mark required fields visibly and programmatically.** `required` is
  announced as "required"; the asterisk is for sighted users, so hide it from
  screen readers to avoid "star" being read. Explain the asterisk at the top of
  the form, or write "(required)" or "(optional)" in the label.
- **Put hints in text linked with `aria-describedby`**, not in a placeholder.
  The description is read after the label and role.
- **Keep the label visible** while the user types. Floating labels that shrink
  into the border are fine if they remain readable and meet contrast.

## Showing a field error

A field in error needs three things: a text message, a programmatic link to
the input, and an invalid state.

```html
<input id="email" name="email" type="email" required
       aria-invalid="true" aria-describedby="email-hint email-err">
<p id="email-hint">We'll send the receipt here</p>
<p id="email-err" class="error">
  <svg aria-hidden="true">…</svg> Enter an email address, like name@example.com
</p>
```

- `aria-invalid="true"` makes the screen reader say "invalid entry".
- `aria-describedby` accepts several ids; the error is read with the hint.
- The message says **what to do**, not just "Invalid". "Enter a date in the
  future" beats "Date error".
- The visual treatment uses more than colour: an icon and text, not only a red
  border (1.4.1 Use of Color).
- Only set `aria-invalid` after validation has run. Rendering every empty
  required field as invalid on page load is noise.

In React, derive the attributes from the error state so they can't drift:

```tsx
type FieldProps = { id: string; label: string; error?: string }
  & React.InputHTMLAttributes<HTMLInputElement>;

function Field({ id, label, error, ...input }: FieldProps) {
  const errId = `${id}-err`;
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-invalid={error ? true : undefined}
        aria-describedby={error ? errId : undefined} {...input} />
      {error && <p id={errId} className="error">{error}</p>}
    </div>
  );
}
```

## When to validate

Timing matters more than most teams think.

| Timing | Good for | Problem |
|---|---|---|
| On every keystroke | Password strength meters, character counts | Errors appear before the user has finished typing |
| On blur | Format checks on a single field | Can trap users who tab through to explore the form |
| On submit | Everything, always | The only timing that never nags |
| On blur, then on input once invalid | Most fields | Needs a little state |

The pattern that works for most forms: validate on submit; after a field has
been shown as invalid, re-validate it as the user types so the error clears
the moment it's fixed. `:user-invalid` in CSS follows similar rules for
styling. Never move focus during typing or on blur; only on submit.

## On submit: the error summary

When submit fails, users need to know that it failed, how many problems there
are, and how to get to each one. The robust pattern, used by the GOV.UK design
system and others, is an error summary at the top of the form that receives
focus.

```html
<div role="alert" tabindex="-1" id="error-summary">
  <h2>There are 2 problems</h2>
  <ul>
    <li><a href="#email">Enter an email address, like name@example.com</a></li>
    <li><a href="#qty">Quantity must be between 1 and 99</a></li>
  </ul>
</div>
```

Render it, then call `focus()` on it. Screen readers read the heading and list,
and each link jumps to its field. Also prefix `document.title` with "Error: "
so users who navigate by page title know the submit failed.

For short forms (a login or a single search field), moving focus straight to
the first invalid field is enough. Pick one approach per product and apply it
consistently.

Don't disable the submit button until the form is valid. A disabled button
can't be focused, gives no reason why, and leaves users guessing which field
is wrong. Let them submit and show the errors.

## Server errors and async submission

Client checks are UX; the server decides. Map server errors back to fields
so they look the same as client errors. An RFC 9457 problem details response
with a per-field `errors` object makes this mechanical:

```ts
const res = await fetch('/api/orders', { method: 'POST', body: data });
if (res.status === 422) {
  const problem = await res.json(); // { errors: { email: ['Already registered'] } }
  setErrors(problem.errors);
  summaryRef.current?.focus();
}
```

While the request is in flight:

- Keep focus on the submit button, show a pending state
  (`aria-disabled="true"` plus a spinner with text, rather than `disabled`,
  which drops focus in some browsers) and ignore repeat clicks.
- On success, announce it. Either navigate and move focus to the new page's
  `<h1>`, or write "Order saved" into a `role="status"` region that already
  exists in the DOM.
- On a network failure, say so in text and keep the user's input. Clearing a
  long form after a failed request is the worst possible outcome.

React 19's `useActionState` and `useFormStatus` give you the pending flag and
the returned error state; [react/44](../../react/44-async-submit/) and
[react/43](../../react/43-form-validation/) build these flows.

## Groups, custom controls and long forms

- **Radio buttons and checkbox groups** need `<fieldset>` and `<legend>`, and
  a group error belongs on the fieldset: `aria-describedby` on the
  `<fieldset>` element.
- **Custom selects and date pickers** must expose the same name, role, value
  and invalid state as native ones. Prefer native `<select>` and
  `<input type="date">` unless the design truly can't live with them; if not,
  use a tested headless component ([the ARIA guide](aria-patterns-safe-use.md)).
- **Multi-step forms** should show progress in text ("Step 2 of 4: Delivery"),
  move focus to the step heading on each change, keep entered data when going
  back, and offer a review step before anything financial (3.3.4).
- **Session timeouts** must warn before expiring and let the user extend
  (2.2.1 Timing Adjustable). Losing a half-completed form to a silent timeout
  is a common complaint in audits.

## Testing a form in five minutes

1. Submit it empty with the keyboard. Does focus go somewhere useful? Is every
   error in text?
2. Tab through with a screen reader running. Is each field's label, hint,
   required state and error read? ([screen-reader testing](screen-reader-testing.md))
3. Zoom to 200%. Are the errors still next to their fields?
4. In a component test, assert on accessible names and descriptions, which
   Testing Library supports directly:

```ts
await user.click(screen.getByRole('button', { name: 'Place order' }));
expect(screen.getByRole('textbox', { name: /email/i }))
  .toHaveAccessibleDescription(/enter an email address/i);
```

## What you should be able to answer

- What three things does a field error need so a screen-reader user gets it?
- Why is a disabled submit button a poor way to signal an invalid form?
- When should validation run, and when should it move focus?
- How do you map server-side validation errors onto fields?
- What do WCAG 2.2's Redundant Entry and Accessible Authentication require of
  a checkout or login form?
- How would you announce a successful save without navigating?
