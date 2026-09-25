# Profiling React performance

"This page is slow. What do you do?" is one of the most common mid-level
React questions, and the weakest answer is "wrap things in `useMemo`". A strong
answer is a method: reproduce, measure, find the cause, fix the cause, measure
again. This guide is that method, with the tools that exist in 2026.

## Name the kind of slow first

Slowness has different causes, and each has a different tool. Ask what the
user actually experiences:

| Symptom | Likely cause | First tool |
|---|---|---|
| Blank screen for seconds on first visit | Large bundle, slow API, request waterfall | Network panel, Lighthouse, bundle analyser |
| Typing or clicking feels laggy | Too much rendering or JavaScript per interaction | React Profiler, Performance panel |
| Scrolling stutters | Too many DOM nodes, layout thrash | Performance panel, element count |
| Spinner after every navigation | Fetching after render, no caching | Network panel, query devtools |

The rest of this guide is about the second and third rows: interaction cost.
Loading performance is covered in [browser rendering and the network](browser-rendering-and-network.md).

The metric that captures interaction cost is **Interaction to Next Paint
(INP)**, a Core Web Vital since 2024: the time from a click, tap or key press
until the browser paints the result. Aim for 200 ms or less at the 75th
percentile of real users. Long tasks on the main thread, often React rendering
too much, are what push it up; [Core Web Vitals in depth](core-web-vitals-in-depth.md)
breaks INP into its parts.

## Profile a production build

Development React does extra work: Strict Mode double-renders, prop-type and
key warnings, and the dev build of every library. It can be several times
slower than production, so timings from `npm run dev` exaggerate problems and
hide the real ratio between components.

Build for production and profile that. React ships a profiling build
(`react-dom/profiling`) that keeps the Profiler working in production mode;
most bundlers can alias to it with a flag. Also throttle the CPU (4x or 6x in
the Performance panel): your laptop is much faster than your users' phones.

## The React DevTools Profiler

Record, perform the slow interaction once, stop. You get a list of **commits**
(each time React applied changes to the DOM) and, for each commit:

- **Flame graph**: the component tree, coloured by how long each component
  took to render in that commit. Grey means it did not render.
- **Ranked chart**: the same components sorted by render time. Start here.
- **Why did this render?**: enable "Record why each component rendered while
  profiling" in the Profiler settings. It reports "Props changed: (onSelect)",
  "State changed", "Context changed", "Hook 3 changed" or "The parent
  component rendered".

The last one is the most useful line in the whole tool. "Props changed:
(onSelect)" on a memoised row tells you a function prop is recreated each
render. "The parent component rendered" on a thousand rows tells you a state
update is placed too high.

Two more DevTools features help:

- **Highlight updates when components render** flashes an outline around every
  component that renders. Type in a search box and watch: if the whole page
  flashes, state is in the wrong place.
- The `<Profiler id onRender>` component logs `actualDuration` (time spent
  rendering this commit, with memoisation) and `baseDuration` (estimated time
  to render the subtree from scratch). A large gap means memoisation is
  working; no gap on a slow subtree means it is not.

## The browser Performance panel

The React Profiler shows render time only. The Performance panel shows the
whole main thread: scripting, style recalculation, layout, paint and garbage
collection. Record the interaction and look for **long tasks** (red-flagged,
over 50 ms).

React 19.2 adds **Performance Tracks** to Chrome DevTools: a Scheduler track
showing what React is working on and at which priority (blocking updates versus
transitions), and a Components track showing which components rendered and
for how long, aligned with everything else on the timeline. That makes it easy
to answer "is this long task React rendering, or my own code, or layout?"

## Fix the cause, not the symptom

Most render problems come from a handful of causes. Fix them in this order,
because the early fixes are structural and free:

1. **State too high.** A search box's text lives in the page component, so every
   keystroke re-renders the page's grid. Move the state down into the
   component that uses it ([react/29](../../react/29-state-colocation/)).
2. **Content lifted instead of passed as children.** A component with fast
   state that renders an expensive subtree can accept that subtree as
   `children`, which React then skips.
3. **Unstable props into memoised children.** Inline objects, arrays and
   functions are new every render, which defeats `memo`.
4. **Expensive work in render.** Filtering and sorting 10,000 rows on every
   render; cache it with `useMemo` keyed on the inputs ([react/27](../../react/27-usememo/)).
5. **Too many DOM nodes.** Rendering 5,000 rows means 5,000 rows to diff and
   lay out. Virtualise ([react/54](../../react/54-list-virtualization/)) or
   paginate.

## Memoisation, and what the Compiler changes

`memo`, `useMemo` and `useCallback` let React skip work when inputs have not
changed. They cost memory and comparisons, and they only work when *every*
prop is stable, which is why hand-applied memoisation is so often useless
([react/28](../../react/28-memo-usecallback/)).

React Compiler 1.0 applies memoisation automatically at build time, at a finer
grain than people do by hand, including JSX elements and inline callbacks. With
the Compiler enabled:

- Most manual `useMemo`, `useCallback` and `memo` become unnecessary. Leave
  existing ones; remove them only with tests in place.
- It relies on the Rules of React. Components that mutate props or state during
  render are skipped (the ESLint plugin reports them), so they keep their old
  behaviour.
- It does not fix structural problems: state placed too high, broad contexts,
  huge lists or slow effects are still yours to fix.

So the Compiler moves the conversation from "did you remember `useCallback`?"
to "is your state in the right place, and is the work necessary at all?"

## When rendering is necessary but slow

Sometimes the work is real: a chart with thousands of points, a big filtered
list. Then change *when* it happens rather than *whether*:

- **`useDeferredValue`** renders the expensive part with a lagging copy of a
  value, so typing stays responsive and the list catches up.
- **`startTransition`** marks an update as non-urgent, so React can interrupt
  it to handle input and keep the current screen visible (`isPending` gives
  feedback).
- **Debounce** the *request*, not the render: `useDeferredValue` does not reduce
  API calls.
- **Web Workers** for pure computation such as parsing a large CSV, so the
  main thread stays free.
- **Code splitting** with `lazy` for heavy screens and editors that most users
  never open, so their cost is not paid on first load ([bundle budgets and code splitting](bundle-budgets-and-code-splitting.md)).

```tsx
const [query, setQuery] = useState('');
const deferredQuery = useDeferredValue(query);
const isStale = query !== deferredQuery;

return (
  <>
    <input value={query} onChange={e => setQuery(e.target.value)} />
    <div style={{ opacity: isStale ? 0.6 : 1 }}>
      <ResultsList query={deferredQuery} />   {/* memoised, re-renders when deferredQuery changes */}
    </div>
  </>
);
```

## A worked answer

"The orders page lags when typing in the filter box." A good interview answer:

1. Reproduce on a production build with CPU throttling, and note the INP or
   the long task in the Performance panel.
2. Record in the React Profiler with "why did this render" on. Find that
   `OrdersTable` and 500 `OrderRow`s re-render on each keystroke because the
   filter text lives in `OrdersPage`.
3. Fix the structure: keep the input's text local, and pass a deferred or
   debounced filter value down.
4. If rows still re-render, check "Props changed" for unstable callbacks, or
   rely on the Compiler. If the list is long, virtualise.
5. Measure again and compare commit durations, so the claim "faster" has a
   number attached.

## What you should be able to answer

- Why must you profile a production build, and how do you still get Profiler data from one?
- What does "why did this render" tell you, and how do you act on "The parent component rendered"?
- What is INP, and what typically makes a React app's INP poor?
- What does the React Compiler fix automatically, and what does it leave to you?
- When would you use `useDeferredValue` versus debouncing versus a Web Worker?
- Walk through how you would diagnose a laggy filter box on a large table.
