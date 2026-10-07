# 📗 The JavaScript Handbook

A cover-to-cover reference for the JavaScript track, organised **by concept** instead of by project. The projects teach one idea at a time inside a story; this is the flat map you come back to when you think *"wait, how does `sort` behave again?"*

Every concept gets a runnable snippet, what it prints, and an arrow like **→ 27** naming the project that teaches it properly. That project has a `LEARN.md` (concepts from zero), a `README.md` (the refactor) and an `original.js` showing the bug alive. Everything here runs offline: save a snippet as `scratch.mjs` and run `node scratch.mjs`. Terms are defined the first time they appear.

```
node 01-fizzbuzz/original.js     # run one file      | HTML projects: double-click the .html
node --test 27-memoize/          # one project's tests
npm test                         # every test suite in the repo
```

---

## §1. Values and types

Seven **primitives** — `string`, `number`, `boolean`, `null`, `undefined`, `symbol`, `bigint` — and everything else is an **object** (arrays, functions, dates, `Map`, your classes). A primitive is a plain value that can't change in place; an object is a box other code can hold a reference to and change.

```js
console.log(typeof "hi", typeof 1, typeof undefined);   // string number undefined
console.log(typeof null, typeof [], typeof (() => {})); // object object function
console.log(Array.isArray([]));                         // true
```

`typeof null === "object"` is a bug from 1995 that can't be fixed without breaking the web. To ask "is this an array?" use `Array.isArray` — `typeof` will not tell you.

### Numbers are floats

There is one number type and it is a 64-bit float. The fix for money is not rounding, it's never using floats for money: store **integer cents** and format only at the edge. **→ 32**

```js
console.log(0.1 + 0.2, 0.1 + 0.2 === 0.3);   // 0.30000000000000004 false
console.log(2 ** 53 === 2 ** 53 + 1);        // true — past 2^53 integers stop being exact
console.log((1.005).toFixed(2));             // "1.00"  (1.005 isn't really 1.005)
console.log(new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
  .format((1999 + 250) / 100));              // "$22.49"

console.log(typeof NaN, NaN === NaN);        // number false — "not a number" IS a number
console.log(Number.isNaN(NaN), Object.is(NaN, NaN));  // true true
console.log(1 / 0, -0 === 0, Object.is(-0, 0));       // Infinity true false
console.log([NaN].indexOf(NaN), [NaN].includes(NaN)); // -1 true
```

`NaN` is the only value not equal to itself, which is why `indexOf` (uses `===`) misses it and `includes` (same-value-zero) finds it. **→ 25**

### Coercion

**Coercion** is JavaScript silently converting a type. `+` means "add" *or* "join strings"; every other arithmetic operator only means maths.

```js
console.log("5" + 3, "5" - 3);       // "53"  2
console.log(1 + "2" + 3, 1 + 2 + "3");  // "123"  "33"   (strictly left to right)
console.log([] + {});                // "[object Object]"
console.log("b" + "a" + +"a" + "a"); // "baNaNa"
console.log(Number(null), Number(undefined), Number(""), Number([1, 2])); // 0 NaN 0 NaN
console.log(Boolean("false"), Boolean("0"), Boolean([]));                 // true true true
```

**Falsy** — the six values that behave as `false` in an `if` — are `false`, `0`, `""`, `null`, `undefined`, `NaN`. Everything else is **truthy**, including `"0"`, `"false"`, `[]` and `{}`. This matters constantly: `if (count)` skips a legitimate `0`, `if (name)` skips `""`, and `if (cache[k] != undefined)` treats a cached `null` or `undefined` result as a miss, so it recomputes forever. Ask a precise question instead — `map.has(key)`. **→ 27**

### `===` vs `==`, and the absence values

`===` compares without converting; `==` converts first, by rules nobody remembers correctly.

```js
console.log(null == undefined, null === undefined); // true false
console.log(null == 0, null >= 0);                  // false true  (!!)
console.log([] == false, "0" == false);             // true true
console.log(0 || "fb", 0 ?? "fb", "" || "x", "" ?? "x"); // "fb" 0 "x" ""
console.log(({}).a?.b);                             // undefined (plain .a.b would throw)
```

**Rule: always `===`.** The one defensible exception is `x == null` as a compact "null or undefined?". For "same contents" on objects you need a deep comparison — and `JSON.stringify(a) === JSON.stringify(b)` is *not* it (key order, `undefined`, `NaN`, dates and functions all lie). **→ 25**

`undefined` means "nobody set this" (missing property, missing argument, no `return`); `null` means "deliberately nothing". `||` falls back on *any* falsy value; `??` (**nullish coalescing**) only on `null`/`undefined`; `?.` (**optional chaining**) short-circuits instead of throwing.

### Strings

Immutable sequences of UTF-16 code units, which is why emoji count as 2. Spreading (`[...s]`) iterates by character and is what you want for anything user-facing. **→ 02**

```js
console.log("😀".length, [..."😀"].length);   // 2 1
console.log("a,b,,c".split(","), "".split(",")); // [ 'a','b','','c' ]  [ '' ] — not []!
console.log("aaa".replace("a", "X"), "aaa".replaceAll("a", "X")); // "Xaa" "XXX"
console.log("7".padStart(3, "0"), "10" > "9");   // "007" false ("1" < "9" as text)
```

`replace` with a *string* pattern replaces only the first match. Use `replaceAll`, or a regex with `g`. **→ 35**

---

## §2. Variables and scope

**Scope** is where a name is visible. `const` by default; `let` when you must reassign; `var` never (you'll meet it only in `original.js` files — function-scoped, hoisted, leaky). `const` freezes the *binding*, not the value: a `const` array can still be pushed to.

```js
const a = [], b = [];
for (var i = 0; i < 3; i++) a.push(() => i);
for (let j = 0; j < 3; j++) b.push(() => j);
console.log(a.map((f) => f()), b.map((f) => f())); // [ 3, 3, 3 ]  [ 0, 1, 2 ]
```

One `var i` is shared by all three functions; by the time they run it's `3`. `let` gives each iteration a fresh binding.

Function *declarations* are fully hoisted — callable before their line. `let`/`const` are hoisted but unusable until their line runs; that gap is the **temporal dead zone**.

```js
console.log(hoisted());   // "yes"
function hoisted() { return "yes"; }
console.log(y);           // ReferenceError: Cannot access 'y' before initialization
let y = 1;
```

### Closures

A **closure** is a function that keeps access to the variables of the place it was created, even after that place finished running. The single most important idea in the track.

```js
function makeCounter() {
  let count = 0;                    // private
  return () => ++count;
}
const next = makeCounter();
console.log(next(), next());        // 1 2
```

Two properties do all the work: `count` is **private** (unreachable from outside) and each call to `makeCounter()` makes a **fresh, independent** one. That's how `memoize` gives every wrapped function its own cache (**→ 27**), how `debounce` remembers its pending timer (**→ 28**) and how a bank account hides its balance (**→ 29**).

A **stale closure** is the same mechanism biting: a captured value that has fallen behind reality. The #1 bug in timer code, and the whole subject of React project 11.

---

## §3. Functions

```js
function declared(a, b) { return a + b; }   // hoisted, has its own `this`
const arrow = (a, b) => a + b;              // no own `this`, no `arguments`
const obj = () => ({ ok: true });           // parens, or JS reads {} as a block

function greet(name, greeting = "Hi") { return `${greeting}, ${name}`; }
const collect = (...args) => args;          // rest: gather into an array
console.log(greet("Ada"), collect(1, 2), Math.max(...[1, 9, 5])); // "Hi, Ada" [1,2] 9

const { a = 5 } = { a: null };
console.log(a);                             // null — defaults fire on `undefined` only
```

### Higher-order functions

A **higher-order function** takes and/or returns a function. A **wrapper** returns a new function adding behaviour around an old one — the shape of `memoize`, `debounce`, `throttle`, `withTimeout` and `retry`.

```js
const withLogging = (fn) => (...args) => {
  console.log("calling with", args);
  return fn(...args);
};
console.log(withLogging((a, b) => a + b)(2, 3)); // "calling with [ 2, 3 ]" then 5
```

Project 43's `retry(fn, { attempts, baseDelayMs, shouldRetry, sleep })` is exactly this shape, with the sleep function injected so tests never actually wait. **→ 27, 28, 43**

### `this`

`this` is decided by **how a function is called**, not where it was written. `obj.method()` → `obj`; a plain `fn()` → `undefined` (modules and classes are strict mode); `.call/.apply/.bind(x)` → `x`; arrows have **no own `this`** and use the surrounding one.

```js
const counter = { name: "counter", read() { return this?.name; } };
const detached = counter.read;
console.log(counter.read(), detached());   // "counter"  undefined — `this` was lost

class C {
  v = 10;
  getV() { return this.v; }        // detached → TypeError
  getArrow = () => this.v;         // detached → still 10
}
console.log(new C().getArrow.call(null)); // 10
```

Losing `this` by passing a method as a callback (`list.forEach(obj.method)`, `button.onclick = account.deposit`) is *the* `this` bug. Bind it, wrap it in an arrow, or use closures instead of classes. **→ 29**

### Pure functions

A **pure function** returns the same output for the same input and does nothing else — no printing, no mutating arguments, no clock, no randomness. Pure functions are trivially testable and safe to memoize, cache and reorder. Almost every `refactored/` folder is "the pure part" plus a thin impure shell. **→ 01, 18, 26**

---

## §4. Arrays and objects

**M** marks methods that **mutate**.

```js
const a = [1, 2, 3, 4];
a.map((n) => n * 2);            // [2,4,6,8]   transform each
a.filter((n) => n % 2);         // [1,3]       keep some
a.reduce((s, n) => s + n, 0);   // 10          fold to one value
a.find((n) => n > 2);           // 3           first match, else undefined
a.findIndex((n) => n > 2);      // 2           index, else -1
a.some((n) => n > 3);           // true        any?
a.every((n) => n > 0);          // true        all? — [].every(fn) is TRUE
a.includes(3);                  // true        NaN-safe membership
a.indexOf(3);                   // 2           -1 if absent; NaN-blind
a.slice(1, 3);                  // [2,3]       copy a window (negatives ok)
a.at(-1);                       // 4           last element
a.join("-");                    // "1-2-3-4"   null/undefined become ""
a.flat(); a.flat(Infinity);     // one level / all levels
a.flatMap((n) => [n, n]);       // map, then flatten one level
Array.from({ length: 3 }, (_, i) => i);      // [0,1,2] — build n items
[...new Set(a)];                             // dedupe
a.push(5); a.pop();                          // M end
a.unshift(0); a.shift();                     // M start (slow on big arrays)
a.splice(1, 2);                              // M remove 2 at index 1, returns them
a.sort(); a.reverse(); a.fill(0);            // M
a.toSorted(); a.toReversed(); a.with(0, 9);  // non-mutating twins (Node 20+)
```

`[].every(fn) === true` is vacuously correct — "all zero elements pass" — but it bites when an empty cart reports "all items valid". `[].reduce(fn)` with no initial value *throws*. Always ask what happens with zero items. **→ 26**

### The `.sort()` traps and friends — **→ 26**

```js
console.log([10, 9, 1].sort());                // [ 1, 10, 9 ]  — string order!
console.log([10, 9, 1].sort((a, b) => a - b)); // [ 1, 9, 10 ]
const xs = [3, 1, 2];
console.log(xs.sort() === xs, xs);             // true [ 1, 2, 3 ] — mutated in place
console.log(["10", "10", "10"].map(parseInt)); // [ 10, NaN, 2 ]
```

The default comparator stringifies everything, and `sort` mutates *and* returns the same array — so the "copy" you thought you made is the original. Sort a copy: `[...xs].sort(cmp)` or `xs.toSorted(cmp)`. A comparator returns negative ("a first"), positive ("b first") or `0`; for strings use `a.localeCompare(b)`. Project 26 wraps this as `sortBy(items, keyOf, { descending })` — you pass a **key function** (`(u) => u.age`), not a comparator, and nothing is mutated.

`map(parseInt)` fails because `map` passes `(value, index, array)` and `parseInt(string, radix)` reads that index as a number base: base 0 → 10, base 1 → invalid, base 2 → binary `"10"` → 2. Only pass callbacks you control: `.map((s) => parseInt(s, 10))`.

### Holes, shared references, copying

```js
console.log(new Array(3), new Array(3).map(() => 1)); // [ <3 empty> ] [ <3 empty> ] — skipped!
const rows = Array(2).fill([]);
rows[0].push("x");
console.log(rows);                                // [ [ 'x' ], [ 'x' ] ] — ONE array
console.log(Array.from({ length: 2 }, () => [])); // [ [], [] ]          — two arrays

console.log({ a: 1 } === { a: 1 });               // false — identity, never contents
const original = { x: 1, y: { z: 2 } };
const copy = { ...original };
copy.y.z = 99;
console.log(original.y.z);                        // 99 — the inner object is shared
const deep = structuredClone(original);
deep.y.z = 0;
console.log(original.y.z, deep.y.z);              // 99 0
```

Game boards built with `fill([])` share every row (**→ 16**). Spread is a **shallow** copy; `Object.freeze` is shallow too — it stops `o.n = ...` but not `o.n.v = ...`.

### Immutability patterns

The repo's default: **never mutate an input; return a new value.** These five lines are 90% of every reducer in this repo and the React track. **→ 14, 39, 59**

```js
const add     = (list, item)      => [...list, item];
const remove  = (list, id)        => list.filter((x) => x.id !== id);
const update  = (list, id, patch) => list.map((x) => (x.id === id ? { ...x, ...patch } : x));
const setKey  = (obj, k, v)       => ({ ...obj, [k]: v });
const dropKey = (obj, k)          => { const { [k]: _, ...rest } = obj; return rest; };
console.log(update([{ id: 1, done: false }], 1, { done: true })); // [ { id: 1, done: true } ]
```

### Destructuring and object keys

```js
const { name, age = 0 } = { name: "Ada" };
const [first, ...rest] = [1, 2, 3];
let x = 1, y = 2; [x, y] = [y, x];
console.log(name, age, first, rest, x, y);   // Ada 0 1 [ 2, 3 ] 2 1

function draw({ width = 10, filled = false } = {}) { return [width, filled]; }
console.log(draw(), draw({ filled: true })); // [ 10, false ] [ 10, true ]

const o = {}; o[1] = "num";
console.log(o["1"], Object.keys({ 2: "a", 1: "b", x: "c" })); // "num" [ '1','2','x' ]
```

An **options object** with defaults is how you avoid `draw(10, false, true, false)` boolean soup (**→ 11**). Object keys are always strings, and integer-like ones sort numerically and come first — if key order or key types matter, use a `Map`.

---

## §5. Maps and Sets

A **`Map`** is a dictionary with real keys of any type, guaranteed insertion order, a `size`, and no inherited junk.

```js
const m = new Map([["a", 1]]);
m.set("b", 2);
console.log(m.get("a"), m.has("zzz"), m.size, [...m.keys()]); // 1 false 2 [ 'a', 'b' ]
for (const [k, v] of m) { /* insertion order, guaranteed */ }
```

Why prefer it over a plain object for lookups? **Keys keep their type** — `m.set(1, "num")` and `m.set("1", "str")` are two entries, on an object they're one. **`has` asks "does an entry exist?"** independent of whether the value is falsy, which is the fix for the `if (cache[k] != undefined)` bug (**→ 27**). **No prototype surprises** — `({}).toString` already "exists", so counting characters in the string `"__proto__"` with a plain object goes badly wrong (**→ 02**). And **insertion order is specified**, which is exactly what an LRU cache needs:

```js
const lru = new Map([["a", 1], ["b", 2]]);
lru.delete("a"); lru.set("a", 1);      // re-insert = "just used"
console.log([...lru.keys()], lru.keys().next().value); // [ 'b', 'a' ]  "b"
```

The first key is always the least recently used, in O(1). That's the whole trick behind **→ 41**: one structure that already tracks recency beats a Map plus an order array plus a rule to keep them in sync.

A **`Set`** holds unique values, comparing the way `includes` does — `NaN` dedupes properly, two identical-looking objects don't. A `visited` set is the backbone of any crawler. **→ 52**

```js
console.log([...new Set([1, 2, 2, 3, NaN, NaN])], new Set([{}, {}]).size); // [1,2,3,NaN] 2
```

---

## §6. Classes and prototypes

```js
class Animal {
  constructor(name) { this.name = name; }
  speak() { return `${this.name} makes a sound`; }
  get loud() { return this.speak().toUpperCase(); }   // used as a property: a.loud
  static of(n) { return new Animal(n); }              // called on the class
}
class Dog extends Animal {
  speak() { return `${this.name} says woof`; }
  fetch() { return `${super.speak()} ... then fetches`; }
}
console.log(new Dog("Rex").speak(), new Dog("Rex") instanceof Animal); // "Rex says woof" true
console.log(Object.getPrototypeOf(Dog.prototype) === Animal.prototype); // true
```

Under the hood there are no classes, there is a **prototype chain**: every object has a hidden link to another object, and a property lookup walks that chain until it finds the name. `class` is friendlier syntax over exactly that.

`#name` is genuinely private — unreachable outside the class body, unlike an `_name` convention that only asks politely:

```js
class Account {
  #balance = 0;
  deposit(n) { this.#balance += n; return this; }
  get balance() { return this.#balance; }
}
console.log(new Account().deposit(50).balance);  // 50
// acc.#balance → SyntaxError: not merely blocked, unwritable
```

The closure version — `makeAccount()` returning `{ deposit, balance }` — gets the same privacy with no `this` at all, sidestepping the detached-method problem entirely. **→ 29** builds both and compares them.

**When to use a class:** when you have state plus behaviour plus an **invariant to protect** — `History` (past/present/future must stay consistent, **→ 39**), `LruCache` (**→ 41**), `EventEmitter` (**→ 38**). Prefer plain functions over data for everything else; a class whose methods never touch `this` is a namespace in a costume. `EventEmitter` is worth memorising as a shape: `on(event, listener)` returns an **unsubscribe function**, so callers can never guess wrong about how to detach, and one throwing listener must not silence the others.

---

## §7. Errors

**Throw, don't return sentinels.** Returning `null` / `-1` / `"error"` makes every caller responsible for remembering to check; throwing makes ignoring it impossible. **→ 30**

```js
function parsePort(s) {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new RangeError(`Invalid port: ${s}`);
  return n;
}
try { parsePort("abc"); } catch (err) { console.log(err.name, "|", err.message); }
// RangeError | Invalid port: abc
```

Built-ins worth knowing: `Error`, `TypeError` (wrong kind of value), `RangeError` (right kind, wrong value), `SyntaxError` (unparseable text), `AggregateError` (several at once).

```js
class ValidationError extends Error {
  constructor(message, { field, value } = {}) {
    super(message);
    this.name = "ValidationError";   // without this, name stays "Error"
    this.field = field; this.value = value;
  }
}
try { throw new ValidationError("must be a number", { field: "age" }); }
catch (e) { console.log(e instanceof ValidationError, e.name, e.field); } // true ValidationError age

try {
  try { throw new Error("disk full"); }
  catch (low) { throw new Error("could not save note", { cause: low }); }
} catch (e) { console.log(e.message, "<-", e.cause.message); } // could not save note <- disk full

function f() { try { return "try"; } finally { console.log("cleanup"); } }
console.log(f());   // "cleanup" then "try" — finally always runs, even through a return
```

Setting `this.name` is not decoration: forget it and `new MyError("x").name` is `"Error"`, and your logs lose the one word that identified the failure. Custom classes let callers branch with `instanceof` instead of matching message strings — how you get "retry on network errors, give up on 404s". **→ 30, 43, 50**

**Catch at the boundary, not everywhere.** A `try/catch` around every call turns a program into an apology. Let errors travel up to the one place that knows what to do: the CLI's `main()`, the server's error middleware, the UI's error boundary. Everything below stays honest. Never write `catch (e) {}` — an empty catch is a bug you have agreed in advance not to hear about. **→ 30, 65**

Throwing isn't the only way to report trouble. When you want *all* the problems rather than the first, collect them: project 31's `validate(data, schema)` returns `{ field: [messages] }` and counts as valid when that object is empty, with rules as plain functions `(value) => string | null` composed in arrays. **→ 31**

---

## §8. Asynchrony

### The event loop, in plain words

JavaScript runs on **one thread** — one line at a time, never two at once. So how are 20 requests "in flight" together? Because **waiting isn't executing**. When you start a timer or a request the environment takes it away and JS carries on; when the result is ready a callback joins a queue. Whenever the current piece of code finishes *completely*, the loop picks up the next callback. Two queues, and the order matters:

- **Microtasks** — promise callbacks (`.then`, code after `await`), `queueMicrotask`. Drained *entirely* after the current synchronous code, before anything else.
- **Macrotasks** — `setTimeout`, `setInterval`, I/O. One per loop turn, after microtasks are done.

```js
console.log("1");
setTimeout(() => console.log("2"), 0);
Promise.resolve().then(() => console.log("3"));
console.log("4");
// prints: 1  4  3  2
```

`setTimeout(fn, 0)` doesn't mean "now", it means "after everything already queued". And a long synchronous loop blocks *everything* — timers, clicks, requests. "Single-threaded" and "never block" are the same sentence. **→ 42, 57**

### Callbacks → promises → async/await

A **callback** is a function you hand over to be called later; nest three and you get the pyramid of doom. A **Promise** is an object representing a value that will arrive later: *pending*, then *fulfilled* (with a value) or *rejected* (with an error), settling **once, permanently**. **→ 57** builds one from scratch. `async`/`await` is the same thing spelled like normal code: `async` makes a function return a promise, `await` pauses *that function only*.

```js
const wait = (ms, v) => new Promise((resolve) => setTimeout(() => resolve(v), ms));
async function main() { console.log(await wait(10, "hi")); return 1; }
console.log(main() instanceof Promise);   // true — printed BEFORE "hi"
```

A `throw` inside an `async` function becomes a rejection; `await` turns a rejection back into a `throw` you can `try/catch`.

```js
const t = (ms, v) => new Promise((r) => setTimeout(() => r(v), ms));
await Promise.all([t(50, 1), t(50, 2)]);   // ~50ms → [1,2]; rejects on the FIRST failure
await Promise.allSettled([t(10, 1), Promise.reject(new Error("x"))]);
// [{status:'fulfilled',value:1},{status:'rejected',reason:Error}] — never rejects
await Promise.race([t(10, "fast"), t(50, "slow")]);  // "fast" — first to SETTLE, win or lose
await Promise.any([Promise.reject(new Error("x")), t(10, "ok")]); // "ok" — first to SUCCEED
```

`race` against a timer is how you build a deadline (`withTimeout(promise, ms)`, **→ 43**); `allSettled` is how you survive a partial failure (**→ 52**).

### The five async traps

**1. Sequential `await` in a loop for independent work.** `for (const id of ids) results.push(await fetchOne(id))` is 20 × 100ms = 2000ms; `await Promise.all(ids.map(fetchOne))` is ~100ms. But unbounded `Promise.all` over 2,000 ids gets you rate-limited (HTTP 429), so the real answer is a pool with a concurrency limit. **→ 42**

**2. `forEach` with an `async` callback.** `forEach` ignores return values, so nothing is awaited:

```js
const results = [];
[1, 2, 3].forEach(async (n) => { await wait(10); results.push(n); });
console.log(results);        // [] — nothing has happened yet
```

Use `for...of` with `await` (sequential) or `Promise.all(map(...))` (parallel).

**3. `return` instead of `return await` inside `try`.**

```js
async function bad()  { try { return Promise.reject(new Error("x")); } catch { return "caught"; } }
async function good() { try { return await Promise.reject(new Error("x")); } catch { return "caught"; } }
console.log(await good());   // "caught"  — bad() rejects instead; the catch never runs
```

**4. Errors from a later callback can't be caught outside it.** A `throw` inside `setTimeout` happens on a future loop turn, when your `try` is long gone. Handle it inside, or wrap the whole thing in a promise.

**5. The out-of-order response race.** Two requests are in flight; the *older, slower* one returns last and overwrites the newer answer. Fix with a latest-wins ticket (or an `AbortController`). **→ 54**, and React project 19.

```js
let latest = 0;
async function search(q) {
  const ticket = ++latest;
  const data = await fetchResults(q);
  if (ticket !== latest) return;    // a newer search started — drop this one
  render(data);
}
```

### Iteration, lazily

```js
function* gen() { yield 1; yield 2; return 3; }
console.log([...gen()], gen().next());   // [ 1, 2 ]  { value: 1, done: false }
async function* pages() { yield [1, 2]; yield [3]; }
for await (const page of pages()) console.log(page);   // [ 1, 2 ]  then  [ 3 ]
```

**Generators** produce values on demand, so infinite sequences are fine as long as you stop taking (**→ 22**); note that `return`ed values aren't yielded. An **async generator** is a lazy stream — the consumer's `break` stops the producer from fetching the next page (**→ 44**).

---

## §9. Modules (ESM)

**ESM** is the standard `import`/`export` system. Node uses it for `.mjs` files, or for `.js` in a package with `"type": "module"` — which is what this repo does.

```js
// math.js
export function add(a, b) { return a + b; }               // named
export default function subtract(a, b) { return a - b; }  // at most one default

// main.js
import subtract, { add } from "./math.js";   // default first, then named in braces
import { add as plus } from "./math.js";     // rename
import * as math from "./math.js";           // everything as one object
```

- The `.js` extension is **required** in Node — `from "./math"` fails.
- Imports are **static and hoisted**: they run before any other code in the file and can't sit inside an `if`. For conditional loading use `await import("./x.js")`, which returns a promise.
- Modules are **singletons**: importing a file twice runs it once and shares the result.
- Module code is always **strict mode**, top-level `this` is `undefined`, and exports are **live bindings**, not copies.

Circular imports don't crash, but one side sees a half-initialised module — a reliable sign that your two files want to be three.

---

## §10. The DOM in two pages

The **DOM** ("document object model") is the browser's live tree of objects representing the page. JavaScript changes that tree; the browser repaints.

```js
document.querySelector("#total");        // first CSS-selector match, or null
[...document.querySelectorAll(".item")]; // NodeList → real array
el.textContent = "hi";                   // safe: sets text, never parses HTML
el.innerHTML = userInput;                // DANGEROUS: parses HTML — this is XSS
el.value;                                // input contents (always a string)
el.dataset.id;                           // reads data-id="..."
el.classList.add("on"); el.classList.toggle("on", isOn);
el.closest(".row");                      // nearest matching ancestor, self included
const li = document.createElement("li");
li.textContent = todo.title;
list.append(li);                         // append / prepend / remove / replaceChildren
```

**XSS** ("cross-site scripting") is user-typed text being treated as code. Default to `textContent`; if you must build HTML, escape everything from outside *by default*. **→ 35, 62**

Events **bubble**: a click on a `<button>` fires on the button, then each parent, up to `document`. That's what makes **event delegation** work — one listener on a container instead of one per row, which survives re-rendering and costs nothing as the list grows. (`event.preventDefault()` stops the browser's default action; `event.stopPropagation()` stops the climb — use it sparingly, it breaks other people's delegation.)

```js
list.addEventListener("click", (e) => {
  const row = e.target.closest("li[data-id]");
  if (!row) return;
  toggle(row.dataset.id);
});
```

### The one rule: state lives in data, not in the DOM

The common beginner architecture reads truth back out of the page — counting `<li>` elements, checking `classList.contains("done")`, parsing `textContent` into a number. The DOM *becomes* the database, and every future feature (sorting, filtering, saving, undo) becomes archaeology.

```js
let state = { todos: [], filter: "all" };
function render() {                      // UI = f(state)
  list.replaceChildren(...visible(state).map(toElement));
  count.textContent = `${state.todos.length} items`;
}
function dispatch(action) {              // one door in
  state = reduce(state, action);
  render();
}
```

State in one object, a pure function from state to what's on screen, every handler calling `dispatch`. That's **→ 14, 47, 59, 64** — and React's entire idea, written by hand.

---

## §11. Node basics

**Node** runs JavaScript outside a browser: no `document` or `window`, but files, processes and servers instead. Never hardcode a key in source — read `process.env` and fail loudly with a helpful message when it's missing (**→ 50**).

```js
console.log(process.argv.slice(2));   // CLI arguments after the script name
console.log(process.env.API_KEY);     // environment variables — where secrets live
process.exit(1);                      // non-zero = failure, for scripts and CI

import { readFile, writeFile, rename } from "node:fs/promises";
const data = JSON.parse(await readFile("notes.json", "utf8")); // omit "utf8" → a Buffer
await writeFile("notes.json.tmp", JSON.stringify(data, null, 2));
await rename("notes.json.tmp", "notes.json");  // atomic: readers see old or new, never half
```

`writeFile` alone is not atomic — crash midway and the file is truncated garbage, so write to a temp file and `rename` (**→ 55**). The `node:` prefix makes it unambiguous that you mean the built-in module; use `node:path`'s `join`/`resolve` instead of gluing strings with `/`.

```js
import { createServer } from "node:http";
const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }
  res.writeHead(404).end("Not found");
});
server.listen(3000, () => console.log("listening on 3000"));
```

`req` is a stream — the body arrives in chunks, so you collect it before parsing. Routing is a table of `{ method, pattern, handler }` matched in order; middleware is a chain of functions each handed a `next`. Building that yourself is **→ 65, 66, 67**.

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";

describe("cart", () => {
  test("totals in cents", () => assert.equal(cartTotalCents([{ priceCents: 100, quantity: 2 }]), 200));
  test("rejects bad input", () => assert.throws(() => toCents(NaN), RangeError));
  test("async work", async () => await assert.rejects(() => fetchUser("nope"), { name: "NotFoundError" }));
});
```

`assert.equal` is `===`; `assert.deepEqual` compares structures. **Always `await` an async test's assertions** — a forgotten `await` makes the test pass while the assertion is still in flight. That false green is the subject of **→ 58**; how a runner works at all is **→ 45**.

---

## §12. The repo's big ideas

**1. Separate deciding from doing.** The one big idea. **Decisions** — game rules, scoring, parsing, conversions, next-state — become pure functions. **Doing** — printing, DOM, canvas, timers, network — becomes a thin layer that calls them. The pure part is trivially testable; the thin part is too small to hide a bug. **→ 01**, then every project after it.

```js
export const fizzbuzz = (n) =>              // decide (pure, tested)
  n % 15 === 0 ? "FizzBuzz" : n % 3 === 0 ? "Fizz" : n % 5 === 0 ? "Buzz" : String(n);
for (let i = 1; i <= 100; i++) console.log(fizzbuzz(i));  // do (nothing left to test)
```

**2. Data-driven dispatch.** When adding a feature means adding a *line to a table* rather than a branch to an `if`, you've found the right shape. Operators, rules, routes, precedence and transitions are all data — adding `%` below is one line and needs no new scaffolding. **→ 06, 10, 13, 60, 70**

```js
const OPS = { "+": (a, b) => a + b, "-": (a, b) => a - b, "*": (a, b) => a * b };
const apply = (op, a, b) => {
  if (!(op in OPS)) throw new Error(`Unknown operator: ${op}`);
  return OPS[op](a, b);
};
console.log(apply("*", 6, 7));   // 42
```

**3. Make impossible states unrepresentable.** Three booleans (`isLoading`, `isError`, `isDone`) express eight states, of which maybe three are legal — and nothing stops the other five. One field with named values can only ever be legal: `{ status: "loading" }` / `{ status: "ok", data }` / `{ status: "error", error }`. A **state machine** goes further and writes down which moves exist at all:

```js
const TRANSITIONS = {
  pending: { pay: "paid", cancel: "cancelled" },
  paid: { ship: "shipped", cancel: "cancelled" },
  shipped: { deliver: "delivered" }, delivered: {}, cancelled: {},
};
const transition = (state, event) => {
  const next = TRANSITIONS[state][event];
  if (!next) throw new Error(`Cannot ${event} while ${state}`);
  return next;
};
console.log(transition("pending", "pay"));  // "paid"   — "cancel" while delivered throws
```

Double-clicks, out-of-order responses and "the button fired twice" all disappear because the *shape* forbids them. **→ 40, 47, 48** (and React 16, 20)

**4. Pure state transitions: `next = step(state, event)`.** Funnel every change through one function taking the old state and returning a new one. Because it's pure you can test it without a screen, log every action, replay a bug, and get undo for free by keeping the previous states — literally `{ past, present, future }`. **→ 17, 39, 59** (React 13, 40, 41)

```js
const reduce = (state, action) => {
  switch (action.type) {
    case "add":    return { ...state, todos: [...state.todos, action.todo] };
    case "toggle": return { ...state, todos: state.todos.map((t) =>
                     t.id === action.id ? { ...t, done: !t.done } : t) };
    default:       return state;
  }
};
```

**5. Program against an interface, inject the rest.** When every cipher has `{ name, encode, decode }`, adding one means dropping an object into an array. When a function takes `fetch` as a parameter, testing it needs no network. When `memoize` takes a `keyOf`, callers fix the cases you didn't imagine. **→ 13, 27, 50, 55**

```js
export async function getWeather(city, { fetchFn = fetch } = {}) {
  const res = await fetchFn(url(city));
  if (!res.ok) throw new HttpError(res.status);
  return res.json();
}
// test: getWeather("Oslo", { fetchFn: async () => ({ ok: true, json: async () => fake }) })
```

---

## §13. Traps: the top 20

1. **`0.1 + 0.2 !== 0.3`.** Never floats for money — integer cents. → 32
2. **`sort()` sorts as strings and mutates.** `[10, 9].sort()` doesn't reorder, and your "copy" is the original. Pass a comparator; use `toSorted`. → 26
3. **`==` converts.** `null >= 0` is `true` but `null == 0` is `false`. Use `===`. → 25
4. **Falsy checks eat valid data.** `if (count)` skips `0`, `if (name)` skips `""`, `if (cache[k] != undefined)` misses every cached `null`/`undefined`. Use `map.has`. → 27
5. **Spread copies one level.** `{...obj}` shares nested objects; `Object.freeze` is shallow too. `structuredClone` for a real copy. → 25
6. **`JSON.stringify` comparison lies both ways.** Key order differs, and `undefined`, functions, `NaN` and dates don't survive. Write a real deep-equal. → 25
7. **`Array(n).fill([])` puts the *same* array in every slot.** Use `Array.from({length: n}, () => [])`. → 16
8. **`map(parseInt)` passes the index as the radix** → `[10, NaN, 2]`. Only pass callbacks you control. → 26
9. **`var` in a loop shares one binding**; three closures all see `3`. Use `let`. → 27
10. **Detached methods lose `this`.** `list.forEach(obj.method)` gets `undefined`. Bind, wrap in an arrow, or use closures. → 29
11. **`forEach` with an `async` callback awaits nothing.** Use `for...of` or `Promise.all(map(...))`. → 42
12. **Sequential `await` in a loop is 20× slower** than needed for independent work — but unbounded `Promise.all` gets you rate-limited. Use a pool. → 42
13. **`return` (not `return await`) inside `try` escapes the `catch`.** → 43
14. **`setTimeout(fn, 0)` isn't "now"**, promises always run before timers, and errors thrown inside a timer can't be caught outside it. → 42, 57
15. **The out-of-order response race**: a slow old request overwrites a fast new one. Latest-wins ticket, or `AbortController`. → 54
16. **Months are 0-indexed and `Date` is mutable.** `setMonth(1)` on Jan 31 lands on March 2, and handing someone your `Date` lets them change it. → 33
17. **`split(",")` cannot parse CSV** — quoted fields contain commas. You need a small state machine. Same for HTML, JSON and regex "parsers". → 34, 69
18. **`innerHTML` with user text is an XSS hole.** Default to `textContent`; escape by default when building HTML. → 35, 62
19. **The empty array.** `[].every(fn)` is `true`; `[].reduce(fn)` with no initial value throws. Always ask what happens with zero items. → 26
20. **The DOM is not your database.** Reading state back out of the page makes every future feature archaeology. Keep state in one object and render from it. → 14

---

*Stuck on a concept? The project number beside it is the long version: `LEARN.md` teaches it from zero, `README.md` explains the refactor, `original.js` shows the bug alive.*
