# Server state, client state, and choosing a library

"Redux or Context?" still gets asked, and the 2026 answer starts with "most of
that state isn't client state at all". Nearly every React job uses TanStack
Query, RTK Query or SWR for data from the API. The React track builds fetching
by hand so you understand the problems; this guide covers the tools that solve
them, and how to defend a state design in an interview.

## A taxonomy of state

Sort every piece of state before you choose where it lives:

| Kind | Examples | Where it belongs |
|---|---|---|
| Server state | Orders, the current user, product lists | A query cache (TanStack Query, RTK Query, SWR) |
| URL state | Filters, sort, page, selected tab, open record id | The URL's path and query string |
| Form state | Field values and errors while editing | The form (uncontrolled inputs, React Hook Form, actions) |
| UI state | Is this dropdown open, which row is hovered | `useState` in the component that owns it |
| Global client state | Theme, a shopping cart before checkout, a multi-step wizard | Context, or a small store |

Server state is different in kind. You don't own it: it's a *cached copy* of
something that lives on the server, and it can go stale while you look at it.
It needs fetching, caching, deduplication, refetching and invalidation, none of
which a client-state tool provides. Once server state moves to a query cache,
the global client state that's left is usually small enough for Context.

## Why hand-rolled `useEffect` fetching breaks down

[react/19](../../react/19-fetch-race/), [react/20](../../react/20-fetch-status/)
and [react/22](../../react/22-custom-hook-usefetch/) build this by hand. The
`useFetch` you end up with still lacks:

- **Race handling** across every component, not just the one you fixed.
- **Deduplication.** Three components that need the current user make three
  requests.
- **Caching.** Navigate away and back, and you get a spinner and a refetch.
- **Refetching** when the tab regains focus or the network reconnects.
- **Invalidation.** After you create an order, nothing tells the list.
- **Retries** with backoff, and cancellation.

Each is solvable. Solving all of them is writing a query library.

## The query-library model

Examples use TanStack Query v5; RTK Query and SWR share the same ideas.

```jsx
const { data, isPending, isError, error, isFetching } = useQuery({
  queryKey: ['orders', { status, page }],
  queryFn: ({ signal }) =>
    fetch(`/api/orders?status=${status}&page=${page}`, { signal }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }),
  staleTime: 30_000,
});
```

- **The query key** identifies the data. Anything the fetch depends on goes in
  it; when the key changes, the query refetches. Components using the same key
  share one request and one cache entry.
- **`staleTime`** (default 0) is how long data counts as fresh. Fresh data is
  served from cache with no request. Stale data is still shown, then refetched
  in the background on mount, window focus or reconnect.
- **`gcTime`** (default 5 minutes) is how long an *unused* entry stays in memory
  before it's garbage-collected. It was called `cacheTime` before v5.
- **`isPending`** means there's no data yet. **`isFetching`** means a request is
  in flight, including background refetches. Show a spinner for the first and a
  subtle indicator for the second.
- Failed queries retry three times with exponential backoff by default. `fetch`
  doesn't reject on a 4xx or 5xx, so throw yourself, as above.

## Mutations and invalidation

```jsx
const queryClient = useQueryClient();
const createOrder = useMutation({
  mutationFn: (input) => api.post('/api/orders', input),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['orders'] }),
});
```

`invalidateQueries` marks every query whose key starts with `['orders']` as
stale and refetches the ones on screen. That's the default answer to "after
creating an order, how does the list update?": invalidate, and the server
remains the source of truth for sort order, totals and anything computed.

The alternative is writing the result into the cache directly:

```jsx
onSuccess: (updated) => queryClient.setQueryData(['order', updated.id], updated),
```

That saves a request and suits updating one record whose response contains the
full new state. Prefer invalidation when the change affects lists, counts or
pagination you can't reproduce correctly on the client.

## Optimistic updates

For actions that almost always succeed (toggling a checkbox, reordering), show
the result before the server confirms. Snapshot, apply, roll back:

```jsx
useMutation({
  mutationFn: toggleTodo,
  onMutate: async (id) => {
    await queryClient.cancelQueries({ queryKey: ['todos'] });   // stop a refetch overwriting us
    const previous = queryClient.getQueryData(['todos']);
    queryClient.setQueryData(['todos'], (old) =>
      old.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
    return { previous };                                           // the snapshot
  },
  onError: (_err, _id, snapshot) => queryClient.setQueryData(['todos'], snapshot.previous),
  onSettled: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
});
```

This is the pattern [react/39](../../react/39-optimistic-updates/) builds by
hand, with the cache as the store. For a single list, v5 also lets you skip the
cache edit and render the pending item from the mutation's `variables` until it
settles.

React 19's `useOptimistic` does the same job for state you hold in React, with
the rollback built in; [the modern React guide](modern-react.md) covers it. Use
the query library's pattern when the data lives in the query cache, and
`useOptimistic` when it doesn't. Don't layer one on the other.

## Pagination, infinite lists, prefetching and Suspense

- **Paginated tables:** put the page in the key and pass
  `placeholderData: keepPreviousData` so the old page stays visible while the
  next loads, rather than flashing a spinner.
- **Infinite scroll:** `useInfiniteQuery` with `initialPageParam` and a
  `getNextPageParam` that returns the next cursor, or `undefined` when there are
  no more pages.
- **Prefetching:** `queryClient.prefetchQuery(...)` on hover over a row makes
  the detail page instant.
- **Suspense:** `useSuspenseQuery` suspends instead of returning `isPending`,
  so `data` is always defined and loading UI lives in a `<Suspense>` boundary.

## Client state tools compared

| Tool | Good at | Watch out for |
|---|---|---|
| `useState` / `useReducer` | State owned by one component or subtree | Prop drilling when many distant components need it |
| Context | Values that rarely change: theme, current user, locale | Every consumer re-renders when the value changes ([react/33](../../react/33-context-splitting/)) |
| Zustand | Small global stores; components subscribe to slices | Easy to put server state in it by accident |
| Redux Toolkit | Large apps, many developers, strict conventions, DevTools time travel | More ceremony; only worth it at scale |
| RTK Query | Server state for a team already on Redux Toolkit | Pulls in Redux if you aren't on it |
| Jotai | Many small independent pieces of state (atoms) | A different mental model to learn |

Redux Toolkit is the only recommended way to write Redux today; hand-written
action constants and `switch` reducers are legacy. For a typical CRUD app, a
defensible default is TanStack Query plus the URL plus `useState`, with Context
for the two or three truly global values and Zustand only if Context re-renders
become a measured problem.

## URL as state

Filters, sort and the current page belong in the URL, so a view can be shared,
bookmarked and restored with the back button. [react/42](../../react/42-hash-router/)
and [js/60](../../60-router/) build routing by hand, and
[the pagination guide](api-pagination-filtering.md) covers keeping filter state
in the query string. The link to this guide is the query key: read the filters
from the URL, and put them in the key, so the URL drives the fetch.

Router loaders (React Router v7, TanStack Router) start fetching when
navigation begins rather than after the component renders. They pair with a
query library: the loader calls `queryClient.ensureQueryData(...)` and the
component reads the same key with `useQuery`.

## The interview answer: an orders dashboard

> "The orders list, order details and the current user are server state, so they
> go in TanStack Query, keyed by the filters. The filters, sort and page live in
> the URL, so the view is shareable and the back button works. The create-order
> form keeps its own state and invalidates `['orders']` on success. Toggling an
> order as 'flagged' is optimistic with rollback, because it almost never fails.
> Theme and the signed-in user's permissions go in Context. I don't need Redux:
> once the server state is out, the global state that's left is tiny."

## What you should be able to answer

- Why does the difference between server state and client state matter?
- After creating an order, how does the list update?
- Walk through an optimistic update with rollback.
- Redux Toolkit, Zustand or Context for this app? Defend it.
- What does `staleTime` control, and how is it different from `gcTime`?
