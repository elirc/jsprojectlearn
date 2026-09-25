# Context without the performance trap

Context is the first tool most people reach for when prop drilling hurts, and
the first thing that gets blamed when a React app feels slow. Interviewers like
it because the honest answer has two halves: context is a *dependency
injection* mechanism, not a state manager, and it re-renders more than people
expect. Knowing exactly when and why lets you keep it and still ship a fast UI.

## What context actually does

A provider makes a value available to every component below it. A consumer
reads the nearest provider above it:

```tsx
const ThemeContext = createContext<'light' | 'dark'>('light');

function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  return (
    <ThemeContext value={theme}>        {/* React 19: the context is the provider */}
      <Page onToggle={() => setTheme(t => (t === 'light' ? 'dark' : 'light'))} />
    </ThemeContext>
  );
}

function Button() {
  const theme = use(ThemeContext);      // or useContext(ThemeContext)
  return <button className={`btn-${theme}`}>Save</button>;
}
```

Three rules explain almost every context bug:

1. **Nearest provider wins.** Nest a second provider to override a subtree.
   Without any provider, you get the default passed to `createContext`.
2. **Consumers re-render when the value changes**, compared with `Object.is`.
   There is no partial subscription: a consumer that reads `value.user`
   re-renders when `value.cart` changes, because the value object changed.
3. **`memo` does not block context.** A memoised component that reads a
   context still re-renders when that context changes. `memo` only compares
   props.

## Trap one: a new value object on every render

```tsx
function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  return (
    <AuthContext value={{ user, setUser }}>   {/* new object every render */}
      {children}
    </AuthContext>
  );
}
```

Whenever `AuthProvider` re-renders for any reason, `{ user, setUser }` is a new
object, so every consumer re-renders even though nothing they read changed.
The fix without the Compiler is `useMemo`:

```tsx
const value = useMemo(() => ({ user, setUser }), [user]);
```

Notice what does *not* cause the problem: `children`. The provider's children
are elements created by *its* parent, so the provider re-rendering on its own
state change does not re-render them. Only consumers of the context re-render.
That is why "state in a provider, `children` passed through" is an efficient
shape.

## Trap two: one context for everything

```tsx
<AppContext value={{ user, theme, cart, notifications }}>
```

Add an item to the cart and the header, the settings page and every themed
button re-render, because they all read `AppContext`. The fix is to **split by
rate of change and by audience**:

| Context | Changes | Read by |
|---|---|---|
| `AuthContext` | On login and logout | Header, route guards |
| `ThemeContext` | Rarely | Every styled component |
| `CartContext` | On every add and remove | Cart badge, cart page |

Now a cart change re-renders only cart consumers. [react/33](../../react/33-context-splitting/)
measures the difference.

## Trap three: state and dispatch together

Many components only *change* state and never read it: an "Add to cart" button
needs `addItem`, not the cart. If both live in one context, every button
re-renders on each cart change. Put them in two contexts:

```tsx
const CartStateContext = createContext<CartState | null>(null);
const CartDispatchContext = createContext<React.Dispatch<CartAction> | null>(null);

function CartProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, initialCart);
  return (
    <CartDispatchContext value={dispatch}>
      <CartStateContext value={state}>{children}</CartStateContext>
    </CartDispatchContext>
  );
}
```

`dispatch` from `useReducer` (like a `useState` setter) is stable for the life
of the component, so the dispatch context never changes and its consumers never
re-render because of it. Wrap each in a custom hook (`useCart()`,
`useCartActions()`) that throws a clear error when the provider is missing.

## Trap four: fast-changing values

A context holding the mouse position, a scroll offset or a text input's value
changes many times a second, and each change re-renders every consumer. Context
is the wrong tool here. Options, in order of preference:

- **Keep it local.** The input's value belongs to the input or its form.
- **Subscribe outside React's render path.** Store the value in a ref or a
  small external store and update the DOM, or only the one component that
  needs it.
- **Use a store with selectors** (below).

## Selectors: subscribing to a slice

Context has no selectors. When many components each need a different slice of
a frequently changing object, use an external store and `useSyncExternalStore`,
which re-renders a component only when *its* selected snapshot changes:

```tsx
function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set: (next: T) => { state = next; listeners.forEach(l => l()); },
    subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); },
  };
}

function useStore<T, S>(store: ReturnType<typeof createStore<T>>, select: (s: T) => S) {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}
```

The selector must return a stable value for unchanged state: returning a new
object or array each call makes React see a change every time and loop. Select
primitives, or memoise derived objects. This is exactly what Zustand does for
you, including `useShallow` for selecting several fields.
[react/51](../../react/51-use-sync-external-store/) builds the hook, and
[react/41](../../react/41-mini-store/) builds the store.

You can still pass the *store instance* through context. That gives you
per-subtree stores (one per form, one per test) without re-renders, because the
store object itself never changes.

## What the React Compiler changes

React Compiler 1.0 memoises components and values automatically. For context
that means:

- **It fixes trap one.** The `{ user, setUser }` object literal is cached and
  recreated only when `user` changes, so you no longer need the manual
  `useMemo`.
- **It does not fix traps two to four.** A consumer still re-renders whenever
  the context value changes. The Compiler cannot turn one broad context into
  fine-grained subscriptions, and it does not make a 60-updates-a-second
  context cheap.
- **It reduces the blast radius.** Inside a consumer that re-renders, children
  whose props did not change are skipped, so the cost of each re-render drops.

The architecture decisions (split contexts, keep fast state local, use a store
for slices) remain yours.

## Measure before you restructure

Context re-renders are only a problem when they are slow or visible. Before
splitting anything, open the React DevTools Profiler, record the interaction
and check which components rendered and why ("Context changed" appears in the
"why did this render" details). If twenty cheap components re-render in two
milliseconds, leave them alone. [React performance profiling](react-performance-profiling.md)
walks through the workflow, and [the state guide](server-and-client-state.md)
covers why server data should not be in context in the first place: a query
cache already gives components per-key subscriptions.

## A defensible default

For a typical CRUD app:

- Context for a handful of global, slow-changing values: current user, theme,
  locale, feature flags, and injected services such as an API client.
- A query library for server data, not context.
- The URL for filters, sort and pagination.
- Local state for everything else, lifted only as far as needed.
- A store with selectors only when you measure a real context problem.

## What you should be able to answer

- Why does every consumer re-render when a provider's value changes, and why doesn't `memo` help?
- Why does passing `{ user, setUser }` as a value cause extra renders, and what does the React Compiler change about it?
- Why split state and dispatch into separate contexts?
- When is context the wrong tool, and what would you use instead?
- Why do the provider's `children` not re-render when the provider's state changes?
- How does `useSyncExternalStore` give you selectors that context cannot?
