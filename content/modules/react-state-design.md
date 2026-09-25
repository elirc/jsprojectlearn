# Designing component state

Most React bugs that survive code review are not hook bugs; they are state
design bugs: two variables that disagree, a copy of a prop that went stale, an
object that was edited in place. Interviewers probe this with "what state does
this screen need?", and the strong answer is always the smallest set that cannot
contradict itself.

## Start from the minimum

For each value on screen, ask three questions in order:

1. Does it stay the same forever? Then it is a constant, not state.
2. Is it passed in from a parent? Then it is a prop.
3. Can it be computed from other state or props? Then it is derived: compute it
   during render.

Whatever is left is state. A searchable user list shows this well:

```jsx
// Too much state: results and count can drift from query and users
const [query, setQuery] = useState('');
const [results, setResults] = useState(users);
const [count, setCount] = useState(users.length);

// Minimal: one piece of state, everything else derived
const [query, setQuery] = useState('');
const results = users.filter((u) => u.name.toLowerCase().includes(query.toLowerCase()));
const count = results.length;
```

The minimal version has no effect to keep things in sync and no render where
`count` is wrong. If filtering is genuinely expensive, wrap it in `useMemo`; that
is a cache, not a second source of truth.

## Avoid contradictions: model status, not flags

Three booleans allow eight combinations, and only four make sense:

```jsx
const [isLoading, setIsLoading] = useState(false);
const [isError, setIsError] = useState(false);
const [data, setData] = useState(null);
// What does isLoading && isError mean?
```

Replace them with one value that can only be in a legal state:

```ts
type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'success'; data: Order[] };
```

Every transition now sets the whole state at once, so "loading and error" cannot
happen. In TypeScript the `status` field narrows the union, so `data` is only
reachable when it exists (see
[discriminated unions](typescript-discriminated-unions.md)). When transitions get
involved, this is where [`useReducer`](react-usereducer.md) starts to pay off.

## Store ids, not copies

Selecting an item is a classic trap:

```jsx
const [items, setItems] = useState(initial);
const [selected, setSelected] = useState(null); // a copy of an item
```

Rename the selected item and the list shows the new name while the details panel
still shows the old one, because `selected` is a separate object. Store the
identity instead and derive the object:

```jsx
const [selectedId, setSelectedId] = useState(null);
const selected = items.find((i) => i.id === selectedId);
```

The same rule applies to "edited copies" of server data: keep the server's
version in one place and the user's unsaved edits in another, not a merged copy
that can drift.

## Where state lives: colocate, then lift

Put state in the lowest component that needs it. A dropdown's `open` flag belongs
in the dropdown, not in a page-level store, because then only the dropdown
re-renders when it toggles, and it can be deleted with the component.

Lift state only when two components need the same value. Move it to their
closest common parent, pass the value down and a callback up:

```jsx
function Accordion({ panels }) {
  const [openId, setOpenId] = useState(null);
  return panels.map((p) => (
    <Panel key={p.id} {...p} isOpen={p.id === openId} onOpen={() => setOpenId(p.id)} />
  ));
}
```

One `openId` makes "two panels open at once" impossible, which is a stronger
guarantee than two panels each holding a boolean. Practise both moves in
[react/08-lifting-state](../../react/08-lifting-state/) and
[react/29-state-colocation](../../react/29-state-colocation/).

| Symptom | Likely design fix |
| --- | --- |
| An effect exists only to copy one state into another | Derive it during render |
| Two siblings must stay in sync | Lift state to the parent |
| A page re-renders on every keystroke in one widget | Move state down into the widget |
| Deeply nested props passed through five layers | Composition (`children`) first, then context |

## Never mutate: copy the path to the change

React notices changes by reference (`Object.is`), so edits must produce new
objects along the path that changed and reuse everything else:

```jsx
// Update one field of one item in an array
setTodos((todos) => todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));

// Nested object
setUser((u) => ({ ...u, address: { ...u.address, city: 'Leeds' } }));

// Insert, remove and sort without mutating (ES2023)
setItems((xs) => xs.toSpliced(i, 0, item));
setItems((xs) => xs.filter((x) => x.id !== id));
const sorted = items.toSorted((a, b) => a.name.localeCompare(b.name));
```

Two tempting shortcuts both fail. `const next = [...todos]; next[0].done = true`
copies the array but mutates the shared object inside it. `structuredClone(state)`
then mutating works, but gives every unchanged item a new identity, so every
memoised row re-renders. If nested updates get painful, flatten the state
(normalise by id) or use Immer, which lets you write mutations against a draft
and produces structural sharing for you.

## When a prop may seed state

Copying a prop into state is usually a bug: `useState(props.color)` reads the prop
once and ignores later changes. It is correct only when the prop is explicitly an
**initial** value, and naming says so:

```jsx
function ColorPicker({ initialColor }) {
  const [color, setColor] = useState(initialColor);
  // ...
}
```

If the component should restart when the source changes, give it a `key`. If it
should always follow the parent, it should not own the state at all: make it
controlled with `value` and `onChange` (see
[controlled vs uncontrolled](react-controlled-vs-uncontrolled.md)).

## Group what changes together

Split unrelated values into separate `useState` calls; group values that always
change together into one object. A pointer position is `{ x, y }`, not two
setters called side by side. A form with many fields can be one object updated
with a computed key:

```jsx
const onChange = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
```

Remember the `useState` setter replaces the value; it never merges like the old
class `this.setState`.

## What you should be able to answer

- Walk through deciding which values on a search screen are state, props,
  constants and derived values.
- Why is a `status` field better than `isLoading` and `isError` booleans?
- Why store `selectedId` rather than the selected object?
- When do you lift state up, and when do you push it down?
- Show a non-mutating update that toggles one item in an array, and explain why
  spreading the array alone is not enough.
- When is `useState(props.something)` correct, and what should you do instead
  when it is not?
