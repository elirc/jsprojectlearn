# Error boundaries and error UX

Every React app will throw during render sooner or later: a `null` where an
object was expected, a failed request, a stale chunk after a deploy. The
interview question is what the user sees when it happens. A mid-level answer
knows exactly what boundaries catch, where to put them, and how errors reach
the team's error tracker.

## What a boundary catches, and what it doesn't

An error boundary catches errors thrown while React renders the components
below it: in render itself, in lifecycle methods, and in effects. It replaces
that subtree with fallback UI instead of unmounting the whole app. Without any
boundary, an uncaught render error unmounts everything from the root and the
user gets a blank page.

| Where the error is thrown | Caught by a boundary? |
|---|---|
| Rendering, including a component reading `undefined.name` | Yes |
| `useEffect` / `useLayoutEffect` bodies | Yes |
| A promise rejected and read with `use()` | Yes |
| An async function passed to `startTransition` or a form `action` (React 19) | Yes |
| `onClick` and other event handlers | No |
| `setTimeout`, un-awaited promises, `fetch().then` in an effect | No |
| The boundary component's own render | No, the next boundary up handles it |
| Server rendering | No fallback on the server; see below |

Event handlers run outside rendering, so React has nothing to replace. Handle
those errors where they happen, with `try`/`catch` and state, or push them into
the boundary deliberately (below). The same goes for async work started in an
effect: by the time the promise rejects, the effect has already returned.

On the server, boundaries don't render fallbacks. With streaming SSR, an error
inside a `<Suspense>` boundary makes the server send that boundary's fallback,
and the client retries rendering that part. If the client render succeeds,
React reports the original error through `onRecoverableError`; if it fails
again, the nearest client-side error boundary takes over.

## Writing one: class or library

React 19 still has no hook for this. A boundary is a class component with
`static getDerivedStateFromError` (render the fallback) and optionally
`componentDidCatch` (side effects such as logging):

```tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { fallback: ReactNode; children: ReactNode };

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logError(error, { componentStack: info.componentStack });
  }

  render() {
    return this.state.error ? this.props.fallback : this.props.children;
  }
}
```

[react/37](../../react/37-error-boundary/) builds this from scratch. In
production code most teams use `react-error-boundary`, which adds the parts a
hand-written class usually forgets: a way to reset, and a way to throw from
event handlers.

```tsx
import { ErrorBoundary, useErrorBoundary, type FallbackProps } from 'react-error-boundary';

function Fallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div role="alert">
      <p>We couldn't load your invoices.</p>
      <button onClick={resetErrorBoundary}>Try again</button>
    </div>
  );
}

<ErrorBoundary FallbackComponent={Fallback} resetKeys={[customerId]} onError={logError}>
  <Invoices customerId={customerId} />
</ErrorBoundary>;
```

- **`resetErrorBoundary`** clears the error and re-renders the children. Pair it
  with `onReset` if something else (a cache, a store) must be reset too.
- **`resetKeys`** resets automatically when any value in the array changes, so
  navigating to another customer clears the previous customer's error.
- **`useErrorBoundary`** returns `showBoundary(error)`, which sends an error from
  an event handler or callback to the nearest boundary:

```tsx
const { showBoundary } = useErrorBoundary();
const onExport = async () => {
  try {
    await exportCsv();
  } catch (err) {
    showBoundary(err);
  }
};
```

Only do this for failures that make the whole section unusable. A failed save
usually deserves an inline message next to the button, with the form still
intact.

## Where to put boundaries

Granularity is a UX decision. One boundary at the root turns any error into a
full-page failure; one around every component is noise.

| Level | Wraps | Fallback |
|---|---|---|
| App | Everything, outside routing | Full-page "Something went wrong" with a reload link. The last resort. |
| Route | Each page, inside the layout | Page-level error; header and navigation still work, so the user can go elsewhere |
| Widget | Independent panels: a chart, a recommendations rail, a comments list | Small inline message with retry; the rest of the page carries on |

A good rule: put a boundary around anything that fetches independently and
could fail without making the rest of the page useless. Keep boundaries close
to the `<Suspense>` boundaries that show loading states for the same region, so
loading and error UI appear in the same place.

## React 19 root options

React 19 lets you hook into error reporting on the root itself:

```tsx
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')!, {
  onCaughtError(error, errorInfo) {
    tracker.captureException(error, { extra: { componentStack: errorInfo.componentStack } });
  },
  onUncaughtError(error, errorInfo) {
    tracker.captureException(error, { level: 'fatal', extra: { componentStack: errorInfo.componentStack } });
  },
  onRecoverableError(error) {
    tracker.captureMessage(`Recovered: ${String(error)}`);
  },
}).render(<App />);
```

- **`onCaughtError`** fires for errors an error boundary caught.
- **`onUncaughtError`** fires for errors no boundary caught, which unmount the
  app.
- **`onRecoverableError`** fires when React recovers automatically, for example
  after a hydration mismatch it fixed by client rendering.

`hydrateRoot` accepts the same options. React 19 also stopped logging caught
errors twice, and reports uncaught errors through `window.reportError` by
default. Centralising reporting here means individual boundaries don't need
their own `componentDidCatch`. Sentry's React SDK, for instance, ships a
`reactErrorHandler()` helper designed to be passed to these options.

## Query errors and route errors

TanStack Query catches errors from `queryFn` and returns them as `error` state;
nothing is thrown by default. To send them to a boundary instead, set
`throwOnError`, ideally as a function so only server failures escalate and 4xx
responses stay inline:

```tsx
import { QueryErrorResetBoundary, useQuery } from '@tanstack/react-query';

useQuery({ ...invoiceQueries.list(customerId), throwOnError: (err) => isServerError(err) });

<QueryErrorResetBoundary>
  {({ reset }) => (
    <ErrorBoundary onReset={reset} FallbackComponent={Fallback}>
      <Invoices customerId={customerId} />
    </ErrorBoundary>
  )}
</QueryErrorResetBoundary>;
```

Passing `reset` to `onReset` clears the query's error so "Try again" actually
refetches rather than re-throwing the cached error. `useSuspenseQuery` throws to
the nearest boundary whenever it has no cached data to show. [TanStack Query in depth](tanstack-query-in-depth.md)
covers the rest of the library.

React Router renders a route's `ErrorBoundary` when its loader, action or
component throws. Inside it, `useRouteError()` returns what was thrown, and
`isRouteErrorResponse(error)` distinguishes a deliberate response (a thrown 404
from a loader) from an unexpected exception. The nearest route boundary
handles it, so a failed child route keeps the parent layout on screen.
[React Router v7 concepts](react-router-v7-concepts.md) shows the route setup.

## Chunk-load errors after deploys

With code splitting, each `lazy()` import fetches a hashed file. Deploy a new
version, delete the old files, and a user with the old app open gets a failed
dynamic import the next time they navigate. It surfaces as an error thrown
during render, so a boundary shows it as "Something went wrong", which is
unhelpful and untrue.

Treat it specially: detect it and reload once to pick up the new version.

```ts
window.addEventListener('vite:preloadError', (event) => {
  if (sessionStorage.getItem('reloaded-for-chunk')) return; // avoid a reload loop
  sessionStorage.setItem('reloaded-for-chunk', '1');
  event.preventDefault();
  window.location.reload();
});
```

Vite dispatches `vite:preloadError` when a dynamic import fails. The guard stops
an infinite loop if the chunk is missing for another reason. Keeping the
previous deploy's assets available for a while is the more robust fix.
[Bundle budgets and code splitting](bundle-budgets-and-code-splitting.md) covers
how the chunks are made.

## Error copy, retry and reporting

A fallback is UI, and should be written like UI:

- **Say what failed, in the user's terms.** "We couldn't load your invoices",
  not "Error: Request failed with status code 500".
- **Offer the next step.** A retry button that calls `resetErrorBoundary`, a
  link back to a working page, or both. For offline, say so and retry when the
  connection returns.
- **Keep what works.** A widget failure shouldn't hide the rest of the page, and
  never discard a user's unsaved form input.
- **Announce it.** `role="alert"` makes screen readers read the message, and
  moving focus to the fallback's heading helps keyboard users.
- **Hide internals.** Stack traces belong in the tracker, not on screen.
  Showing a support reference ID that matches the tracker event helps both
  sides.

For reporting, send the error, the component stack, the route, the release
version and the user's ID (not their personal data) to an error tracker. Upload
source maps privately to the tracker so stacks are readable without shipping
maps to users. [Logging and observability](logging-and-observability.md)
covers the backend side of the same story.

## What you should be able to answer

- Which errors does an error boundary catch, and why doesn't it catch errors in event handlers?
- How do you send an error from an event handler or async callback into a boundary?
- Where would you place error boundaries in a dashboard with several independent widgets?
- What do `onCaughtError`, `onUncaughtError` and `onRecoverableError` do in React 19?
- How do you make "Try again" actually refetch when a TanStack Query error reached a boundary?
- What causes chunk-load errors after a deploy, and how do you handle them?
