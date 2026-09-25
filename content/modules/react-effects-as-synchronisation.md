# useEffect as synchronisation

Effects are where most React bugs live: fetch races, leaked listeners, infinite
loops, flashes of wrong data. Interviewers ask about them constantly, and the
answer that lands is a mental model, not a list of rules: an effect keeps
something outside React in step with what React is rendering.

## Synchronisation, not lifecycle

The old class model was "run this on mount, that on update, this on unmount".
Effects work differently. Each effect describes how to **start** syncing with an
external system for the current props and state, and how to **stop**:

```jsx
useEffect(() => {
  const connection = createConnection(serverUrl, roomId);
  connection.connect();
  return () => connection.disconnect();
}, [serverUrl, roomId]);
```

Read it as: "while this component shows `roomId`, be connected to that room".
React handles the timeline. On mount it runs setup. When `roomId` changes it runs
the old cleanup (disconnect from room "a") and then the new setup (connect to
room "b"). On unmount it runs the last cleanup. You never write "if the room
changed" logic.

"External system" means anything React does not manage: the network, a
WebSocket, `document.title`, `localStorage`, a timer, a browser API such as
`ResizeObserver`, or a non-React widget.

## Setup and cleanup must mirror each other

Whatever setup starts, cleanup stops:

| Setup | Cleanup |
| --- | --- |
| `addEventListener(type, handler)` | `removeEventListener(type, handler)` with the same function |
| `setInterval` / `setTimeout` | `clearInterval` / `clearTimeout` |
| `observer.observe(node)` | `observer.disconnect()` |
| `socket.connect()` | `socket.disconnect()` |
| `fetch` with a signal | `controller.abort()` |
| `const unsubscribe = store.subscribe(fn)` | `unsubscribe()` |

If the cleanup is missing, each re-run stacks another listener or timer, and they
outlive the component. `removeEventListener` matches by reference, so define the
handler once inside the effect and pass the same variable to both calls.

In development, [StrictMode](react-strict-mode.md) runs setup, cleanup, setup on
mount to prove the pair is symmetrical. If that breaks your feature, the
cleanup is what needs fixing.

## When an effect runs

- Effects run after React commits to the DOM, usually after the browser paints.
  The first frame always renders without anything the effect sets.
- Setting state in an effect costs an extra render. `useEffect(() =>
  setReady(true), [])` renders twice on mount.
- Children's effects run before their parent's; within a component, effects run
  in declaration order.
- Effects never run during server rendering. Browser-only APIs belong in effects
  or event handlers, not the render body.

If you must measure the DOM and adjust before the user sees anything (tooltip
positioning, scroll restoration), use `useLayoutEffect`, which runs before paint
and blocks it. Default to `useEffect`. The other built-in effect hooks are
covered in [the React 19 hooks toolkit](react-19-hooks-toolkit.md).

## You might not need an effect

The most useful effect skill is recognising code that should not be one. Ask why
the code runs: because the component is on screen (effect), or because the user
did something (event handler)?

| Situation | Instead of an effect |
| --- | --- |
| `fullName` from `first` and `last` | Compute during render |
| Filtered or sorted list | Compute during render, `useMemo` if expensive |
| POST when the user clicks Save | Call it in the click handler |
| Notify the parent when local state changes | Call `onChange` in the same handler |
| Reset all state when `userId` changes | `key={userId}` on the component |
| Adjust one piece of state when a prop changes | Compare with the previous prop during render, or derive it |
| Initialise the app once | Module-level code or a module flag |

An effect that sets state based on other state is the classic smell:

```jsx
// Two renders, one with a stale total, plus an effect to maintain
const [total, setTotal] = useState(0);
useEffect(() => setTotal(items.reduce((s, i) => s + i.price, 0)), [items]);

// One render, always correct
const total = items.reduce((s, i) => s + i.price, 0);
```

Practise telling them apart in [react/21-no-effect-needed](../../react/21-no-effect-needed/).

## Fetching in an effect, correctly

In production code, prefer a framework loader or a query library (see
[server and client state](server-and-client-state.md)). But you must still be able
to write a correct fetching effect, because interviewers ask for it:

```jsx
useEffect(() => {
  const controller = new AbortController();
  setStatus('loading');

  fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((data) => {
      setResults(data);
      setStatus('success');
    })
    .catch((e) => {
      if (e.name === 'AbortError') return; // our own cancellation
      setStatus('error');
    });

  return () => controller.abort();
}, [query]);
```

What each part handles:

- **Races.** Type "re" then "react" quickly. Without cleanup, the slower "re"
  response can arrive last and overwrite the results for "react". Aborting the
  previous request on every change prevents that.
- **Cancellation.** `abort()` actually stops the network request. An `ignore`
  flag (`let ignore = false` set to `true` in cleanup) also fixes the race, but
  the request still completes and uses bandwidth.
- **Aborts are rejections.** Aborting rejects with an `AbortError`; filter it out
  or every fast typist sees an error state.
- **HTTP errors.** `fetch` only rejects on network failure, so check `r.ok`.
- **Effects cannot be async.** An `async` effect returns a promise where React
  expects a cleanup function. Define an async function inside and call it.

See it built step by step in [react/19-fetch-race](../../react/19-fetch-race/)
and [react/20-fetch-status](../../react/20-fetch-status/).

## Subscriptions and events

For a browser event or a store, the effect is subscribe plus unsubscribe:

```jsx
useEffect(() => {
  function onKeyDown(e) {
    if (e.key === 'Escape') onClose();
  }
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}, [onClose]);
```

If the value you subscribe to must be read during render (online status, window
width, an external store), `useSyncExternalStore` is the better tool: it avoids
tearing in concurrent rendering and handles server rendering.

## Effects that depend on themselves

An effect that sets a value it also depends on loops forever:

```jsx
useEffect(() => {
  setCount(count + 1); // changes count, which re-runs the effect
}, [count]);
```

The fix is to ask why the effect exists at all. Usually the value is derived, or
the update belongs in an event. Dependency-array tactics are covered in
[effect dependencies and stale closures](react-effect-dependencies-stale-closures.md).

## What you should be able to answer

- Explain an effect in terms of synchronisation. What does React do when a
  dependency changes?
- Give three pairs of setup and cleanup, and describe what goes wrong without the
  cleanup.
- A search box shows results for an older query. Why, and how do you fix it with
  and without `AbortController`?
- Name three things people put in effects that belong elsewhere.
- Why can an effect callback not be `async`?
- When would you choose `useLayoutEffect` over `useEffect`?
