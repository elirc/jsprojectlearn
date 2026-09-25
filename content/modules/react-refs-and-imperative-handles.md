# Refs, ref callbacks and imperative handles

Refs are React's escape hatch: a way to hold a value without rendering, and to
reach the real DOM. Interviewers ask "what is `useRef` for besides DOM nodes?",
"how does a parent focus an input inside a child?", and what changed in React 19.
The strong answers also say when a ref is the wrong tool.

## A ref is a stable box

```jsx
const ref = useRef(initialValue); // { current: initialValue }
```

React creates the object once and returns the same one on every render. You can
read and write `ref.current` freely, and changing it **does not** trigger a
render. That combination defines when to use one:

| Need | Tool |
| --- | --- |
| Value shown on screen | State |
| Value that must survive renders but is never shown | Ref |
| Value computed from props or state | A plain variable during render |
| Value shared by every instance | Module-level variable |

Typical ref contents: a timer id to clear later, an `AbortController`, the
latest version of a callback, a flag such as "has the user interacted yet", a
third-party widget instance, and DOM nodes.

```jsx
function Stopwatch() {
  const [ms, setMs] = useState(0);
  const intervalRef = useRef(null);

  function start() {
    clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => setMs((m) => m + 10), 10);
  }
  function stop() {
    clearInterval(intervalRef.current);
  }
  // ...
}
```

A local `let intervalId` would be re-declared on every render and lost. State
would work but cause pointless renders every time the id changes.

## Do not read or write refs during render

The React docs' rule: refs are for event handlers and effects. Rendering must
depend only on props, state and context, so that React can replay it safely:

```jsx
// Screen goes stale: clicking changes the ref, nothing re-renders
const clicks = useRef(0);
return <button onClick={() => clicks.current++}>{clicks.current}</button>;
```

The one exception is lazy initialisation. `useRef` has no function form, so
`useRef(new Parser(config))` constructs a parser on every render and discards it.
Initialise it once instead:

```jsx
const parserRef = useRef(null);
if (parserRef.current === null) {
  parserRef.current = new Parser(config);
}
```

## DOM refs

Pass a ref object to a DOM element and React sets `current` to the node during
commit, and back to `null` when it is removed:

```jsx
function Search() {
  const inputRef = useRef(null);
  useEffect(() => {
    inputRef.current.focus();
  }, []);
  return <input ref={inputRef} type="search" />;
}
```

On the first render `inputRef.current` is still `null`, because the node does
not exist until commit. Read DOM refs in effects and handlers. Good uses: focus,
scrolling (`scrollIntoView`), measuring (`getBoundingClientRect`), media
playback, text selection, and handing a node to a non-React library. If you are
setting text or classes through a ref, that is state's job.

For measuring before the user sees the frame (a tooltip that must not flash in
the wrong place), measure in `useLayoutEffect`. For elements that resize, use a
`ResizeObserver` in an effect and `disconnect()` it in cleanup.

## Ref callbacks

Instead of an object, `ref` can take a function. React calls it with the node
when it attaches:

```jsx
<li
  ref={(node) => {
    itemsRef.current.set(item.id, node);
    return () => itemsRef.current.delete(item.id); // React 19 cleanup
  }}
>
```

In React 19 a ref callback may return a cleanup function, which React calls when
the node detaches; before 19 you handled `node === null` instead. Ref callbacks
solve two problems object refs cannot:

- **A ref per list item.** Hooks cannot be called in a loop, so keep one ref
  holding a `Map` from id to node and fill it from each item's callback.
- **Reacting to a node appearing.** An effect with `[ref.current]` never re-runs,
  because writing a ref does not render. A callback runs exactly when the node
  arrives or changes.

Two behaviours to know: an inline callback is a new function each render, so
without a cleanup React calls it with `null` then the node on every render (wrap
it in `useCallback` if that matters); and in development, StrictMode runs attach,
cleanup, attach on mount to check your cleanup.

## Passing refs to your own components

In React 19, `ref` is an ordinary prop for function components:

```jsx
function TextField({ label, ref, ...props }) {
  return (
    <label>
      {label}
      <input ref={ref} {...props} />
    </label>
  );
}

// Parent
const emailRef = useRef(null);
<TextField label="Email" ref={emailRef} />;
emailRef.current.focus();
```

`forwardRef` is no longer needed. Existing `forwardRef` code still works and can
be migrated with a codemod. Class components have always received refs directly.
Typing these props in TypeScript is covered in
[TypeScript in React](typescript-in-react.md).

## useImperativeHandle: expose a small API

Handing a parent the raw `<input>` lets it change anything behind the child's
back. `useImperativeHandle` lets the child decide what the parent can do:

```jsx
function VideoPlayer({ src, ref }) {
  const videoRef = useRef(null);
  useImperativeHandle(ref, () => ({
    play: () => videoRef.current.play(),
    pause: () => videoRef.current.pause(),
  }), []);
  return <video ref={videoRef} src={src} />;
}
```

The parent's `ref.current` is now `{ play, pause }`, not the video element. The
third argument works like memo dependencies: the handle is only recreated when
they change. Keep the handle small and verb-shaped (`focus`, `scrollToBottom`,
`reset`). If you find yourself exposing `setValue`, the component probably wants
to be controlled with props instead.

## When a ref is the wrong tool

| Temptation | Better |
| --- | --- |
| Show a value from a ref on screen | State |
| `document.querySelector` inside a component | A ref on the element |
| Parent calls `child.open()` to show a dialog | An `open` prop, lifted state |
| Guard an effect with `useRef(false)` so it "runs once" | Write the cleanup; see [StrictMode](react-strict-mode.md) |
| Store a copy of props "to compare later" in render | Derive during render, or compare in an effect |

Imperative calls are for things that are genuinely actions, such as focus,
scroll and play, not for state that could be expressed declaratively. Practise
in [react/26-refs-for-values](../../react/26-refs-for-values/) and
[react/52-accessible-modal-focus](../../react/52-accessible-modal-focus/).

## What you should be able to answer

- What is `useRef` for besides DOM nodes? Give two examples.
- Why does changing `ref.current` not update the screen, and when is that what
  you want?
- Why is `inputRef.current` `null` during the first render?
- How does a parent focus an input inside a child component in React 19?
- What problems do ref callbacks solve that ref objects cannot?
- Why expose `{ focus }` with `useImperativeHandle` instead of the whole node?
