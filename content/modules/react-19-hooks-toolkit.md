# The rest of the hooks toolkit

Everyone knows `useState` and `useEffect`. Mid-level interviews go one step
further: "how would you keep typing responsive while a big list filters?", "how
do you give a label a unique id?", "how do you subscribe to a store without
tearing?". This guide covers the built-in hooks beyond the basics, as of React
19.2, with when to use each and, just as important, when not to. Form actions,
`useActionState`, `useFormStatus`, `useOptimistic` and `use()` are covered in
[React 19 in practice](modern-react.md).

## The map

| Hook | Solves | Reach for it when |
| --- | --- | --- |
| `useTransition` | Urgent vs non-urgent updates | You own the `setState` that causes a slow render |
| `useDeferredValue` | Rendering with a lagging value | You receive the value as a prop |
| `useId` | Unique, SSR-safe ids | Linking labels, hints and ARIA attributes |
| `useSyncExternalStore` | Subscribing to non-React data | Browser APIs, store libraries |
| `useEffectEvent` | Non-reactive logic in effects | An effect reads a value that should not restart it |
| `useLayoutEffect` | Measure before paint | Positioning that would visibly flicker |
| `useInsertionEffect` | Inject styles first | Writing a CSS-in-JS library |
| `useDebugValue` | DevTools labels | Publishing a shared hook |

## useTransition: mark updates as non-urgent

Typing and clicking are urgent: users expect instant feedback. Re-rendering a
large list or switching to a heavy tab is not. A transition tells React it may
interrupt that render to handle urgent input first, and keep showing the old UI
until the new one is ready:

```jsx
const [isPending, startTransition] = useTransition();

function selectTab(next) {
  startTransition(() => {
    setTab(next);
  });
}

return <TabBar className={isPending ? 'dimmed' : ''} onSelect={selectTab} />;
```

- `isPending` is true while the transition renders; use it for a subtle hint,
  not a blocking spinner.
- If the new tab suspends, React keeps the old content visible instead of
  flashing a Suspense fallback. That is why routers wrap navigations in
  transitions.
- In React 19 the callback may be async. `isPending` stays true until the promise
  settles, which replaces much hand-rolled `isSaving` state. State updates after
  an `await` inside it are not marked as transitions, so wrap them in
  `startTransition` again.
- Never put a controlled input's own update in a transition: typing would lag.
- `startTransition` imported directly from `react` does the same without
  `isPending`, for code outside components.

## useDeferredValue: render with a lagging copy

When you do not own the setter, because the value arrives as a prop, defer the
value instead:

```jsx
function SearchPage({ query }) {
  const deferredQuery = useDeferredValue(query);
  const isStale = query !== deferredQuery;
  return (
    <div style={{ opacity: isStale ? 0.6 : 1 }}>
      <Results query={deferredQuery} />
    </div>
  );
}

const Results = memo(function Results({ query }) { /* slow */ });
```

React first re-renders with the old deferred value, then renders the new one in
the background, abandoning it if `query` changes again. `Results` must be
wrapped in `memo`, or it re-renders on the urgent pass anyway and nothing is
gained. React 19 adds an `initialValue` argument, `useDeferredValue(query, '')`,
so the first render can show something cheap.

Deferring is not debouncing: it reduces rendering work, not network requests.
For "one request per keystroke", debounce the request.

## useId: ids that survive server rendering

```jsx
function EmailField() {
  const id = useId();
  return (
    <>
      <label htmlFor={`${id}-email`}>Email</label>
      <input id={`${id}-email`} aria-describedby={`${id}-hint`} />
      <p id={`${id}-hint`}>We never share it.</p>
    </>
  );
}
```

The id is unique per component instance, stable across renders, and identical
on server and client because it derives from the component's position in the
tree. A module counter or `Math.random()` breaks hydration. Call it once and add
suffixes rather than calling it in a loop. Never use it for list keys: keys must
come from your data. With several React roots on a page, pass an
`identifierPrefix` to each root so their ids cannot collide.

## useSyncExternalStore: subscribe to data React does not own

```jsx
function subscribe(callback) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

function useOnlineStatus() {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}
```

- `subscribe` is declared outside the component; a new function each render
  makes React resubscribe every time.
- `getSnapshot` must return the same value while nothing changed. Returning a
  fresh object (`() => ({ x: store.x })`) makes React warn and loop until
  "Maximum update depth exceeded".
- The third argument, `getServerSnapshot`, supplies the value for server
  rendering and hydration.
- Store updates cannot be transitions: React renders them synchronously, which is
  a trade-off of external store libraries in concurrent React.

This is what Zustand, Redux and similar libraries use internally. See
[react/51-use-sync-external-store](../../react/51-use-sync-external-store/).

## useEffectEvent: read the latest values without re-syncing

Stable in React 19.2. Some logic inside an effect should see current props but
should not restart the effect when they change:

```jsx
const onConnected = useEffectEvent(() => {
  showNotification('Connected', theme);
});

useEffect(() => {
  const c = createConnection(roomId);
  c.on('connected', () => onConnected());
  c.connect();
  return () => c.disconnect();
}, [roomId]);
```

Changing `roomId` reconnects; changing `theme` does not. Effect events are left
out of dependency arrays (the lint rule understands them) and may only be
called from effects. The full story of why this exists is in
[effect dependencies and stale closures](react-effect-dependencies-stale-closures.md).

## useLayoutEffect and useInsertionEffect

`useLayoutEffect` has the same signature as `useEffect` but runs after DOM
changes and **before** paint, and state updates inside it re-render
synchronously. Use it to measure and adjust (tooltips, popovers, keeping a chat
scrolled to the bottom) so users never see the intermediate frame. It blocks
painting, so keep it short and default to `useEffect`.

`useInsertionEffect` runs before any layout effects so CSS-in-JS libraries can
inject `<style>` rules that layout code will then measure correctly. It cannot
update state. Application code should not need it.

## useDebugValue

```jsx
function useOnlineStatus() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine);
  useDebugValue(online ? 'Online' : 'Offline');
  return online;
}
```

It only labels the hook in React DevTools. Worth adding to hooks in a shared
library; noise in one-off app hooks.

## Activity (React 19.2)

Not a hook, but it changes how you think about effects. `<Activity
mode="hidden">` hides a subtree while keeping its state, and unmounts its effects
(running their cleanups) until it is visible again. Tabs and back-navigation can
keep form input without keeping subscriptions alive. Correct effect cleanups,
the thing [StrictMode](react-strict-mode.md) tests for, are what make this safe.

## What you should be able to answer

- When would you use `useTransition`, and when `useDeferredValue`?
- Why must a component that receives a deferred value usually be memoised?
- Why use `useId` rather than a counter, and why not for keys?
- Your `useSyncExternalStore` call loops forever. What is the likely cause?
- What problem does `useEffectEvent` solve that adding a dependency does not?
- What does `useLayoutEffect` cost, and when is it worth it?
