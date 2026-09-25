# Rendering, reconciliation and component identity

"What happens when state changes?" sounds like a warm-up, but the follow-ups
decide mid-level React interviews: why an input kept the wrong text, why a
`memo` did nothing, why a form reset itself. All of them come back to one model:
what a render is, and how React decides which component instance is which.

## What triggers a render

A component renders for exactly three reasons:

| Trigger | Example |
| --- | --- |
| Its own state changed | `setOpen(true)` in a click handler |
| Its parent rendered | the parent's state changed, so every child is called again |
| A context it reads changed | the provider above it received a new `value` |

Props changing is not a separate trigger: props only change because the parent
rendered. That second row is the one people forget. By default, when a parent
renders, React calls every child component again, whether or not their props
changed. `memo` opts a component out of that when its props are shallowly equal.

"Render" means React **calls your function** to get a new description of the UI.
It does not mean the DOM is rebuilt.

## Render, then commit

An update runs in two phases:

1. **Render.** React calls the components that need updating and gets back
   elements: plain objects such as `{ type: 'button', props: { children: 'Save' } }`.
   Nothing touches the DOM. This phase must be pure, because React may call your
   component more than once, throw the result away, or (in a transition) pause
   and restart.
2. **Commit.** React compares the new elements with the previous ones and applies
   the minimum set of DOM changes. Then it attaches refs and runs layout effects;
   ordinary effects run after the browser paints.

This is why focus and scroll position survive a re-render: the `<input>` node is
patched, not replaced. It is also why the render body must not mutate props,
push to module-level arrays or start requests. Under `<StrictMode>` React calls
components twice in development specifically to catch that (see
[StrictMode](react-strict-mode.md)).

## When React bails out

Setting state to a value that is `Object.is`-equal to the current one skips the
update. That rule has two sides:

```jsx
// Mutation: same reference, so React sees "no change" and skips the render
todos.push(newTodo);
setTodos(todos);

// A fresh array always renders, even with identical contents
setTodos([...todos]);
```

`Object.is` compares references for objects, so immutable updates are not a
style preference; they are how React notices a change. Copy only the path to
the change (`{ ...user, address: { ...user.address, city } }`) and share the
rest, so memoised children holding unchanged objects can skip their renders.

## How reconciliation matches elements

Comparing two arbitrary trees is O(n³), so React uses two heuristics that make it
linear:

1. **Different type, different subtree.** If a `<div>` becomes a `<section>`, or
   `<Counter>` becomes `<Profile>`, React unmounts the old subtree (state and DOM)
   and mounts a new one.
2. **Same type at the same position, same instance.** React keeps the instance,
   and its state, and updates its props.

Position means position in the parent's children, and `false`, `null` and
`undefined` still occupy a slot. That is why this preserves `Form`'s state when
the banner appears:

```jsx
return (
  <div>
    {showBanner && <Banner />}
    <Form />
  </div>
);
```

`Form` is always the second child. The first slot flips between `false` and
`<Banner />`, which does not shift `Form`.

The same rule explains the surprising cases:

```jsx
// Same type, same position: ONE Counter, state kept when isAdmin flips
return isAdmin ? <Counter label="admin" /> : <Counter label="user" />;

// Different wrapper type: Counter remounts and its count resets
return fancy ? <section><Counter /></section> : <div><Counter /></div>;
```

## Keys are identity

In a list, position is not stable. Delete the first row and every later row moves
up one slot. Keys tell React which item is which:

```jsx
<ul>
  {todos.map((t) => (
    <TodoRow key={t.id} todo={t} />
  ))}
</ul>
```

With `key={t.id}`, deleting or sorting moves the existing rows, DOM and state
together. With `key={index}`, React matches by position: delete the first row
and the uncontrolled input text that belonged to it now shows in the row that
slid into its slot. Index keys are fine only for lists that never reorder,
filter or insert anywhere but the end.

Rules worth saying out loud in an interview:

- A key must be stable across renders and unique among **siblings**, not
  globally. Two different lists can both use ids 1, 2 and 3.
- Create ids when the data is created (`crypto.randomUUID()` when the user adds a
  todo), never in `map`. `key={Math.random()}` remounts every row on every render.
- Keys are consumed by React: `props.key` is `undefined` inside the component.
- A fragment in a list needs `<Fragment key={id}>`; the `<>` shorthand cannot
  take a key.

Practise this in [react/03-key-prop](../../react/03-key-prop/) and
[react/32-preserve-state](../../react/32-preserve-state/).

## Keys outside lists: resetting on purpose

Because a new key means a new identity, you can force a fresh instance:

```jsx
<EditProfile key={userId} userId={userId} />
```

When `userId` changes, the old form unmounts and a new one mounts with clean
state. This is the idiomatic answer to "reset all of a child's state when a prop
changes", and it beats an effect that calls five setters. See
[react/31-key-reset](../../react/31-key-reset/).

## Type identity: components defined inside components

React compares element **types** by reference. A component declared inside
another component's body is a new function on every render:

```jsx
function Table({ rows }) {
  function Row({ row }) { return <tr><td><input defaultValue={row.name} /></td></tr>; }
  return <tbody>{rows.map((r) => <Row key={r.id} row={r} />)}</tbody>;
}
```

Every render of `Table` produces a different `Row` type, so every row unmounts
and remounts: inputs lose focus and typed text. The same happens with
`const Row = memo(RowView)` inside the body, where the "optimisation" makes things
worse. Declare components, and call `memo` and `lazy`, at module level.

## Elements are descriptions, not instances

`const el = <Counter />` is an object. Rendering `{el}{el}` gives two independent
counters, because state lives at the tree position, not in the element. This is
also what makes the "children as props" pattern cheap: when `Layout` re-renders
because of its own state, the `children` element it received from its parent
is the same object as last time, so React can skip re-rendering that subtree.

## Rendering is not the expensive part

Most re-renders are cheap, and reaching for `memo` everywhere adds comparison
cost and noise. Measure with the React DevTools Profiler first; move state down
or pass JSX as children before memoising; and know that the React Compiler
now automates most of this (see [React 19 in practice](modern-react.md)).

## What you should be able to answer

- What are the three reasons a component re-renders, and why does "props
  changed" not appear in the list?
- What happens in the render phase versus the commit phase, and why must the
  render phase be pure?
- A `Counter` sits inside `<div>` in one branch of a ternary and `<section>` in
  the other. What happens to its state when the branch flips, and why?
- Describe the bug index keys cause when the first row of a list is deleted.
- How do you reset every piece of a child's state when a prop changes, without an
  effect?
- Why does declaring a component inside another component break its inputs?
