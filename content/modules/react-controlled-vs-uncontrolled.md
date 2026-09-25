# Controlled and uncontrolled inputs

Every CRUD screen is a form, and every React form makes the same choice per
field: does React own the value, or does the DOM? Interviewers ask for the
definition, then for the consequences: why an input will not accept typing, why
`reset()` does nothing, how to build a component that works both ways.

## The one-sentence definition

A **controlled** input's value comes from React state on every render; an
**uncontrolled** input keeps its own value in the DOM, and you read it when you
need it.

```jsx
// Controlled: state is the source of truth
const [email, setEmail] = useState('');
<input value={email} onChange={(e) => setEmail(e.target.value)} />

// Uncontrolled: the DOM is the source of truth
<input name="email" defaultValue="" />
```

After every change event React writes `value` back from state. That is why a
controlled input with `value` but no `onChange` is read-only (React warns), and
why a filter in `onChange` can reject keystrokes: if you do not update state,
React restores the old value.

```jsx
<input
  value={qty}
  onChange={(e) => {
    if (/^\d*$/.test(e.target.value)) setQty(e.target.value);
  }}
/>
```

## The prop pairs by input type

| Input | Controlled prop | Uncontrolled default | Read from the event |
| --- | --- | --- | --- |
| Text, email, textarea | `value` | `defaultValue` | `e.target.value` |
| Checkbox, radio | `checked` | `defaultChecked` | `e.target.checked` |
| Select | `value` on `<select>` | `defaultValue` on `<select>` | `e.target.value` |
| Multi-select | `value={array}` | `defaultValue={array}` | `e.target.selectedOptions` |
| File | not possible | not applicable | `e.target.files` |

Details that come up:

- A `<textarea>` takes `value`, not children. A `<select>` takes `value` on the
  select, not `selected` on an option.
- Checkboxes use `checked`. Binding `value={done}` and reading `e.target.value`
  gives you the string `"on"`, not a boolean.
- Every input value is a string. `<input type="number">` still gives `"12"`, so
  convert explicitly, and `type="date"` gives `"2026-09-24"` whatever the user's
  locale.
- File inputs are always uncontrolled: scripts may clear their value with
  `input.value = ''` but never set it. Clearing it is also how you let the user
  pick the same file twice.

## Switching between the two is a bug

React decides an input is controlled when `value` is not `undefined` or `null`.
If the value starts as `undefined` and later becomes a string, React warns that
"a component is changing an uncontrolled input to be controlled":

```jsx
const [form, setForm] = useState({});        // form.name is undefined
<input value={form.name} onChange={...} />   // uncontrolled first, controlled later
```

Initialise every field (`{ name: '' }`) or write `value={form.name ?? ''}`.
`value={null}` has the same problem, plus its own warning.

## Uncontrolled forms with FormData

For forms that only need values on submit, uncontrolled inputs are less code and
cause no re-render per keystroke:

```jsx
function onSubmit(e) {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.currentTarget));
  save(data); // { email: '...', plan: '...' }
}

<form onSubmit={onSubmit}>
  <input name="email" type="email" required />
  <select name="plan" defaultValue="free">...</select>
  <button>Save</button>
</form>
```

Use `e.currentTarget` (the form the handler is on), not `e.target`. Native
validation (`required`, `type="email"`, `min`) runs before `submit` fires, so an
invalid form never reaches your handler. Unchecked checkboxes are missing from
`FormData` entirely, so treat "absent" as `false`. In React 19 you can pass a
function to `<form action>` instead; see [React 19 in practice](modern-react.md)
for actions, `useActionState` and `useFormStatus`.

## Which to choose

| Need | Controlled | Uncontrolled |
| --- | --- | --- |
| Validate or format as the user types | Yes | Awkward |
| Enable Save only when the form is dirty | Easy | Needs extra tracking |
| One field depends on another (country, region) | Yes | Awkward |
| Values only needed on submit | Works | Simpler, fewer renders |
| Integrate a non-React widget | Hard | Natural |

Most form libraries (React Hook Form, for example) register inputs as
uncontrolled by default and subscribe to changes selectively, which is why they
stay fast on large forms. Controlled inputs are not slow in themselves; 80 of
them in one component that re-renders on every keystroke is.

## Resetting inputs

Resetting follows ownership:

- Controlled: set state back (`setForm(initial)`). Calling `form.reset()` changes
  the DOM, but React immediately restores the values from state.
- Uncontrolled: `formRef.current.reset()` restores each `defaultValue`. Changing
  `defaultValue` later does **not** update a mounted input; it is read once.
- Either: remount with a new `key`. `<EditUser key={user.id} user={user} />`
  gives a fresh form when a different user loads, which is the clean fix for
  "the form shows the previous record's values".

## Designing a component that supports both

Library components such as a `Toggle` or `Tabs` often accept both modes, with the
same naming as native inputs: `value` plus `onChange` for controlled,
`defaultValue` for uncontrolled.

```jsx
function Toggle({ checked, defaultChecked = false, onChange }) {
  const [internal, setInternal] = useState(defaultChecked);
  const isControlled = checked !== undefined;
  const on = isControlled ? checked : internal;

  function toggle() {
    if (!isControlled) setInternal(!on);
    onChange?.(!on);
  }
  return <button aria-pressed={on} onClick={toggle}>{on ? 'On' : 'Off'}</button>;
}
```

The rules that make this work:

- Decide the mode by whether the controlled prop is `undefined`, and do not let a
  component switch modes after mount.
- In controlled mode, never copy the prop into internal state; that creates two
  sources of truth that drift.
- Always call `onChange`, in both modes, so parents can observe changes.

Build one in [react/36-controlled-component-api](../../react/36-controlled-component-api/),
and see the form fundamentals in [react/07-controlled-inputs](../../react/07-controlled-inputs/).

## Common bugs, diagnosed

| Symptom | Cause |
| --- | --- |
| Typing does nothing | `value` without an `onChange` that updates state, or the parent's handler never sets the state it passes down |
| Caret jumps to the end | state updated asynchronously (after an `await`) instead of in `onChange` |
| `qty + 1` shows `"21"` | input values are strings |
| Form shows previous user's data | `defaultValue` read once; remount with `key` |
| Warning about switching modes | initial value `undefined` or `null` |

## What you should be able to answer

- Define controlled and uncontrolled inputs in one sentence each.
- Why can a file input never be controlled, and how do you clear one?
- What causes the "changing an uncontrolled input to be controlled" warning, and
  how do you fix it?
- When is an uncontrolled form with `FormData` the better choice?
- Why does `form.reset()` not clear a controlled form?
- How would you design a component that works both controlled and uncontrolled?
