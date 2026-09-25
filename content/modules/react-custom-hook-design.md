# Designing custom hooks

"Have you written a custom hook?" is a standard filter question. The weak answer
is "I moved some code into a function that starts with `use`". The strong answer
explains what a hook shares (logic, not state), how you chose its inputs and
outputs, and how it cleans up after itself.

## What a custom hook is

A custom hook is a function whose name starts with `use` and which calls other
hooks. That is the whole definition. The name matters because it tells readers,
and the `rules-of-hooks` lint rule, that the rules apply: call it at the top
level of a component or another hook, never in a condition, loop or handler.

The corollary: a function that calls no hooks should not be named `use...`.
`useFormatPrice` that just calls `Intl.NumberFormat` is a plain function called
`formatPrice`, and then it can be used in loops, handlers and tests freely.

## Hooks share logic, not state

Each call gets its own state:

```jsx
function useToggle(initial = false) {
  const [on, setOn] = useState(initial);
  const toggle = useCallback(() => setOn((v) => !v), []);
  return [on, toggle];
}

function Settings() {
  const [emails, toggleEmails] = useToggle();
  const [sms, toggleSms] = useToggle(); // completely independent
}
```

Two components calling `useCart()` built on `useState` get two separate carts. To
share state, lift it to a common parent, put it in context, or use a store; a
hook can then wrap that shared source (`useCart` reading a `CartContext`).

## Designing the inputs

Treat hook parameters like props: they are reactive. If an effect inside reads a
parameter, the parameter is a dependency:

```jsx
function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
```

Object parameters are the trap. `useFetch(url, { headers: { Accept: 'json' } })`
passes a new object every render; if the hook lists `options` as a dependency,
it refetches after every render, sets state, re-renders and loops. Design for it:

- Prefer primitive parameters (`useFetch(url, { accept })` destructured inside to
  strings).
- Or read rarely-changing options through a ref or `useEffectEvent`, so they do
  not restart the effect.
- Or document that callers must memoise the object, and accept that some will not.

## Designing the outputs

| Shape | Use when | Example |
| --- | --- | --- |
| Tuple `[value, setter]` | Two values callers will rename | `const [dark, toggleDark] = useToggle()` |
| Object `{ data, error, status }` | Several values, used selectively | `const { data, status } = useOrders()` |
| Single value | One derived or subscribed value | `const online = useOnlineStatus()` |

Two identity rules make a hook pleasant to use:

- **Return stable functions.** Wrap returned callbacks in `useCallback` (with
  updaters so they need few dependencies). Callers will pass them to `memo`
  children and put them in dependency arrays, where a new identity each render
  causes re-renders or effect loops.
- **Be careful with returned objects.** `return { filters, setFilter }` is a new
  object every render. That is fine if callers destructure it, but a caller who
  puts the whole object in a dependency list re-runs every render. Memoise it
  with `useMemo` if it is likely to be used that way.

## Cleanup and cancellation belong inside the hook

A hook that starts something must stop it, so every caller gets correct
behaviour for free. A debounced value:

```jsx
function useDebouncedValue(value, delay) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
```

Each new `value` runs the cleanup, cancelling the previous timer, so only the
last one fires. While the user types, the hook keeps returning the last settled
value. The cleanup is the debounce.

A `useFetch`-shaped hook needs an `AbortController` in its effect, filtering
of `AbortError`, and a decision about what to show while a new URL loads: hook
state persists across parameter changes, so without a reset the previous URL's
data stays on screen. For real apps, prefer a query library, which adds caching,
deduplication and invalidation (see
[server and client state](server-and-client-state.md)); the hand-rolled version
is for understanding and interviews.

## A persistent state hook

```jsx
function useLocalStorage(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? initial : JSON.parse(stored);
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
}
```

Decisions worth explaining in an interview: the lazy initialiser reads storage
once, not every render; `try/catch` handles corrupt JSON and blocked storage;
writing in an effect keeps storage in sync with state. Open questions a reviewer
might raise: `localStorage` does not exist during server rendering, and other
tabs will not see changes unless you listen for the `storage` event, at which
point `useSyncExternalStore` is the better base. Build it in
[react/23-usepersistentstate](../../react/23-usepersistentstate/).

## Hooks that should be components (and vice versa)

A hook that returns JSX (`const { modal, open } = useModal()`) mixes rendering
into logic: callers cannot place, style or compose the markup easily. Usually a
component with `open` and `onClose` props, or a compound component, is clearer.
Conversely, a component that renders nothing and only runs effects (`<Tracker />`)
is often a hook in disguise.

Also avoid choosing hooks dynamically. `const useData = isAdmin ? useAdminData :
useUserData` breaks as soon as `isAdmin` changes, because React matches hook state
by call order, not by name.

## When to extract

Extract a hook when stateful logic is repeated, or when naming it makes a
component read better (`useOnlineStatus()` says more than an effect with two
listeners). Do not extract single-use `useEffect` wrappers such as `useMount`;
they hide dependencies and make the linter less useful. Hooks named after
lifecycle moments usually fight the synchronisation model described in
[effects as synchronisation](react-effects-as-synchronisation.md).

## Testing hooks

Test a hook through a small component that uses it, or with `renderHook` from
Testing Library:

```jsx
import { renderHook, act } from '@testing-library/react';

test('toggle flips the value', () => {
  const { result } = renderHook(() => useToggle());
  act(() => result.current[1]());
  expect(result.current[0]).toBe(true);
});
```

Read `result.current` after each update, not a destructured copy from before it,
and wrap updates in `act`. Use fake timers for debounce and interval hooks. See
[react/50-build-your-own-hooks](../../react/50-build-your-own-hooks/) and
[react/24-usedebouncedvalue](../../react/24-usedebouncedvalue/).

## What you should be able to answer

- What makes a function a custom hook, and why does the `use` prefix matter?
- Two components call the same hook. Do they share state? How would you make
  them?
- When would you return a tuple and when an object?
- Why should a hook return callbacks wrapped in `useCallback`?
- How does effect cleanup turn `useDebouncedValue` into a debounce?
- What goes wrong when a hook takes an options object and lists it as an effect
  dependency?
