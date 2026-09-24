# React 19 in practice: what changed since the handbook

**About the React track.** Its projects load React 18 from a CDN as UMD scripts
with in-browser Babel, so they run from a plain HTML file. React 19 dropped UMD
builds, so those projects stay on 18. Nothing in them is wrong under 19: state,
props, effects, keys, reducers, context and custom hooks all work the same. The
handbook's mental model still holds. What 19 adds is less boilerplate for
things you already build by hand.

Interviewers in 2026 ask about actions, `useOptimistic`, the React Compiler and
"what is a Server Component?". A candidate who only knows the 2022 answers
sounds dated, even if their fundamentals are sound. This guide covers the
changes, and which of them you'll actually use in a CRUD app.

## What changed and when

| Release | Date | Headline |
|---|---|---|
| 19.0 | Dec 2024 | Actions, `useActionState`, `useOptimistic`, `use`, ref as a prop, Server Components stable |
| 19.1 | Mar 2025 | Owner stacks for debugging, Suspense fixes |
| 19.2 | Oct 2025 | `<Activity>`, `useEffectEvent`, performance tracks in DevTools |
| Compiler 1.0 | Oct 2025 | Automatic memoisation, stable |

19.0 also removed long-deprecated APIs: `ReactDOM.render` (use `createRoot`),
string refs, `propTypes` checks and `defaultProps` on function components
(use default parameters).

## Actions and async transitions

An **action** is a function that runs inside a transition. In 19,
`startTransition` accepts async functions, and React tracks the pending state
for you:

```jsx
const [isPending, startTransition] = useTransition();

function onSave() {
  startTransition(async () => {
    const error = await saveOrder(order);
    if (error) setError(error);
  });
}
```

Forms accept a function as `action`. React calls it with the form's
`FormData`, and resets uncontrolled fields once it succeeds:

```jsx
<form action={async (formData) => { await createOrder(formData); }}>
  <input name="sku" required />
  <button>Add</button>
</form>
```

This is the same submit model as plain HTML, which [the HTML
guide](html-semantics-and-forms.md) covers. Native validation still runs first.

## `useActionState` and `useFormStatus`

[react/44](../../react/44-async-submit/) tracks `isSubmitting`, `error` and the
result by hand, with a `try/finally` to reset the flag. `useActionState`
collapses that:

```jsx
import { useActionState } from 'react';

async function addOrder(prevState, formData) {
  const res = await fetch('/api/orders', { method: 'POST', body: formData });
  if (!res.ok) return { error: 'Could not save the order' };
  return { error: null };
}

function NewOrder() {
  const [state, formAction, isPending] = useActionState(addOrder, { error: null });
  return (
    <form action={formAction}>
      <input name="sku" required />
      <button disabled={isPending}>Save</button>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}
```

The action receives the previous state first and the `FormData` second, and
whatever it returns becomes the new state. `useActionState` was called
`useFormState` in the 19 canaries; old tutorials use that name.

`useFormStatus` comes from **`react-dom`**, not `react`. It reads the pending
state of the nearest parent `<form>`, so it only works in a component rendered
*inside* the form. It's for a reusable `<SubmitButton>` that doesn't need
props.

## `useOptimistic`

[react/39](../../react/39-optimistic-updates/) applies a change immediately,
keeps a snapshot, and restores it if the request fails. `useOptimistic` does
the rollback for you:

```jsx
const [optimisticTodos, addOptimistic] = useOptimistic(
  todos,
  (current, newTodo) => [...current, { ...newTodo, pending: true }],
);

async function add(formData) {
  const todo = { title: formData.get('title') };
  addOptimistic(todo);
  await createTodo(todo);      // on success, update the real `todos` state
}
```

The optimistic value exists only while the action is pending. When it
finishes, React renders from the real `todos` again. If the request failed and
you never updated `todos`, the optimistic item simply disappears; that's the
rollback. You still show the error yourself. It must be called inside an action
or `startTransition`. If you use a query library, it has its own optimistic
pattern; [the state guide](server-and-client-state.md) compares the two.

## `use()`

`use` reads a resource during render. Unlike other hooks, it can be called
inside `if` statements and loops.

```jsx
function OrderDetails({ orderPromise }) {
  const order = use(orderPromise);   // suspends until resolved
  return <h2>{order.title}</h2>;
}

<Suspense fallback={<Spinner />}>
  <OrderDetails orderPromise={orderPromise} />
</Suspense>
```

**Suspending** means the component throws control back to React while the
promise is pending; React shows the nearest `<Suspense>` fallback and retries
when it resolves. A rejection goes to the nearest error boundary. The promise
must be created outside render (by a loader, a parent or a cache). A promise
created during render is recreated on every render, so it suspends forever. `use(Context)`
also works, and can be called conditionally, which `useContext` cannot.

## Smaller changes you'll see in code review

- **`ref` is a regular prop** on function components. `forwardRef` is no longer
  needed and will be deprecated.
- **Ref callbacks can return a cleanup function**, like an effect.
- **`<Context value={theme}>`** works as a provider; `<Context.Provider>` is on
  its way out.
- **Document metadata:** render `<title>`, `<meta>` and `<link>` anywhere and
  React hoists them into `<head>`.
- **`<Activity mode="hidden">`** (19.2) hides a subtree but keeps its state, so a
  tab you switch away from keeps its scroll position and form input.
- **`useEffectEvent`** (19.2) wraps a function that reads the latest props and
  state without being an effect dependency. It fixes the "I only want to
  reconnect when `roomId` changes, not when `theme` changes" problem. Call it
  only from effects, and leave it out of the dependency array.

## The React Compiler

The Compiler is a build-time plugin that memoises components and values
automatically. It is opt-in: in a Vite app you add `babel-plugin-react-compiler`
through the React plugin's Babel options, and some frameworks offer a config
flag.

"Do you still write `useMemo`?" In a codebase with the Compiler on, mostly no.
It covers what [react/27](../../react/27-usememo/) and
[react/28](../../react/28-memo-usecallback/) do by hand. Existing `useMemo` and
`useCallback` calls are safe to leave in. You still reach for them when a
memoised value is an effect dependency and you need exact control. Without the
Compiler, the old advice stands: measure first, then memoise.

It depends on the **rules of React**: components are pure, props and state are
never mutated, hooks are called unconditionally. Code that breaks them is
skipped, which is one more reason to run the React Hooks ESLint rules.

## Server Components and Server Functions

A **Server Component** runs only on the server or at build time. It can be
`async`, read a database directly, and ships no JavaScript to the browser. It
cannot use state, effects or event handlers. A file marked `'use client'` starts
a boundary; components from there down are ordinary **client components**,
rendered on the server for the first HTML and then hydrated.

**Server Functions** (called "Server Actions" until late 2024) are functions
marked `'use server'` that the client can call like a local function; the
framework turns the call into a POST. They're the natural target for a form
`action`, and let forms work before JavaScript loads.

Both need a bundler and server that understand the boundary, which in practice
means a framework such as Next.js. A Vite SPA talking to a separate API, like
DevPath, doesn't use them, and doesn't need to.

## Strict Mode's double invocation

In development, Strict Mode renders components twice and runs every effect's
setup, cleanup, then setup again. That surfaces missing cleanup, which
[react/17](../../react/17-effect-deps/) and
[react/18](../../react/18-effect-cleanup/) cover. It doesn't happen in
production builds.

## The framework map

| Option | What it is | Pick it when |
|---|---|---|
| Create React App | Deprecated in Feb 2025 | Never, for new work |
| Vite SPA | Client-rendered app with any router | Dashboards and internal tools behind a login, separate API |
| React Router v7, framework mode | The successor to Remix: loaders, actions, SSR | You want SSR and data loading without leaving React Router |
| Next.js App Router | Server Components, Server Functions, SSR and static rendering | Public, SEO-sensitive sites, or a team already on Next |
| TanStack Start | Full-stack framework built on TanStack Router | Type-safe routing is the priority |

**Forms: actions or React Hook Form + Zod?** Actions and `useActionState`
suit simple forms, and forms that post to Server Functions. React Hook Form with
a Zod schema wins for large forms with field-level validation as you type,
dependent fields and dynamic arrays, and the same Zod schema can validate on
the server. Both are normal in 2026 codebases.

## What you should be able to answer

- What problem do actions and `useActionState` solve?
- How does `useOptimistic` roll back when a request fails?
- With the React Compiler on, do you still write `useMemo`?
- What's the difference between a Server Component and a client component?
- Why does my effect run twice in development?
- Why can't you call `use()` on a promise created during render?
