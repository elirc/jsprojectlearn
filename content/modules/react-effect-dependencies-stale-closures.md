# Effect dependencies and stale closures

"Why is my counter stuck at 1?" and "why does this effect run on every render?"
are the same question from opposite ends. Both come from how JavaScript closures
meet React renders. Interviewers use them to check that you understand closures
properly, and that you fix dependency problems without lying to the linter.

## Every render has its own values

A component is a function, and each render is a separate call. Every value
declared in it (props, state, handlers, objects) belongs to that call:

```jsx
function Counter() {
  const [count, setCount] = useState(0);
  function showLater() {
    setTimeout(() => alert(count), 3000);
  }
  // ...
}
```

Click "show later" at `count = 0`, then increment twice. The alert says 0. The
timeout closed over the `count` from the render where `showLater` was created.
State is a snapshot per render, not a live variable. That is not a bug in React;
it is ordinary JavaScript closure behaviour, and it is what makes rendering
predictable.

A **stale closure** is a function that outlives its render and keeps reading that
render's values after newer ones exist.

## What dependencies are

The dependency array lists the **reactive values** an effect (or `useMemo` or
`useCallback`) reads: props, state, and anything declared in the component body
that is derived from them. React compares each entry with the previous render's
using `Object.is`, and re-runs the effect if any differ.

```jsx
useEffect(() => {
  const id = setInterval(() => setCount(count + 1), 1000);
  return () => clearInterval(id);
}, []); // count is read but not listed
```

With `[]`, the interval is created once, in the first render, and its callback
reads `count = 0` forever. Every tick sets the count to 1. The lint rule
`react-hooks/exhaustive-deps` flags the missing `count`.

## Four ways to fix a stale closure

**1. Remove the dependency with an updater.** If the value is only needed to
compute the next state, let React pass it in:

```jsx
const id = setInterval(() => setCount((c) => c + 1), 1000);
// deps can honestly stay []
```

**2. List it and accept the re-run.** `[count]` is correct but tears down and
restarts the interval on every tick, which resets its timing. Fine for some
effects, wrong for timers.

**3. Read the latest value from a ref.** The classic pre-19.2 pattern for
callbacks that live a long time:

```jsx
const onMessageRef = useRef(onMessage);
useEffect(() => {
  onMessageRef.current = onMessage;
});
useEffect(() => {
  return socket.subscribe((msg) => onMessageRef.current(msg));
}, [socket]);
```

**4. Use `useEffectEvent` (React 19.2).** It packages pattern 3: a function that
always sees the latest props and state, but is not reactive, so it does not
belong in the dependency array.

```jsx
const onConnected = useEffectEvent(() => {
  showNotification('Connected', theme);
});

useEffect(() => {
  const connection = createConnection(roomId);
  connection.on('connected', () => onConnected());
  connection.connect();
  return () => connection.disconnect();
}, [roomId]); // theme is read, but changing it does not reconnect
```

The rule of thumb: values that should restart the synchronisation (`roomId`) stay
reactive; values that are only read when something happens (`theme`) move into an
effect event. Effect events may only be called from inside effects, never during
render or from a child's props.

## Objects and functions re-run effects

`Object.is` compares objects and functions by reference, and a component body
creates new ones every render:

```jsx
const options = { roomId, serverUrl };
useEffect(() => {
  const c = createConnection(options);
  c.connect();
  return () => c.disconnect();
}, [options]); // new object every render: reconnects every render
```

Fixes, in order of preference:

| Fix | Example |
| --- | --- |
| Create it inside the effect | `const options = { roomId, serverUrl }` inside the callback, deps `[roomId, serverUrl]` |
| Depend on primitives | `[user.id]` instead of `[user]` when the parent recreates `user` |
| Move static values out of the component | a module-level constant has no identity changes |
| Memoise at the source | `useMemo` for the object, `useCallback` for the function |

The same applies to functions: a `load()` declared in the body and listed as a
dependency re-runs the effect every render. If only the effect uses it, move it
inside. If others share it, wrap it in `useCallback` with its own honest deps.

`[JSON.stringify(filters)]` works as a last resort (strings compare by value), but
you pay to serialise on every render and key order matters.

## What does not need to be listed

- **State setters and `dispatch`** have stable identities, so the linter does not
  ask for them.
- **Refs** from `useRef` are stable objects. But `ref.current` in a dependency
  array is useless: mutating a ref does not cause a render, so the new value is
  never compared.
- **Module-level values and imports** are not reactive.
- **Effect events** from `useEffectEvent` are deliberately non-reactive.

## Never lie to the linter

`// eslint-disable-next-line react-hooks/exhaustive-deps` above an effect almost
always hides a stale closure that will surface later, when the value it omitted
changes and the effect keeps using the old one. When the linter asks for a
dependency you do not want, change the code so that dependency is not needed:
use an updater, move the object inside, depend on a primitive, or move the
non-reactive part into an effect event. The same goes for the React Compiler:
it relies on the same rules to memoise safely.

## Stale closures outside effects

The same bug appears wherever a function outlives its render:

```jsx
const save = useCallback(() => {
  api.save(draft); // always the first draft
}, []);
```

```jsx
async function onDelete(id) {
  setItems(items.filter((i) => i.id !== id));
  await api.remove(id);
  if (items.length === 0) showEmpty(); // items is this render's snapshot
}
```

In the second case, compute the next value once and use it for both the setter
and the check. In event handlers that update several times, use the updater
form: `setCount(count + 1)` twice adds one; `setCount((c) => c + 1)` twice adds
two. Practise with [react/11-stale-closures](../../react/11-stale-closures/),
[react/17-effect-deps](../../react/17-effect-deps/) and
[react/25-useinterval](../../react/25-useinterval/).

## Diagnosing from symptoms

| Symptom | Likely cause |
| --- | --- |
| Value stuck at the first render's value | Missing dependency, or a callback created once |
| Effect runs after every render | Object or function dependency recreated each render |
| Effect loops forever | Effect sets state it depends on |
| Timer resets or never fires | A frequently changing dependency restarts it |
| Effect never re-runs after a ref changes | `ref.current` listed as a dependency |

## What you should be able to answer

- What is a stale closure, and why is it normal JavaScript rather than a React
  bug?
- An interval with `[]` shows 1 forever. Give two fixes and the trade-off of
  adding `count` to the dependencies.
- Why does an object created in the component body make an effect run every
  render, and what are the fixes?
- Which values never need to be listed as dependencies?
- What problem does `useEffectEvent` solve, and where may it be called?
- Why is disabling the exhaustive-deps rule usually the wrong fix?
