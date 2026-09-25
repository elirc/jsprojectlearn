# Client state options compared

"Which state management library would you use?" is a trap if you answer with a
library name. The strong answer starts by asking what kind of state it is and
who needs it, and usually ends with less tooling than the interviewer expected.
This guide compares the options once server data is already handled by a query
library, as [Server state, client state, and choosing a library](server-and-client-state.md)
recommends.

## First, take out what isn't client state

Before choosing a tool, remove three things from the pile:

- **Server data.** Orders, users, products: anything the server owns belongs in
  TanStack Query, RTK Query or a router loader, which handle caching, refetching
  and invalidation. Copying it into a Zustand store or Redux slice creates a
  second source of truth that goes stale. See [TanStack Query in depth](tanstack-query-in-depth.md).
- **Form state.** In-progress field values, touched flags and validation
  errors belong to the form: uncontrolled inputs, `useActionState`, or a form
  library. Mirroring every keystroke into a global store re-renders half the
  app and outlives the form. [Forms at scale](react-forms-at-scale.md) goes
  deeper.
- **URL state.** Filters, sort, page, selected tab, the open record's id. If a
  user would expect a link or the back button to restore it, it belongs in the
  URL.

What remains is usually small: UI state (modal open, sidebar collapsed), a few
global preferences (theme, locale), and occasionally a genuinely client-side
domain such as a drawing canvas, an editor or a multi-step wizard.

## Local state, reducers and lifting

`useState` is the default. Reach for `useReducer` when several values change
together or the next state depends on an action type, because a reducer is a
pure function you can unit test without rendering ([react/13](../../react/13-usereducer-todo/)).

When two siblings need the same value, lift it to their nearest common parent
([react/08](../../react/08-lifting-state/)). Lifting is fine for two or three
levels. The warning signs are props passed through components that never use
them, and a parent re-rendering a large tree for a value only one leaf reads.
The first fix for either is often composition, passing `children` so the
middle layers disappear, rather than a global store. [Composition
patterns](react-composition-patterns.md) shows how.

## Context: dependency injection, not a store

Context makes a value available to a subtree without props. It has no selector:
every consumer re-renders when the provided value changes. That makes it ideal
for values that rarely change (theme, locale, the signed-in user, a feature
flag client) and poor for values that change on every keystroke.

If you do put changing state in context, split state and dispatch into separate
contexts and memoise the value object ([react/33](../../react/33-context-splitting/)).
[Context without the perf trap](react-context-performance.md) covers the
measurement and the fixes in detail.

## The URL as a state container

Search params are global, shareable, survive a refresh and work with the back
button, which no store gives you for free.

```tsx
import { useSearchParams } from 'react-router';

function OrderFilters() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'all';

  return (
    <select
      value={status}
      onChange={(e) =>
        setParams((prev) => {
          prev.set('status', e.target.value);
          prev.delete('page');            // new filter resets pagination
          return prev;
        }, { replace: true })
      }
    >
      <option value="all">All</option>
      <option value="open">Open</option>
    </select>
  );
}
```

Everything in the URL is a string, so parse and validate it (a schema library
helps) and fall back to defaults for junk values. Use `replace` for rapid
changes such as typing in a search box so history doesn't fill with every
character. Read the params, then feed them into the query key.

## Zustand: a small store with selectors

Zustand v5 gives you a hook-based store outside React. Components subscribe to
a slice via a selector and re-render only when that slice changes.

```ts
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

type CartState = {
  items: Record<string, number>;
  add: (sku: string) => void;
  clear: () => void;
};

export const useCart = create<CartState>()((set) => ({
  items: {},
  add: (sku) => set((s) => ({ items: { ...s.items, [sku]: (s.items[sku] ?? 0) + 1 } })),
  clear: () => set({ items: {} }),
}));

const count = useCart((s) => Object.keys(s.items).length);     // primitive: fine
const add = useCart((s) => s.add);                               // stable function: fine
const { items, clear } = useCart(useShallow((s) => ({ items: s.items, clear: s.clear })));
```

The trap: a selector that builds a new object or array on every call, such as
`(s) => ({ items: s.items })` or `(s) => s.list.filter(...)`. The result is
never equal to the previous one. In v4 that meant a re-render on every store
change; v5 uses `useSyncExternalStore` directly, so it can loop and throw
"Maximum update depth exceeded".
`useShallow` compares the result's top-level fields instead. Actions live in the
store, and calling `set` merges at the top level only; nested objects need
spreading, as `add` shows. [react/41](../../react/41-mini-store/) and
[react/51](../../react/51-use-sync-external-store/) build the same mechanism
with `useSyncExternalStore`.

## Jotai atoms and Redux Toolkit

**Jotai** models state as atoms, small independent units that components
subscribe to individually. Derived atoms compute from others and update
automatically:

```ts
import { atom, useAtom, useAtomValue } from 'jotai';

const priceAtom = atom(20);
const qtyAtom = atom(1);
const totalAtom = atom((get) => get(priceAtom) * get(qtyAtom)); // read-only derived atom

const [qty, setQty] = useAtom(qtyAtom);
const total = useAtomValue(totalAtom);
```

It suits many fine-grained pieces of state that combine in different ways, such
as a form builder or a spreadsheet-like editor.

**Redux Toolkit** is Redux as it is written today: `configureStore`,
`createSlice` (with Immer, so "mutating" code in reducers is safe), and typed
hooks created with `useSelector.withTypes<RootState>()`. It earns its ceremony
with many developers, strict conventions, middleware for cross-cutting
concerns, and DevTools that replay every action. If the team is on Redux, RTK
Query handles server state in the same store.

| Option | Scope | Re-renders | Best for |
|---|---|---|---|
| `useState` / `useReducer` | One component or subtree | The owning component and its children | Almost everything |
| Context | A subtree | Every consumer on any change | Rarely-changing globals |
| URL params | The whole app, shareable | Components reading the params | Filters, sort, page, tabs |
| Zustand | Global module | Components whose selected slice changed | A few global UI stores |
| Jotai | Per atom | Components reading that atom | Many small interdependent values |
| Redux Toolkit | One global store | Components whose selected slice changed | Large teams, audited state changes |

## A decision flow

1. Does the server own it? Use a query library. Stop.
2. Is it a form's in-progress input? Keep it in the form. Stop.
3. Should a link or refresh restore it? Put it in the URL.
4. Does only one component need it? `useState` or `useReducer`.
5. Do a few nearby components need it? Lift it, or restructure with `children`.
6. Is it read widely but rarely changed? Context.
7. Is it read widely *and* changed often? Zustand (or Jotai, or Redux Toolkit
   if the team already uses it).

Most CRUD apps stop at step 6.

## Persistence and hydration pitfalls

Persisting client state to `localStorage` looks trivial and bites in three ways.
[Browser storage compared](browser-storage-compared.md) covers the storage APIs;
[react/23](../../react/23-usepersistentstate/) builds the hook.

**Version what you persist.** Once a shape is on users' disks, you can't change
it silently. Zustand's `persist` middleware stores a version and gives you a
migration hook:

```ts
import { persist, createJSONStorage } from 'zustand/middleware';

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({ theme: 'system', density: 'comfortable', setTheme: (theme) => set({ theme }) }),
    {
      name: 'prefs',
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ theme: s.theme, density: s.density }), // never persist functions or secrets
      migrate: (old, version) => (version < 2 ? { ...(old as object), density: 'comfortable' } : old) as Prefs,
    },
  ),
);
```

**Server rendering mismatches.** The server has no `localStorage`, so it
renders defaults; the client reads the stored value on its first render and
produces different markup, which triggers a hydration error. Render the default
first and apply the stored value after hydration: delay reading until an effect
runs, or use the middleware's `skipHydration: true` option and call
`usePrefs.persist.rehydrate()` in a `useEffect`. For theme specifically, a tiny
inline script that sets a class on `<html>` before React loads avoids a flash.

**Treat stored data as untrusted.** Users edit it, old versions linger, and
another tab can change it. Validate on read, never store tokens or personal
data you wouldn't want an XSS payload to steal, and listen for the `storage`
event if tabs must stay in sync.

## What you should be able to answer

- Why shouldn't API data be copied into a Zustand or Redux store, and where should it live instead?
- When does context cause performance problems, and what would you try before adding a library?
- What belongs in the URL rather than in component state?
- Why does a Zustand selector returning a new object cause extra re-renders, and how does `useShallow` fix it?
- Walk through how you would decide where a new piece of state lives.
- What goes wrong when persisted state meets server rendering, and how do you version persisted state?
