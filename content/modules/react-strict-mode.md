# StrictMode: what it does and what it is telling you

"Why does my effect run twice?" is one of the most searched React questions, and
interviewers use it to see whether you fight the framework or understand it.
`<StrictMode>` is a development-only checker. Everything it does is designed to
make a latent bug visible now instead of in production.

## What it is

```jsx
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

It renders no UI and does nothing in a production build. You can wrap the whole
app (the default in Vite and framework templates) or only part of the tree. In
development it enables a set of extra checks for everything inside it.

## Check 1: double rendering

React calls these functions twice in development and keeps one result:

- component bodies
- `useState`, `useMemo` and `useReducer` initialisers
- state updater functions (`setX((prev) => ...)`)
- reducers
- class `constructor`, `render` and `shouldComponentUpdate`

Pure functions give the same answer twice, so nothing changes. Impure ones show
themselves:

```jsx
// Mutates its input: under StrictMode the item can be pushed twice
setItems((prev) => {
  prev.push(item);
  return [...prev];
});

// Fixed: pure, safe to call any number of times
setItems((prev) => [...prev, item]);
```

In React 19 the console output of the second call is dimmed, which is why you see
a log twice with the second one greyed out. React relies on render purity for
concurrent features: a transition may render a component, throw the result away
and render it again. StrictMode simulates that.

## Check 2: effects run setup, cleanup, setup

On mount, StrictMode runs every effect, immediately runs its cleanup, then runs
it again. Ref callbacks get the same treatment in React 19: attach, cleanup,
attach. The point is to prove each effect can be torn down and re-created, which
real apps do all the time: navigating away and back, Fast Refresh, and React
19.2's `<Activity>` hiding and showing a subtree.

What you see, and what it means:

| Symptom in development | Diagnosis |
| --- | --- |
| Chat connects, disconnects, connects | Correct: your cleanup works |
| Two connections stay open | Missing cleanup: you would leak one per navigation in production |
| First fetch shows as "cancelled" in the Network tab | Correct: cleanup aborted it |
| Two identical fetches both complete | No cleanup; harmless for a GET, but a race waiting to happen |
| An interval ticks twice as fast | Missing `clearInterval` |
| Two analytics page views | Harmless dev-only duplicate; production sends one |

The fix is almost never "make it run once". It is "make the second run harmless",
which usually means writing the cleanup:

```jsx
useEffect(() => {
  const controller = new AbortController();
  fetch(`/api/users/${id}`, { signal: controller.signal })
    .then((r) => r.json())
    .then(setUser)
    .catch((e) => {
      if (e.name !== 'AbortError') setError(e);
    });
  return () => controller.abort();
}, [id]);
```

See [effects as synchronisation](react-effects-as-synchronisation.md) for the full
setup/cleanup model.

## The ref-guard anti-pattern

A common "fix" is a ref flag:

```jsx
const ran = useRef(false);
useEffect(() => {
  if (ran.current) return;
  ran.current = true;
  connect(); // never disconnected
}, []);
```

This silences the symptom and keeps the bug: there is still no cleanup, so a real
unmount and remount (navigating back to the page) leaks a connection, and the
effect now ignores dependency changes. Write the cleanup instead.

If something genuinely must run once per **app load**, such as initialising an
SDK, it is not tied to any component's lifetime. Put it at module level or guard
it with a module variable:

```jsx
let didInit = false;

function App() {
  useEffect(() => {
    if (didInit) return;
    didInit = true;
    initAnalytics();
  }, []);
  // ...
}
```

A ref resets when the component remounts; a module variable does not.

## Check 3: deprecated and unsafe APIs

StrictMode also warns about legacy class lifecycles such as
`componentWillMount` and `componentWillReceiveProps` (the `UNSAFE_` family),
which are incompatible with concurrent rendering. In React 19 many older APIs are
simply gone: string refs, legacy context, `ReactDOM.render`. Earlier versions of
StrictMode warned about those; now the code fails instead.

## What StrictMode does not do

- It does not affect production: no double renders, no double effects.
- It does not double-dispatch events. A click runs its handler once.
- It does not re-run effects on every render, only the extra mount cycle.
- It does not make an impure component pure; it only makes the impurity visible.

Knowing these limits is what lets you tell a real bug from dev-only noise. If a
test in Vitest or Jest behaves differently from the browser, check whether one
of them renders inside StrictMode.

## Should you ever turn it off?

Rarely. Turning it off because effects run twice removes the warning and keeps
the leak. The legitimate cases are narrow: a third-party library that genuinely
cannot survive remounts (and should be wrapped in a component that handles it),
or bisecting a problem temporarily. Prefer fixing the effect, or wrapping only
the offending subtree outside StrictMode while you do.

## A worked example

```jsx
function Stopwatch() {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setMs((m) => m + 100), 100);
  }, []);
  return <p>{ms / 1000}s</p>;
}
```

In development the clock runs at double speed. The double speed is StrictMode's
second setup; the bug is the missing `return () => clearInterval(id)`. Without
StrictMode the same bug would appear later as a stopwatch that keeps counting
after the page is left and doubles when the user returns. Practise this in
[react/47-stopwatch-react](../../react/47-stopwatch-react/) and
[react/18-effect-cleanup](../../react/18-effect-cleanup/).

## What you should be able to answer

- What does `<StrictMode>` do in development, and what does it do in production?
- Which functions does it call twice, and what kind of bug does that expose?
- Your effect logs "connected, disconnected, connected" in development. Is that a
  bug?
- Why is a `useRef` guard the wrong fix for an effect that runs twice?
- How do you make code run once per app load rather than once per mount?
- Name two things StrictMode does not do.
