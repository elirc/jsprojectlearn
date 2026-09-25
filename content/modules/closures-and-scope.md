# Closures and scope

Closures are the most-asked JavaScript topic in phone screens, because every
other hard question — stale React state, `setTimeout` in a loop, memory leaks in
a long-running Node process — turns out to be a scope question in disguise. A
mid-level answer is not "a function inside a function"; it is being able to say
exactly which variable a piece of code will see, and for how long it lives.

## Scope is decided by where you write the code

JavaScript uses **lexical scope**: a function can see the variables that were
in scope where it was *written*, not where it is *called*. Lookups walk outwards
through the nested scopes until the name is found, or fail with a
`ReferenceError`.

```js
const currency = 'GBP';

function makeFormatter() {
  const symbol = '£';
  return (pence) => `${symbol}${(pence / 100).toFixed(2)} ${currency}`;
}

const format = makeFormatter();
console.log(format(1999)); // £19.99 GBP
```

`format` is called at the top level, but it still reads `symbol`, because the
arrow function was created inside `makeFormatter`. That is the entire idea.

There are four kinds of scope you will meet:

| Scope | Created by | Holds |
|-------|------------|-------|
| Module (or script) | each file | top-level `const`, `let`, `function`, `class` |
| Function | every function call | parameters, `var`, inner declarations |
| Block | `{ }`, `if`, `for`, `try` | `let`, `const`, `class` |
| Global | the runtime | `globalThis` properties; `var` in a *classic browser script* |

In ES modules and CommonJS files, top-level declarations are private to the
file. Only a classic `<script>` puts `var` declarations on `window`.

## `var`, `let`, `const` and the temporal dead zone

`var` is function-scoped and hoisted with the value `undefined`. `let` and
`const` are block-scoped, and although they are also hoisted, reading them
before the declaration line throws. The window between the start of the block
and the declaration is the **temporal dead zone** (TDZ).

```js
function show() {
  console.log(typeof early); // undefined: var is hoisted as undefined
  var early = 1;
  try {
    console.log(late);
  } catch (e) {
    console.log(e.name); // ReferenceError: TDZ
  }
  let late = 2;
}
show();
```

Function declarations are hoisted with their body, which is why you can call a
helper defined lower in the file. Function *expressions* assigned to `const` are
not callable before their line.

The practical rules: use `const` by default, `let` when you reassign, and never
`var` in new code. `const` stops reassignment, not mutation — `const cart = []`
can still be pushed to. See [immutability and copying](immutability-and-copying.md).

## What a closure actually is

A **closure** is a function together with the scope it was created in. The
function keeps a live reference to the *variables*, not a snapshot of their
values.

```js
function createCounter() {
  let count = 0;
  return {
    increment: () => ++count,
    current: () => count,
  };
}

const a = createCounter();
const b = createCounter();
a.increment();
a.increment();
b.increment();
console.log(a.current(), b.current()); // 2 1
```

Each call to `createCounter` creates a fresh `count`, and both functions in the
returned object share it. There is no way to reach `count` from outside except
through those functions, which is why closures were the original way to get
private state in JavaScript (before `#private` class fields).

Because the closure holds the variable, later changes are visible:

```js
let rate = 0.2;
const withVat = (net) => net * (1 + rate);
rate = 0.05;
console.log(withVat(100)); // 105
```

If you want a snapshot, copy the value into a new variable at creation time.

## The loop question, and why `let` fixes it

This is asked in some form in almost every JavaScript interview:

```js
for (var i = 0; i < 3; i++) {
  setTimeout(() => console.log('var', i), 0);
}
for (let j = 0; j < 3; j++) {
  setTimeout(() => console.log('let', j), 0);
}
// var 3, var 3, var 3, let 0, let 1, let 2
```

With `var` there is one `i` for the whole function; by the time the callbacks
run the loop has finished and `i` is 3. With `let`, the specification creates a
**new binding per iteration** and copies the current value into it, so each
callback closes over its own `j`. The old fix was an IIFE that passed `i` in as
a parameter; today you just use `let`.

The same bug appears without timers whenever you build callbacks in a loop and
call them later: event handlers, `promises.push(() => fetch(urls[i]))`, or an
array of validators.

## Closures you write every week

Most closures in real code are not puzzles. They are factories and wrappers:

```js
function once(fn) {
  let called = false;
  let result;
  return (...args) => {
    if (!called) {
      called = true;
      result = fn(...args);
    }
    return result;
  };
}

const init = once(() => { console.log('connecting'); return 'db'; });
console.log(init(), init()); // logs "connecting" once, then: db db
```

The same shape gives you `debounce` (the timer id lives in the closure — see
[../../28-debounce-throttle/](../../28-debounce-throttle/)), `memoize` (the
cache lives in the closure — [../../27-memoize/](../../27-memoize/)), and
configured helpers such as `const logError = createLogger('orders')`.

Partial application is a closure too:

```js
const requireField = (field) => (body) =>
  body[field] == null ? `${field} is required` : null;

const checks = ['email', 'name'].map(requireField);
console.log(checks.map((check) => check({ email: 'a@b.co' }))); // [ null, 'name is required' ]
```

## Stale closures

A **stale closure** is a function that captured a variable from an earlier run
and keeps seeing that old value. It is the classic React bug: a
`setInterval` inside `useEffect(..., [])` captures the `count` from the first
render and logs 0 forever. The mechanism is pure JavaScript:

```js
function render(count) {
  const log = () => console.log('count is', count);
  return log;
}

const first = render(0);
render(1); // a "re-render" creates a new count, but first still has its own
first(); // count is 0
```

Every render is a new function call with new variables, so a callback created
during render 1 only ever sees render 1's values. The fixes are the ones React
documents: list the value as an effect dependency, use a functional update
(`setCount(c => c + 1)`), or keep the latest value in a ref — covered in
depth in [effect dependencies and stale closures](react-effect-dependencies-stale-closures.md). See
[../../react/19-fetch-race/](../../react/19-fetch-race/) for the async version
of the same problem.

## Closures and memory

A closure keeps its scope alive for as long as the closure itself is reachable.
That is usually what you want, but in a long-running Node process it can hold
far more than you meant to:

```js
function track(rows) {
  const count = rows.length;
  return () => console.log(count); // V8 keeps only what the closure uses
}

const loadUser = (id) => ({ id, name: `user ${id}` });
const cache = new Map();
function getUser(id) {
  if (!cache.has(id)) cache.set(id, loadUser(id)); // grows for ever
  return cache.get(id);
}

track([1, 2, 3])(); // 3
console.log(getUser(7).name, cache.size); // user 7 1
```

Modern engines only retain variables a closure actually references, so
`track` does not pin `rows`. The real leaks are closures stored somewhere
long-lived — an event listener that is never removed, or a module-level cache
with no size limit or expiry. Remove listeners when you are done
(`AbortController` signals make this easy) and bound your caches (an LRU, as in
[../../41-lru-cache/](../../41-lru-cache/), or a `WeakMap` keyed by objects — see
[Maps, Sets and weak references](maps-sets-and-weak-refs.md)).

## Closures versus classes

Anything you can do with a closure you can do with a class, and vice versa.

| | Closure factory | Class |
|---|---|---|
| Private state | variables in scope | `#private` fields |
| `this` pitfalls | none | methods lose `this` when passed as callbacks |
| Memory per instance | one copy of each function | methods shared on the prototype |
| `instanceof` | not available | available |

For a small unit of behaviour with a couple of functions, a closure is shorter
and has no `this` to lose. For many instances with many methods, or when you
want inheritance and `instanceof`, a class is clearer. See
[this and binding](this-and-binding.md) and
[prototypes and classes](prototypes-and-classes.md).

## What you should be able to answer

- What is a closure, and does it capture values or variables? Show it with a
  counter factory.
- Why does a `for (var i ...)` loop with `setTimeout` log the same number three
  times, and exactly what does `let` change?
- What is the temporal dead zone, and how does it differ from `var` hoisting?
- What is a stale closure in React, and which three fixes do you reach for?
- Can a closure cause a memory leak in Node? Give a realistic example and the
  fix.
- When would you choose a closure-based factory over a class?
