# useReducer: modelling state as events

"When would you use `useReducer` instead of `useState`?" is a standard
mid-level question, and "when state is complex" is the weak answer. The strong
answer talks about transitions: several values that must change together,
updates described as events, and logic you can test without rendering anything.

## The shape

```jsx
const [state, dispatch] = useReducer(reducer, initialState);

function reducer(state, action) {
  switch (action.type) {
    case 'item_added':
      return { ...state, items: [...state.items, action.item] };
    case 'item_removed':
      return { ...state, items: state.items.filter((i) => i.id !== action.id) };
    default:
      throw new Error(`Unknown action: ${action.type}`);
  }
}
```

Components call `dispatch({ type: 'item_added', item })`. React calls
`reducer(currentState, action)` and renders with whatever it returns. There is
no setter, so every change goes through one function you can read top to bottom.

## Three rules for reducers

**1. Pure.** Same state and action in, same state out. No requests, no timers,
no `Date.now()` or `Math.random()` inside (pass them in on the action). React may
call a reducer more than once: StrictMode does so on purpose in development, and
rendering can be replayed. A `fetch` in a reducer sends duplicate requests.

**2. Never mutate.** React compares the returned state with `Object.is`. Return
the same object, even a mutated one, and React treats it as "no change":

```jsx
// Bug: mutates and returns the same object, so the screen does not update
case 'incremented':
  state.count++;
  return state;
```

Returning the unchanged `state` on purpose is the correct way to say "this action
does nothing here".

**3. Always return something.** A `switch` without a `default` returns
`undefined` for an unknown type, and a typo such as `'rest'` for `'reset'` wipes
your state. Throwing in `default` makes typos fail loudly.

## Name actions after events, not setters

```jsx
// Setter-style: the logic lives in the component again
dispatch({ type: 'set_items', items: [...items, item] });
dispatch({ type: 'set_total', total: total + item.price });

// Event-style: one action, the reducer decides what changes
dispatch({ type: 'item_added', item });
```

One event can update several fields consistently: adding an item updates the
list, the total and the "empty" flag in one step, so they can never disagree.
Event names also make a log of actions read like a history of what the user did,
which is how Redux DevTools time-travel works.

## Lazy initialisation

The third argument builds the initial state once:

```jsx
function createInitialState(userId) {
  return { userId, draft: loadDraft(userId), status: 'idle' };
}

const [state, dispatch] = useReducer(reducer, userId, createInitialState);
```

React calls `createInitialState(userId)` on mount only, like the function form of
`useState`. Writing `useReducer(reducer, createInitialState(userId))` would call
it every render and throw the result away. Later changes to `userId` are ignored;
to restart for a new user, remount with `key={userId}`.

## Dispatch behaves like a setter

- `dispatch` has a stable identity, so you can pass it down or leave it out of
  effect dependencies.
- Actions are queued, not applied immediately. After `dispatch`, the `state`
  variable in your handler is still the current render's snapshot.
- Multiple dispatches in one event are processed in order, each reducer call
  receiving the previous result, then rendered once.

```jsx
function onClick() {
  dispatch({ type: 'incremented' });
  dispatch({ type: 'incremented' });
  console.log(state.count); // still the old value
}
// After the render: count went up by 2
```

If you need the next state inside the handler, compute it: `reducer(state, action)`.

## Typing it with TypeScript

A union of actions gives you autocompletion on `dispatch` and an exhaustiveness
check in the reducer:

```ts
type Action =
  | { type: 'item_added'; item: Item }
  | { type: 'item_removed'; id: string }
  | { type: 'cleared' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'item_added':
      return { ...state, items: [...state.items, action.item] };
    case 'item_removed':
      return { ...state, items: state.items.filter((i) => i.id !== action.id) };
    case 'cleared':
      return { ...state, items: [] };
    default: {
      const unreachable: never = action;
      throw new Error(`Unhandled action ${JSON.stringify(unreachable)}`);
    }
  }
}
```

Inside each `case`, `action` is narrowed, so `action.item` only exists where it
should. Add a fourth action type without a case and the `never` assignment stops
compiling. More in [TypeScript in React](typescript-in-react.md) and
[discriminated unions](typescript-discriminated-unions.md).

## useState or useReducer?

| Signal | Prefer |
| --- | --- |
| One or two independent values | `useState` |
| Several values that must change together | `useReducer` |
| The next state depends on the previous one in several places | `useReducer` |
| Update logic is spread across many handlers | `useReducer` |
| You want to unit-test transitions | `useReducer` |
| A simple toggle or input value | `useState` |

They are interchangeable in power (`useState` is implemented on top of the same
machinery), so this is about readability. A reducer that just mirrors setters is
worse than the `useState` calls it replaced.

## Reducers with context

For a feature where many nested components change the same state, put the reducer
in the feature's root component and share `state` and `dispatch` through context.
Because `dispatch` never changes, components that only dispatch can read it from
a separate context and skip re-renders when state changes. This is the core of
most "build your own store" answers; weigh it against a store library before
applying it app-wide (see [server and client state](server-and-client-state.md)).

## Testing

A reducer is a plain function, so tests need no rendering:

```js
import { expect, test } from 'vitest';

test('removing an item keeps the others', () => {
  const start = { items: [{ id: 'a' }, { id: 'b' }] };
  const next = reducer(start, { type: 'item_removed', id: 'a' });
  expect(next.items).toEqual([{ id: 'b' }]);
  expect(start.items).toHaveLength(2); // not mutated
});
```

Test the tricky transitions here, and keep component tests for wiring and
behaviour. Build one in [react/13-usereducer-todo](../../react/13-usereducer-todo/)
and extend it with undo in [react/40-undo-redo](../../react/40-undo-redo/).

## What you should be able to answer

- When would you choose `useReducer` over `useState`? Give a concrete signal, not
  "complex state".
- Why must a reducer be pure, and what happens to a `fetch` inside one?
- A reducer mutates `state` and returns it. What does the user see, and why?
- What does the third argument to `useReducer` do?
- Why name actions after events rather than fields?
- How does a `never` check in `default` help when a new action is added?
