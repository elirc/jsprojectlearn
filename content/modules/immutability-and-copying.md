# Immutability and copying

"I changed one thing and something unrelated updated" is the most common bug
in JavaScript applications, and it is always a shared reference. React, Redux,
memoisation and change detection all assume you do not mutate data in place.
Interviewers test this with "what does this log?" snippets and with "update
this nested state without mutating it", so you need both the model and the
idioms.

## Values and references

Primitives (`string`, `number`, `boolean`, `null`, `undefined`, `bigint`,
`symbol`) are immutable and copied by value. Objects — including arrays, Dates,
Maps and functions — are held **by reference**: a variable stores a pointer to
the object, and assigning or passing it copies the pointer, not the object.

```js
const order = { id: 7, items: ['pen'] };
const alias = order;
alias.items.push('ink');
console.log(order.items); // [ 'pen', 'ink' ]

function reset(o) { o = { id: 0, items: [] }; }
reset(order);
console.log(order.id); // 7: reassigning a parameter never affects the caller
```

JavaScript is "pass by value, where the value of an object is a reference"
(call-by-sharing). A function can **mutate** what you pass it, but cannot
**replace** your variable.

`const` is about the variable, not the value: `const order` stops `order = …`,
but `order.items.push()` is fine. Immutability is a discipline you apply to
objects, not something `const` gives you.

## Shallow copies

Most copying tools copy **one level**: a new outer object whose properties
point at the same nested objects.

```js
const state = { user: { name: 'Ada' }, tags: ['a'] };
const copy = { ...state };
copy.user.name = 'Grace';
copy.tags = [...copy.tags, 'b'];
console.log(state.user.name, state.tags); // Grace [ 'a' ]
```

Changing `copy.user.name` reaches through to the shared `user` object;
replacing `copy.tags` with a new array does not affect the original. That
distinction — **mutating a shared nested object** versus **replacing a
property** — is the whole topic.

Shallow-copy tools: object spread `{ ...o }`, `Object.assign({}, o)`, array
spread `[...a]`, `a.slice()`, `Array.from(a)`, and the ES2023 array methods.

## Deep copies, compared

| Technique | Nested objects | Dates | Map / Set | `undefined` | Functions | Class instances | Cycles |
|-----------|----------------|-------|-----------|-------------|-----------|-----------------|--------|
| `{ ...o }` / `Object.assign` | shared | shared | shared | kept | kept | become plain | fine (shared) |
| `JSON.parse(JSON.stringify(o))` | copied | become strings | become `{}` | dropped | dropped | become plain | throws |
| `structuredClone(o)` | copied | copied | copied | kept | **throws** | become plain | preserved |
| Hand-written / library clone | your rules | your rules | your rules | your rules | your rules | can keep | your rules |

```js
const draft = { tags: ['a'], at: new Date(0), meta: new Map([['k', 1]]), skip: undefined };
const viaJson = JSON.parse(JSON.stringify(draft));
const viaClone = structuredClone(draft);

console.log(Object.keys(viaJson), typeof viaJson.at);             // [ 'tags', 'at', 'meta' ] string
console.log(viaClone.at instanceof Date, viaClone.meta.get('k'), 'skip' in viaClone); // true 1 true
try {
  structuredClone({ save() {} });
} catch (e) {
  console.log(e.name); // DataCloneError
}
```

`structuredClone` is the modern default for deep-copying plain data. It still
loses prototypes, so a `Money` instance comes back as a plain object — give
domain classes their own `clone()`. See [JSON edge cases](json-edge-cases.md)
for exactly what the JSON round trip changes.

## Freezing

`Object.freeze(obj)` makes an object's own properties read-only and stops
additions and deletions. Writes fail silently in sloppy scripts and throw in
strict code (ES modules, classes). Two limits:

```js
'use strict';
const config = Object.freeze({ port: 5432, db: { host: 'localhost' } });
config.db.host = 'prod-db'; // allowed: freeze is shallow
try {
  config.port = 1;
} catch (e) {
  console.log(e.name); // TypeError
}
console.log(config.db.host); // prod-db
```

- It is **shallow**; freeze nested objects recursively if you need a deep
  freeze.
- `Object.seal` blocks adding and deleting but still allows changing values;
  `Object.preventExtensions` only blocks adding.

In TypeScript, `readonly` properties and `ReadonlyArray` give you the same
guarantee at compile time with zero runtime cost, which is usually what you
want in application code. Freezing is useful for shared constants and for
catching accidental mutation in development.

## Non-mutating array methods

Know which array methods mutate; it is a frequent interview question.

| Mutates | Non-mutating equivalent |
|---------|-------------------------|
| `push`, `unshift` | `[...a, x]`, `[x, ...a]` |
| `pop`, `shift` | `a.slice(0, -1)`, `a.slice(1)` |
| `splice(i, n, …)` | `a.toSpliced(i, n, …)` |
| `sort(fn)` | `a.toSorted(fn)` |
| `reverse()` | `a.toReversed()` |
| `a[i] = x` | `a.with(i, x)` |
| `fill`, `copyWithin` | `Array.from` with a mapper |

`map`, `filter`, `slice`, `concat`, `flat` and `flatMap` never mutate.
`sort` and `reverse` are the dangerous pair: they mutate **and** return the same
array, so `const sorted = items.sort()` looks like a copy but is not.

## Immutable updates in state

React compares state with `Object.is`; Redux selectors and `React.memo`
compare props by reference. An in-place mutation keeps the same reference, so
nothing re-renders. The pattern is **copy every object on the path to the
change, and reuse everything else** (structural sharing).

```js
const state = {
  user: { name: 'Ada', address: { city: 'London', postcode: 'N1' } },
  todos: [{ id: 1, done: false }, { id: 2, done: false }],
};

const moved = {
  ...state,
  user: { ...state.user, address: { ...state.user.address, city: 'Leeds' } },
};
const toggled = { ...state, todos: state.todos.map((t) => (t.id === 2 ? { ...t, done: true } : t)) };
const removed = { ...state, todos: state.todos.filter((t) => t.id !== 1) };

console.log(state.user.address.city, moved.user.address.postcode);   // London N1
console.log(toggled.todos[0] === state.todos[0], state.todos[1].done); // true false
console.log(removed.todos.length, moved.todos === state.todos);       // 1 true
```

| Operation | Idiom |
|-----------|-------|
| Add | `[...list, item]` |
| Update by id | `list.map((x) => (x.id === id ? { ...x, ...changes } : x))` |
| Remove by id | `list.filter((x) => x.id !== id)` |
| Insert at index | `list.toSpliced(i, 0, item)` |
| Toggle in a Set | `const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id);` |
| Set a Map entry | `new Map(prev).set(key, value)` |

When nesting gets deep, either flatten the state (store entities by id) or use
Immer, which lets you write mutating code against a proxy draft and produces a
new, structurally shared object. The undo/redo project shows why immutable
snapshots are so useful: [../../39-undo-redo/](../../39-undo-redo/). For where
state should live in the first place, see
[server and client state](server-and-client-state.md).

## When mutation is fine

Immutability matters for data that is **shared**: state, props, caches, module
constants, function arguments you do not own. Local data that nothing else can
see is fair game:

- building an array or object inside a function before returning it;
- the accumulator of a `reduce` you created yourself (spreading it every
  iteration turns an O(n) loop into O(n²));
- a copy you just made.

The rule of thumb: never mutate something you received; feel free to mutate
something you created, until you hand it to someone else.

## What you should be able to answer

- Is JavaScript pass-by-reference? Explain with an example that mutates and one
  that reassigns.
- What is the difference between a shallow and a deep copy? Which tools make
  each, and what does each one lose?
- Why does `const` not make an object immutable, and what does
  `Object.freeze` not protect?
- Which array methods mutate, and what are their non-mutating replacements?
- Update `state.user.address.city` without mutating `state`. Which objects are
  new, and which are shared?
- When is mutation perfectly acceptable?
