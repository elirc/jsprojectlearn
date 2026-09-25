# `this` and binding

`this` is the JavaScript feature most likely to break when you refactor: pass a
method as a callback, destructure it, or hand it to Express, and it suddenly
throws. Interviewers ask about it because the rules are small and exact, and a
mid-level developer should be able to predict `this` from the call site alone.

## The one rule: the call decides

For a normal (non-arrow) function, `this` is not fixed when the function is
written. It is set **each time the function is called**, by the way it is
called. Look at the call site, not the definition.

| Call form | `this` is | Example |
|-----------|-----------|---------|
| `new Fn()` | the new object | `new User('Ada')` |
| `fn.call(x)`, `fn.apply(x)`, bound `fn.bind(x)` | `x` | `greet.call(admin)` |
| `obj.method()` | `obj`, the thing before the dot | `cart.total()` |
| plain `fn()` | `undefined` in strict code; `globalThis` in sloppy scripts | `const f = cart.total; f()` |

Check the rows in that order: `new` beats `bind`, which beats the dot. Arrow
functions are the exception to the whole table, covered below.

```js
'use strict';
const cart = {
  items: [5, 10],
  total() { return this.items.reduce((a, b) => a + b, 0); },
};

console.log(cart.total()); // 15
const total = cart.total;
try {
  total();
} catch (e) {
  console.log(e.message); // Cannot read properties of undefined (reading 'items')
}
```

ES modules and class bodies are always strict, so in modern code a detached
method sees `undefined` and fails loudly. In an old sloppy script it would
silently read `globalThis.items`, which is worse.

## Losing `this`: the three everyday ways

**1. Passing a method as a callback.** The receiving code calls it as a plain
function.

```js
class UserController {
  constructor(service) { this.service = service; }
  list() { return this.service.all(); }
}

const controller = new UserController({ all: () => ['Ada'] });
const handler = controller.list; // what router.get('/users', controller.list) does
try {
  handler();
} catch (e) {
  console.log(e.name); // TypeError
}
```

**2. Destructuring a method.** `const { list } = controller` is the same
detachment with different syntax.

**3. A regular function nested inside a method.** Its `this` is set by *its*
call, not inherited from the method:

```js
'use strict';
const report = {
  title: 'Q1',
  rows: [1, 2],
  labels() {
    return this.rows.map(function (r) {
      return `${this?.title}:${r}`; // this is undefined here
    });
  },
};
console.log(report.labels()); // [ 'undefined:1', 'undefined:2' ]
```

Timers in Node are a special case worth knowing: a regular function passed to
`setTimeout` is called with `this` set to the `Timeout` object, not
`undefined`, so `this.count++` quietly produces `NaN`.

## Arrow functions do not have their own `this`

An arrow function never gets a `this` of its own. It uses the `this` of the
scope it was written in, exactly like any other outer variable — see
[closures and scope](closures-and-scope.md). `call`, `apply` and `bind` cannot
change it.

```js
const report = {
  title: 'Q1',
  rows: [1, 2],
  labels() {
    return this.rows.map((r) => `${this.title}:${r}`);
  },
};
console.log(report.labels()); // [ 'Q1:1', 'Q1:2' ]
```

That makes arrows perfect *inside* methods, and wrong *as* object methods:

```js
const counter = {
  count: 0,
  inc: () => this, // module/file scope `this`, not counter
};
console.log(counter.inc() === counter); // false
```

In a CommonJS file the top-level `this` is `module.exports`; in an ES module it
is `undefined`. Neither is the object.

## `bind`, `call` and `apply`

| Method | Calls now? | Arguments | Use it for |
|--------|------------|-----------|------------|
| `fn.call(ctx, a, b)` | yes | listed | borrowing a method once |
| `fn.apply(ctx, [a, b])` | yes | array | legacy; spread has replaced it |
| `fn.bind(ctx, a)` | no, returns a function | pre-filled | callbacks, partial application |

```js
function greet(greeting) { return `${greeting}, ${this.name}`; }

const ada = { name: 'Ada' };
console.log(greet.call(ada, 'Hello')); // Hello, Ada
const hiAda = greet.bind(ada, 'Hi');
console.log(hiAda()); // Hi, Ada
console.log(hiAda.call({ name: 'Grace' })); // Hi, Ada: a bound function ignores later call/bind
```

`bind` creates a new function each time, so `el.removeEventListener('click',
fn.bind(this))` never removes anything — keep a reference to the bound
function.

## Fixing methods passed as callbacks

You have four options when a class method will be used as a callback:

```js
class Search {
  query = '';
  constructor() {
    this.onSubmitBound = this.onSubmit.bind(this); // 1. bind in the constructor
  }
  onSubmit() { return `searching ${this.query}`; }
  onInput = (value) => { this.query = value; }; // 2. arrow class field
}

const s = new Search();
const { onInput, onSubmitBound } = s;
onInput('shoes');
console.log(onSubmitBound()); // searching shoes
console.log(['a'].map(() => s.onSubmit())); // 3. wrap the call at the call site
console.log(Object.hasOwn(s, 'onInput'), Object.hasOwn(s, 'onSubmit')); // true false
```

The fourth option is not to use `this` at all: plain functions and closures
cannot lose it.

The trade-off: arrow class fields are created **per instance** (`hasOwn` is
true), so they are not on the prototype, cannot be overridden cleanly with
`super.method()`, and are invisible to test spies placed on the prototype.
Prototype methods are shared by every instance. Use arrow fields for handlers
you pass around, and ordinary methods for everything else.

## `this` in classes, `new` and static methods

`new` creates an empty object whose prototype is `Fn.prototype`, calls the
constructor with `this` bound to it, and returns it (unless the constructor
returns another object). In a subclass, `this` does not exist until `super()`
has run, so touching it earlier throws a `ReferenceError`. See
[prototypes and classes](prototypes-and-classes.md).

In a **static** method `this` is the class itself — when called as
`Slug.make()`. Destructure it and it is `undefined` like any other method:

```js
class Slug {
  static clean(s) { return s.trim().toLowerCase(); }
  static make(s) { return this.clean(s).replaceAll(' ', '-'); }
}
console.log(Slug.make(' Summer Sale ')); // summer-sale
```

## Libraries that set `this` for you

Some APIs deliberately call your function with a particular `this`:

- Node's `EventEmitter` calls regular-function listeners with `this` set to the
  emitter.
- DOM `addEventListener` calls regular-function handlers with `this` set to the
  element (`event.currentTarget` is clearer).
- Test runners such as Mocha expose the test context on `this` inside
  `function () {}` callbacks, which is why their docs warn against arrows.

The rule has not changed: the caller decides. Read the library's documentation
to know what it passes, and use an arrow when you want to ignore it.

## What you should be able to answer

- What decides the value of `this` in a regular function? List the rules in
  priority order.
- Why does `router.get('/users', controller.list)` throw on the first request,
  and what are three ways to fix it?
- What is different about `this` in an arrow function, and why is an arrow a
  bad choice for an object method?
- What is the difference between `call`, `apply` and `bind`, and what happens
  if you `bind` an already bound function?
- What does `this` refer to at the top level of an ES module versus a CommonJS
  file?
- What is the cost of defining handlers as arrow class fields?
