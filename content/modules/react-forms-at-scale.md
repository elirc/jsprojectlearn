# Forms at scale in React

A login form is easy. A 40-field order editor with repeating line items,
server-side validation, an unsaved-changes warning and screen-reader-friendly
errors is where CRUD apps actually live. Interviewers use forms to test state
design, validation, API contracts and accessibility in one question, so it pays
to have a clear model of each layer.

## Controlled, uncontrolled, and why it matters at scale

A **controlled** input stores its value in React state and re-renders on every
keystroke. An **uncontrolled** input keeps its value in the DOM, and you read it
when needed (from a ref, or from `FormData` on submit).

For a handful of fields the difference is invisible. For a large form where
all values live in one `useState` object at the top, every keystroke re-renders
the whole form, and each field re-renders with it. That is why the popular form
libraries, React Hook Form above all, register inputs as uncontrolled by
default and subscribe components only to the values they need.

| Approach | Good for | Cost |
|---|---|---|
| `useState` per form | Small forms, simple rules | Whole-form re-renders; validation wiring by hand |
| Uncontrolled + `FormData` + React 19 actions | Forms that submit and show a server result | Less control over live validation |
| React Hook Form + schema | Large forms, dynamic fields, rich client validation | A library and its API to learn |

## One schema, two places

Validation must run on the server, because anyone can call your API directly.
Client validation exists for fast feedback. Writing the rules twice guarantees
they drift, so define them once as a schema, run it in the form, and run the
same schema (or one generated from the same source) in the API:

```ts
import { z } from 'zod';

export const orderSchema = z.object({
  customerEmail: z.email('Enter a valid email address'),
  notes: z.string().trim().max(500, 'Keep notes under 500 characters'),
  lines: z
    .array(
      z.object({
        sku: z.string().trim().min(1, 'Choose a product'),
        quantity: z.coerce.number().int().min(1, 'At least 1'),
      }),
    )
    .min(1, 'Add at least one line'),
});

export type OrderInput = z.infer<typeof orderSchema>;
```

`z.coerce.number()` matters: every input value is a string, even for
`type="number"`. Be aware that it coerces an empty string to `0`, so a
"required number" needs an explicit check for empty input. Parse, do not
cast: the schema turns strings into typed values at the boundary, as
[runtime validation in TypeScript](typescript-runtime-validation.md) explains.
When the backend is ASP.NET Core, the same rules live in data annotations or
FluentValidation instead, and the client schema mirrors them.

## React Hook Form with a resolver

```tsx
const {
  register, control, handleSubmit, setError, reset,
  formState: { errors, isSubmitting, isDirty },
} = useForm<OrderInput>({
  resolver: zodResolver(orderSchema),
  mode: 'onTouched',
  defaultValues: { customerEmail: '', notes: '', lines: [{ sku: '', quantity: 1 }] },
});

<form onSubmit={handleSubmit(save)} noValidate>
  <label htmlFor="email">Customer email</label>
  <input id="email" type="email" {...register('customerEmail')}
         aria-invalid={!!errors.customerEmail} aria-describedby="email-error" />
  <p id="email-error">{errors.customerEmail?.message}</p>
</form>
```

Points worth saying in an interview:

- **`register`** wires `name`, `ref`, `onChange` and `onBlur` to an
  uncontrolled input. For components that do not expose a ref to a native
  input (a date picker, a custom select), use `Controller`.
- **`mode: 'onTouched'`** validates a field first on blur, then on every
  change once it has been touched. That avoids shouting at people mid-typing
  while still clearing errors as soon as they are fixed.
- **`handleSubmit`** runs validation and only calls `save` with parsed,
  typed data. `isSubmitting` stays true while an async `save` runs, which
  gives you double-submit protection for free.
- **Reading values**: `watch` re-renders the form's root component whenever the
  value changes; `useWatch` in a child component limits the re-render to that
  child. Use it for live totals and conditional fields.

## Repeating rows with field arrays

Order lines, addresses and contacts are arrays of sub-forms:

```tsx
const { fields, append, remove } = useFieldArray({ control, name: 'lines' });

{fields.map((field, index) => (
  <fieldset key={field.id}>
    <legend>Line {index + 1}</legend>
    <input {...register(`lines.${index}.sku`)} aria-label="Product code" />
    <input type="number" {...register(`lines.${index}.quantity`)} aria-label="Quantity" />
    <button type="button" onClick={() => remove(index)}>Remove line {index + 1}</button>
  </fieldset>
))}
<button type="button" onClick={() => append({ sku: '', quantity: 1 })}>Add line</button>
```

Use `field.id` as the key, never the index: the library generates a stable id
per row, so removing row one does not shift typed values into the wrong
inputs. Note `type="button"` on the row buttons; a button in a form defaults to
`type="submit"`, and "Remove" would submit the order.

## Server errors mapped to fields

Client validation cannot know that an email is already taken or a SKU is
discontinued. The API answers with a 400 or 422 and an
[RFC 9457](rest-api-design.md) problem details body:

```json
{
  "type": "https://example.com/problems/validation",
  "title": "One or more fields are invalid",
  "status": 422,
  "errors": { "customerEmail": ["No customer has this email"], "lines[0].sku": ["Discontinued"] }
}
```

Map it back to the fields so the user sees each message where it belongs:

```ts
async function save(data: OrderInput) {
  const res = await fetch('/api/orders', { method: 'POST', body: JSON.stringify(data),
    headers: { 'Content-Type': 'application/json' } });
  if (res.status === 400 || res.status === 422) {
    const problem = await res.json();
    for (const [key, messages] of Object.entries(problem.errors ?? {})) {
      const name = key.replace(/\[(\d+)\]/g, '.$1');           // lines[0].sku -> lines.0.sku
      setError(name as any, { message: (messages as string[])[0] });
    }
    return;
  }
  if (!res.ok) { setError('root.server', { message: 'Could not save. Try again.' }); return; }
  reset(data);                                                  // new baseline: form is no longer dirty
}
```

Agree the error key format with the backend team; key casing and array
notation differ between stacks. Errors that belong to no field (a conflict, a
permissions failure) go in a form-level `root` error shown above the submit
button.

## React 19 actions for simpler forms

For forms whose job is "submit, then show the server's answer", React 19's
actions may be enough without a library:

```tsx
const [state, formAction, isPending] = useActionState(async (_prev: State, formData: FormData) => {
  // A flat form: Object.fromEntries cannot express nested arrays like order lines
  const parsed = customerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { errors: z.flattenError(parsed.error).fieldErrors };
  return await createCustomer(parsed.data);
}, { errors: {} });

<form action={formAction}>...</form>
```

After a successful action React resets uncontrolled fields, so return the
submitted values in `state` and use them as `defaultValue` if you need to keep
them on error. Libraries still win for live validation, field arrays and dirty
tracking. [Modern React](modern-react.md) covers `useActionState` and
`useFormStatus` in detail.

## Dirty state and unsaved changes

A field is **dirty** when its value differs from the default. Track it to:

- warn before leaving with unsaved changes,
- enable "Save" only when something changed (and keep it discoverable),
- send only changed fields in a `PATCH`.

Leaving happens two ways, and each needs its own guard: in-app navigation
(React Router's `useBlocker`, see [React Router v7 concepts](react-router-v7-concepts.md))
and closing or reloading the tab (a `beforeunload` listener, registered only
while `isDirty`). When editing loaded data, call `reset(serverData)` when the
data arrives so the loaded values become the baseline; otherwise every field
looks dirty or the form shows stale values.

## Accessible errors

- Label every input with `<label htmlFor>`; placeholders are not labels.
- Connect each message with `aria-describedby` and set `aria-invalid`.
- On a failed submit, move focus to the first invalid field (React Hook Form
  does this with `shouldFocusError`, on by default), or to an error summary
  with links to each field for long forms.
- Group radios and related fields in `<fieldset>` with a `<legend>`.
- Say what to do, not only what is wrong: "Enter a date after today", not
  "Invalid date".

[HTML semantics and forms](html-semantics-and-forms.md) and
[accessible forms and errors](accessible-forms-and-errors.md) cover the platform
side, and [react/43](../../react/43-form-validation/) and
[react/44](../../react/44-async-submit/) are the hands-on projects.

## What you should be able to answer

- Why do form libraries register inputs as uncontrolled, and when does that matter?
- How do you keep client and server validation rules from drifting apart?
- Why must field-array rows use a generated id as their key?
- How do you display a server's 422 validation errors next to the right fields?
- How would you warn users about unsaved changes, covering both in-app navigation and closing the tab?
- What makes a form's error messages accessible?
