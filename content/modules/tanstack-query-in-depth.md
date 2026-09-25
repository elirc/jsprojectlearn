# TanStack Query in depth

Once a team has adopted TanStack Query, the interview stops being "what is
server state?" and becomes "why did this list not update?" or "why did the
page flash a spinner?". A mid-level answer explains keys, freshness and the
cache precisely enough to debug those problems. [Server state, client state,
and choosing a library](server-and-client-state.md) covers the basics; this
guide goes a layer deeper. Examples use TanStack Query v5 with React 19.

## Query keys are dependency arrays

A query key names a cache entry and lists everything the fetch depends on,
exactly like a `useEffect` dependency array. If the `queryFn` reads a variable
that isn't in the key, different requests share one entry and the wrong data
appears.

Keys are hashed deterministically, so object property order doesn't matter,
but array position does: put the most general part first so prefix
invalidation works.

Centralise keys. In v5 the idiomatic tool is `queryOptions`, which bundles
key, fetcher and options into one typed object you can pass to `useQuery`,
`prefetchQuery`, `ensureQueryData` and `getQueryData`:

```ts
import { queryOptions } from '@tanstack/react-query';

export const todoQueries = {
  all: () => ['todos'] as const,
  lists: () => [...todoQueries.all(), 'list'] as const,
  list: (filters: TodoFilters) =>
    queryOptions({
      queryKey: [...todoQueries.lists(), filters],
      queryFn: ({ signal }) => api.getTodos(filters, { signal }),
      staleTime: 30_000,
    }),
  detail: (id: number) =>
    queryOptions({
      queryKey: [...todoQueries.all(), 'detail', id],
      queryFn: ({ signal }) => api.getTodo(id, { signal }),
    }),
};

const { data } = useQuery(todoQueries.detail(id));
const cached = queryClient.getQueryData(todoQueries.detail(id).queryKey); // typed as Todo | undefined
```

Now `invalidateQueries({ queryKey: todoQueries.lists() })` hits every list
without touching the detail entries, and nobody types `'todos'` by hand.

## `staleTime`, `gcTime` and refetch triggers

These are the most commonly confused options, and they measure different
things.

| Option | Default | Clock starts | When it runs out |
|---|---|---|---|
| `staleTime` | `0` | When data is fetched | Data is marked stale; the next trigger refetches it in the background |
| `gcTime` | 5 minutes | When the last observer unmounts | The entry is removed from memory entirely |

Stale data is still shown; it's just eligible for a background refetch. With
the default `staleTime: 0`, every mount refetches, so the usual fix for "too
many requests" is a sensible default `staleTime` (30 seconds to a few minutes
for CRUD data), or `Infinity` for data that never changes in a session.

A query refetches when one of these happens:

- A new component mounts that uses it (`refetchOnMount`).
- The window regains focus (`refetchOnWindowFocus`).
- The network reconnects (`refetchOnReconnect`).
- An interval elapses, if you set `refetchInterval`.
- You call `invalidateQueries` or `refetch()`.

All three `refetchOn*` options default to `true` and only fire for *stale*
data. Surprise requests in development are usually the focus refetch:
switching to DevTools and back counts. Raise `staleTime` rather than turning it
off globally.

`isPending` means there's no data yet. `isFetching` means a request is in
flight. `isLoading` is `isPending && isFetching`: the first load specifically.

## Invalidation versus `setQueryData`

After a mutation, you either tell the cache its data is out of date, or you
write the new data into it.

```ts
const qc = useQueryClient();

const rename = useMutation({
  mutationFn: api.renameTodo,
  onSuccess: (updated) => {
    qc.setQueryData(todoQueries.detail(updated.id).queryKey, updated); // exact record we got back
    return qc.invalidateQueries({ queryKey: todoQueries.lists() });   // lists may re-sort
  },
});
```

`invalidateQueries` marks matching entries stale and refetches the *active*
ones straight away; inactive ones refetch next time they're used. Returning its
promise from `onSuccess` keeps the mutation pending until the refetch
finishes, so a "Saving..." button doesn't flip back before the list updates.

Use `setQueryData` when the response is the complete new state of one record,
and invalidation when the change affects sorting, counts or pagination the
server computes.

## Dependent and parallel queries

A dependent query waits for data it needs. Use `enabled`:

```ts
const { data: user } = useQuery(userQueries.me());
const { data: projects } = useQuery({
  ...projectQueries.byOwner(user?.id ?? 0),
  enabled: !!user,
});
```

While `enabled` is false the query sits in `isPending` with `fetchStatus:
'idle'`, so don't render a spinner based on `isFetching` alone. v5 also offers
`skipToken` as the `queryFn` to disable a query in a type-safe way.

Several `useQuery` calls in one component already run in parallel. When the
number of queries is dynamic, use `useQueries`:

```ts
const results = useQueries({
  queries: ids.map((id) => todoQueries.detail(id)),
  combine: (rs) => ({
    todos: rs.flatMap((r) => (r.data ? [r.data] : [])),
    pending: rs.some((r) => r.isPending),
  }),
});
```

## Pagination and infinite lists

For numbered pages, put the page in the key and keep the old page on screen
while the next one loads:

```ts
import { keepPreviousData } from '@tanstack/react-query';

const { data, isPlaceholderData } = useQuery({
  ...todoQueries.list({ page }),
  placeholderData: keepPreviousData,
});
// disable "Next" while isPlaceholderData is true
```

For infinite scroll, `useInfiniteQuery` stores every loaded page in one entry:

```ts
const q = useInfiniteQuery({
  queryKey: ['feed'],
  queryFn: ({ pageParam, signal }) => api.getFeed({ cursor: pageParam, signal }),
  initialPageParam: null as string | null,
  getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
});
const items = q.data?.pages.flatMap((p) => p.items) ?? [];
```

Returning `undefined` from `getNextPageParam` sets `hasNextPage` to false.
Call `fetchNextPage()` from an `IntersectionObserver` sentinel, as
[react/55](../../react/55-infinite-scroll/) does by hand, and guard it with
`!q.isFetchingNextPage`. When an infinite query refetches, it refetches every
loaded page in order, so long feeds can use `maxPages` to cap memory and
refetch cost.

## Prefetching

Prefetch when you can predict what the user will want next:

```tsx
<Link to={`/todos/${id}`} onMouseEnter={() => qc.prefetchQuery(todoQueries.detail(id))}>
```

`prefetchQuery` never throws and skips fresh data. In a router loader, use
`ensureQueryData`, which returns cached data or fetches it, so the request
starts before the component renders:

```ts
export async function loader({ params }: { params: { id: string } }) {
  await queryClient.ensureQueryData(todoQueries.detail(Number(params.id)));
  return null;
}
```

The component then calls `useQuery(todoQueries.detail(id))` with the same
options and finds the data already there. The key factory is what guarantees
the loader and component agree. [React Router v7 concepts](react-router-v7-concepts.md)
covers loaders themselves.

## Optimistic updates, two ways

The **cache approach** edits the cache in `onMutate`, returns a snapshot, and
restores it on error. The server-state guide shows the full snapshot-and-rollback
code. The details interviewers probe: `await qc.cancelQueries(...)` first so an
in-flight refetch can't overwrite your edit, and invalidate in `onSettled` so
the cache ends up matching the server whether the call succeeded or not. Use
this when the change shows up in several places at once, such as a list and a
counter.

The **UI-variables approach** leaves the cache alone and renders the pending
item from the mutation's `variables`:

```tsx
const addTodo = useMutation({
  mutationKey: ['addTodo'],
  mutationFn: api.addTodo,
  onSettled: () => qc.invalidateQueries({ queryKey: todoQueries.lists() }),
});

<ul>
  {todos.map((t) => <li key={t.id}>{t.title}</li>)}
  {addTodo.isPending && <li style={{ opacity: 0.5 }}>{addTodo.variables.title}</li>}
</ul>
```

Nothing needs rolling back: on failure the pending row disappears and you
show `addTodo.isError` with a retry. If the list lives in a different component, read the pending variables there with
`useMutationState({ filters: { mutationKey: ['addTodo'], status: 'pending' },
select: (m) => m.state.variables })`. Prefer this approach when the optimistic
item appears in one place. [react/39](../../react/39-optimistic-updates/)
builds the rollback version without a library.

## Retries, errors and `select`

Queries retry three times with exponential backoff by default; mutations don't
retry. Retrying a 404 or a 403 is pointless, so make the policy explicit:

```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (count, err) => !(err instanceof HttpError && err.status < 500) && count < 3,
    },
  },
});
```

Because `fetch` resolves on 4xx and 5xx, your `queryFn` must throw, or the
query "succeeds" with an error body. [Error boundaries and error UX](react-error-boundaries.md)
covers `throwOnError` for sending failures to a boundary.

`select` transforms or narrows the data for one component. The cache keeps the
full response, and the component only re-renders when the selected result
changes:

```ts
const { data: count } = useQuery({ ...todoQueries.list(filters), select: (todos) => todos.length });
```

If `select` is expensive, define it outside the component or memoise it; an
inline function re-runs every render.

## Suspense and SSR

`useSuspenseQuery` suspends until data exists, so `data` is always defined and
the loading UI lives in a `<Suspense>` fallback. It doesn't accept `enabled` or
`placeholderData`; to switch pages without the fallback reappearing, wrap the
state change in `startTransition`. Two suspense queries in one component fetch
in series, one after the other, so prefetch or use `useSuspenseQueries` when
they're independent.

For SSR, the rule is one `QueryClient` per request on the server. A module-level
client would share one user's cached data with every other visitor. On the
client, create it once per app with `useState(() => new QueryClient())` so it
survives re-renders. The server prefetches, serialises the cache with
`dehydrate`, and the client restores it with `<HydrationBoundary>`. Set a
non-zero `staleTime`, or the client refetches everything it just received.

## What you should be able to answer

- Why must every variable the `queryFn` uses appear in the query key, and how do key factories or `queryOptions` help?
- What is the difference between `staleTime` and `gcTime`, and which do you change to stop excessive refetching?
- After a mutation, when do you invalidate and when do you call `setQueryData`?
- How do you keep the previous page visible while the next page loads, and how does `useInfiniteQuery` know there are no more pages?
- Compare the cache and UI-variables approaches to optimistic updates. What does each do on failure?
- Why must a server create a new `QueryClient` per request?
