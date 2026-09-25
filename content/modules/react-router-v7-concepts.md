# React Router v7 concepts

React Router is the router most React job ads mean, and v7 changed what it is:
the Remix framework merged into it, so the same package now ranges from "swap
components by URL" to a full-stack framework. Interviewers rarely want API
trivia. They want to know you understand nested routes, loading data before
render, mutations through forms, and how errors and pending states are handled
at the route level.

## Three ways to use it

v7 ships one package, `react-router` (`react-router-dom` is now just a
re-export), used in one of three modes:

| Mode | Set-up | You get |
|---|---|---|
| Declarative | `<BrowserRouter>` with `<Routes>`/`<Route>` | URL matching, links, params, nested layouts |
| Data | `createBrowserRouter([...])` and `<RouterProvider>` | Plus loaders, actions, fetchers, pending states, route error boundaries |
| Framework | Vite plugin, `routes.ts`, one module per route | Plus code splitting by route, server rendering or pre-rendering, generated route types |

Declarative mode is fine for simple apps and legacy code. The concepts below are
from data and framework mode, which is what "React Router v7" usually means in
a new project. [react/42](../../react/42-hash-router/) and
[js/60](../../60-router/) build a router by hand, which makes the library much
less magical.

## Nested routes and layouts

Routes form a tree that mirrors your UI. A parent renders shared chrome and an
`<Outlet />` where the matched child appears:

```tsx
const router = createBrowserRouter([
  {
    path: '/',
    Component: AppShell,                   // header and nav; renders <Outlet />
    children: [
      { index: true, Component: Dashboard },          // exactly "/"
      {
        path: 'orders',
        Component: OrdersLayout,                      // list on the left, <Outlet /> on the right
        children: [
          { index: true, Component: PickAnOrder },
          { path: ':orderId', Component: OrderDetail, loader: orderLoader },
        ],
      },
      { path: '*', Component: NotFound },
    ],
  },
]);
```

Moving from `/orders/7` to `/orders/8` keeps `AppShell` and `OrdersLayout`
mounted, including their state and scroll position; only the detail re-renders.
A route with no `path` is a *layout route*: it wraps children without adding a
URL segment, which is handy for "everything behind login" groups.

## Loaders: data before render

A loader is a function on the route that fetches what the route needs. The
router calls the loaders of *every* matched route in parallel as soon as
navigation starts, then renders when they resolve:

```tsx
export async function orderLoader({ params, request }: LoaderFunctionArgs) {
  const res = await fetch(`/api/orders/${params.orderId}`, { signal: request.signal });
  if (res.status === 404) throw data('Order not found', { status: 404 });
  if (!res.ok) throw new Error(`Orders API returned ${res.status}`);
  return (await res.json()) as Order;
}

function OrderDetail() {
  const order = useLoaderData() as Order;   // framework mode types this for you
  return <h1>Order {order.number}</h1>;
}
```

Why this beats a `useEffect` in each component:

- **No waterfalls.** With effects, the parent renders, fetches, renders the
  child, which then fetches. Loaders for parent and child start together.
- **No loading flash per component.** The page renders with its data.
- **Cancellation built in.** If the user navigates again, `request.signal`
  aborts the stale fetch.

Loaders pair with a server-state cache rather than replacing it: call
`queryClient.ensureQueryData(orderQuery(id))` in the loader and read the same
query with `useQuery` in the component, so you get both early fetching and
caching. See [TanStack Query in depth](tanstack-query-in-depth.md). For slow,
non-critical data, return a promise without awaiting it and render it with
`<Suspense>` plus `<Await>` or React's `use`, so the page shows while that part
streams in.

## Actions: mutations through forms

An action handles non-GET submissions to a route. `<Form method="post">`
serialises the form and calls the matching route's action:

```tsx
export async function editOrderAction({ request, params }: ActionFunctionArgs) {
  const formData = await request.formData();
  const res = await fetch(`/api/orders/${params.orderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.fromEntries(formData)),
  });
  if (res.status === 422) return data(await res.json(), { status: 422 });   // show errors
  if (!res.ok) throw new Error('Could not save the order');
  return redirect(`/orders/${params.orderId}`);
}
```

Two behaviours make this model pleasant:

- **Automatic revalidation.** After an action completes, the router re-runs the
  loaders on the page, so the UI shows fresh server data without manual cache
  updates.
- **Post/redirect/get.** Redirecting after a successful mutation means a
  refresh does not resubmit, and Back does not land on a half-submitted form.

Validation errors come back through `useActionData()` (or `actionData` in
framework mode). The [forms at scale guide](react-forms-at-scale.md) covers
mapping them onto fields.

## Fetchers: mutations without navigation

Not every mutation should change the URL. A "mark as shipped" button on each row
of a list, a newsletter sign-up in the footer, a like button: these use
`useFetcher`, which calls a loader or action *without* navigating:

```tsx
function ShipButton({ order }: { order: Order }) {
  const fetcher = useFetcher();
  const shipping = fetcher.state !== 'idle';
  const status = fetcher.formData?.get('status') ?? order.status;  // optimistic value
  return (
    <fetcher.Form method="post" action={`/orders/${order.id}/status`}>
      <input type="hidden" name="status" value="shipped" />
      <button disabled={status === 'shipped'}>{shipping ? 'Shipping…' : 'Mark shipped'}</button>
    </fetcher.Form>
  );
}
```

Each fetcher has its own state, so ten rows can be in flight independently,
and `fetcher.formData` holds the submitted values while the request runs,
which is the easiest optimistic UI you will find. Page loaders still
revalidate afterwards.

## Pending UI

`useNavigation()` tells you what the router is doing globally: `state` is
`"idle"`, `"loading"` (a navigation is fetching loaders) or `"submitting"` (a
form is being posted). Use it for a top progress bar or to dim stale content.
Navigations run inside React transitions, so the current page stays on screen
and interactive until the next one is ready, rather than flashing a fallback.

## Errors at the route level

Give a route an `errorElement` (data mode) or export an `ErrorBoundary`
(framework mode). Any error thrown while loading, acting or rendering that route
renders the nearest boundary in place of the route's component, while parent
layouts stay intact:

```tsx
function OrderError() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <p>That order does not exist.</p>;
  return <p>Something went wrong loading this order. <a href=".">Try again</a></p>;
}
```

Throwing `data(..., { status: 404 })` from a loader is how you say "not found"
deliberately, and `isRouteErrorResponse` distinguishes it from a crash. Put a
boundary on the root route as a last resort and on routes with risky data, so a
failing detail pane does not take down the navigation.
[Error boundaries and error UX](react-error-boundaries.md) covers the wider
picture.

## Search params, redirects and protection

- **Search params are state.** Read them with `useSearchParams()` in components
  and with `new URL(request.url).searchParams` in loaders. Changing them is a
  navigation, so loaders re-run. Pass `{ replace: true }` when updating on
  every keystroke so Back is not flooded with entries.
- **Protected routes.** A loader on a pathless layout route checks the session
  and `throw redirect('/login?returnTo=' + encodeURIComponent(url.pathname))`.
  Remember that child loaders start in parallel with it, and that client-side
  checks are UX only: the API must enforce authorisation on every request.
- **Unsaved changes.** `useBlocker(isDirty)` lets you confirm before an in-app
  navigation leaves a dirty form.

## Code splitting and types

In data mode, `lazy: () => import('./routes/report')` loads a route's component
and loader only when it is first matched. Framework mode splits every route
module automatically. Framework mode also generates types per route: import
`Route` from `./+types/<route>` and your loader's return type flows into
`loaderData`, and params are typed from the path, so a renamed field breaks the
build instead of the page.

## What you should be able to answer

- What do nested routes and `<Outlet />` give you when moving between sibling pages?
- Why do route loaders avoid the waterfalls you get with `useEffect` fetching?
- What happens after an action completes, and why redirect after a successful post?
- When would you use a fetcher instead of a `<Form>` navigation?
- How do you return a 404 from a loader and render it differently from a crash?
- Why is a loader-based route guard not enough to protect data?
