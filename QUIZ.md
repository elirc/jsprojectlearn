# 🧠 The JavaScript Quiz — 50 questions

Fifty questions over the JavaScript track. Four kinds:

- **What does this print?** — read the code, write down the exact output, *then* check.
- **Spot the bug** — the code runs without crashing. Say what's wrong and how you'd fix it.
- **Which approach?** — two ways to do something; pick one and say why.
- **Predict the test result** — pass or fail, and what the failure message would say.

Every answer is at the bottom with a short explanation and the project that teaches it deeply. All code was run on Node 22 before publication — where the answer looks wrong, it's the language being weird, not a typo.

**How to use it:** write your answer down before scrolling. Guessing right after seeing the answer feels great and teaches nothing. Anything you get wrong, go do that project.

Difficulty: ⭐ warm-up · ⭐⭐ real code · ⭐⭐⭐ the deep end.

---

## ⭐ Warm-ups (1–15)

**1. What does this print?**
```js
console.log("5" + 3, "5" - 3, 1 + 2 + "3", 1 + "2" + 3);
```

**2. What does this print?**
```js
console.log(typeof null, typeof [], typeof (() => {}), Array.isArray([]));
```

**3. What does this print?**
```js
console.log([10, 9, 1].sort());
```

**4. What does this print?**
```js
console.log(Boolean("0"), Boolean(""), Boolean([]), Boolean("false"));
```

**5. What does this print?**
```js
const volume = 0;
console.log(volume || 50, volume ?? 50);
```

**6. What does this print?**
```js
function makeCounter() { let c = 0; return () => ++c; }
const a = makeCounter(), b = makeCounter();
console.log(a(), a(), b());
```

**7. Spot the bug.**
```js
const original = { name: "Ada", address: { city: "London" } };
const copy = { ...original };
copy.name = "Grace";
copy.address.city = "Paris";
console.log(original.name, original.address.city);
```

**8. Spot the bug.**
```js
const double = (n) => { n * 2; };
console.log(double(5));
```

**9. Spot the bug.**
```js
const settings = { theme: "dark" };
settings.theme = "light";   // works
const total = 0;
total = total + 1;          // ???
```

**10. Which approach, and why?**
```js
if (userId == storedId) { ... }     // A
if (userId === storedId) { ... }    // B
```

**11. What does this print?**
```js
console.log(["1", "2", "3"].map(Number));
console.log(["1", "2", "3"].map(parseInt));
```

**12. Spot the bug.**
```js
const cache = {};
function findUser(name) {
  if (cache[name] != undefined) return cache[name];
  const user = slowLookup(name);   // returns a user object, or null if unknown
  cache[name] = user;
  return user;
}
```

**13. Which approach, and why?** You're counting how many times each character appears in a user-supplied string.
```js
const counts = {};                          // A
for (const ch of text) counts[ch] = (counts[ch] || 0) + 1;

const counts = new Map();                   // B
for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
```

**14. Predict the test result.**
```js
test("sorts", () => {
  assert.equal(sortNumbers([3, 1]), [1, 3]);
});
```
`sortNumbers` is correct and returns `[1, 3]`. Does this test pass?

**15. Which approach, and why?**
```js
function parseAge(input) {                      // A
  const n = Number(input);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function parseAge(input) {                      // B
  const n = Number(input);
  if (!Number.isInteger(n) || n < 0) throw new ValidationError("age must be a whole number");
  return n;
}
```

---

## ⭐⭐ Real code (16–35)

**16. What does this print?**
```js
const fns = [];
for (var i = 0; i < 3; i++) fns.push(() => i);
console.log(fns.map((f) => f()));
```

**17. Spot the bug.**
```js
function canCheckout(cart) {
  return cart.every((item) => item.price > 0 && item.quantity > 0);
}
console.log(canCheckout([]));
```

**18. Spot the bug.**
```js
const board = Array(3).fill(Array(3).fill("."));
board[0][0] = "X";
console.log(board.map((row) => row.join("")).join("|"));
```

**19. Spot the bug.**
```js
function topThree(rows) {
  const sorted = rows.sort((a, b) => b.score - a.score);
  return sorted.slice(0, 3);
}
const leaderboard = loadScores();
const top = topThree(leaderboard);
renderAll(leaderboard);   // still in submission order?
```

**20. What does this print?**
```js
const settings = { theme: null, size: undefined };
const { theme = "dark", size = 10 } = settings;
console.log(theme, size);
```

**21. Spot the bug.** This "saves the user's settings" to disk.
```js
const settings = { theme: "dark", onSave: () => {}, lastOpened: undefined, ratio: NaN, tags: new Set(["a"]) };
await writeFile("settings.json", JSON.stringify(settings));
```

**22. What does this print?**
```js
const counts = {};
for (const ch of "hello") counts[ch] = (counts[ch] || 0) + 1;
console.log(counts["l"], counts["toString"]);
```

**23. Spot the bug.**
```js
class AppError extends Error {
  constructor(message) { super(message); }
}
const err = new AppError("nope");
console.log(err.name);
logger.warn(`[${err.name}] ${err.message}`);
```

**24. What does this print?**
```js
function f() { try { return "A"; } finally { console.log("B"); } }
function g() { try { return "A"; } finally { return "C"; } }
console.log(f());
console.log(g());
```

**25. Spot the bug.**
```js
async function loadAll(ids) {
  const users = [];
  ids.forEach(async (id) => {
    users.push(await fetchUser(id));
  });
  return users;
}
```

**26. What does this print?**
```js
console.log("one");
setTimeout(() => console.log("two"), 0);
Promise.resolve().then(() => console.log("three"));
console.log("four");
```

**27. Spot the bug.**
```js
function addMonth(date) {
  date.setMonth(date.getMonth() + 1);
  return date;
}
const jan31 = new Date(2024, 0, 31);
const next = addMonth(jan31);
console.log(next.getMonth(), next.getDate(), jan31 === next);
```

**28. What does this print?**
```js
console.log("a,b,,c".split(",").length, "".split(",").length, ",".split(",").length);
```

**29. Spot the bug.**
```js
class Account {
  constructor(balance) { this.balance = balance; }
  report() { return `Balance: ${this.balance}`; }
}
const acc = new Account(100);
const report = acc.report;
console.log(report());
```

**30. Which approach, and why?** A search box fires a request on every keystroke.
```js
input.addEventListener("input", debounce(search, 300));   // A
input.addEventListener("input", throttle(search, 300));   // B
```

**31. Which approach, and why?** You're fetching five independent dashboard widgets, and you'd rather show four widgets than none.
```js
const data = await Promise.all(urls.map(fetchJson));        // A
const data = await Promise.allSettled(urls.map(fetchJson)); // B
const data = await Promise.race(urls.map(fetchJson));       // C
```

**32. Spot the bug.**
```js
const csv = 'name,note\nAda,"hello, world"';
const [header, ...rows] = csv.split("\n");
console.log(rows[0].split(","));
```

**33. Spot the bug.**
```js
function renderComment(comment) {
  const li = document.createElement("li");
  li.innerHTML = `<strong>${comment.author}</strong>: ${comment.body}`;
  list.append(li);
}
```

**34. Predict the test result.**
```js
test("rejects unknown users", () => {
  assert.rejects(() => fetchUser("nobody"), { name: "NotFoundError" });
});
```
`fetchUser` actually resolves happily with `undefined` — it never rejects. Does this test pass?

**35. Which approach, and why?** A shopping cart adding $1.10 + $2.20, then charging the card.
```js
const total = items.reduce((s, i) => s + i.price, 0);             // A: price = 1.10
const total = items.reduce((s, i) => s + i.priceCents, 0);        // B: priceCents = 110
```

---

## ⭐⭐⭐ The deep end (36–50)

**36. What does this print, in what order?**
```js
console.log("A");
setTimeout(() => console.log("B"), 0);
(async () => { console.log("C"); await null; console.log("D"); })();
Promise.resolve().then(() => console.log("E"));
console.log("F");
```

**37. What does this print?**
```js
function* take() { yield "a"; yield "b"; return "c"; }
console.log([...take()]);
```

**38. What does this print?**
```js
const lru = new Map();
lru.set("a", 1); lru.set("b", 2); lru.set("c", 3);
lru.get("a");
console.log([...lru.keys()]);
lru.delete("a"); lru.set("a", 1);
console.log([...lru.keys()]);
```

**39. Spot the bug.** The user types "s", then quickly "search". The "s" request takes 500ms; the "search" request takes 50ms.
```js
async function onInput(query) {
  const results = await fetchResults(query);
  render(results);
}
```

**40. Predict the test result.**
```js
const label = memoize((user) => user.name, (user) => user.id);
test("caches by id", () => {
  assert.equal(label({ id: 1, name: "Ada" }), "Ada");
  assert.equal(label({ id: 1, name: "Grace" }), "Grace");
});
```

**41. Which approach, and why?** You want the first successful response from three mirror servers, and you don't care if the others fail.
```js
await Promise.race(mirrors.map(fetchJson));   // A
await Promise.any(mirrors.map(fetchJson));    // B
await Promise.all(mirrors.map(fetchJson));    // C
```

**42. Spot the bug.**
```js
function debounce(fn, ms) {
  let id;
  return (...args) => { clearTimeout(id); id = setTimeout(() => fn(...args), ms); };
}
input.addEventListener("input", (e) => {
  debounce(() => search(e.target.value), 300)();
});
```

**43. What does this print?**
```js
const seen = new Set([1, 2, NaN]);
console.log(seen.has(NaN), [1, 2, NaN].indexOf(NaN), [1, 2, NaN].includes(NaN));
```

**44. Which approach, and why?** You need a genuine deep copy of `{ when: new Date(), nested: { x: 1 } }`.
```js
const copy = JSON.parse(JSON.stringify(source));   // A
const copy = structuredClone(source);              // B
const copy = { ...source };                        // C
```

**45. Predict the test result.**
```js
const TRANSITIONS = { pending: { pay: "paid" }, paid: {} };
function transition(state, event) {
  const next = TRANSITIONS[state][event];
  if (!next) throw new Error(`Cannot ${event} while ${state}`);
  return next;
}
test("cannot pay twice", () => {
  assert.throws(() => transition("pending", "pay"), /Cannot/);
});
```

**46. What does this print?**
```js
async function* pages() {
  for (let i = 1; ; i++) { console.log("fetching page", i); yield [i]; }
}
for await (const page of pages()) { if (page[0] === 2) break; }
```

**47. Which approach, and why?** You must fetch 2,000 product pages from a partner's API.
```js
const all = [];                                        // A
for (const url of urls) all.push(await fetchJson(url));

const all = await Promise.all(urls.map(fetchJson));    // B

const all = await pool(urls.map((u) => () => fetchJson(u)), 5);   // C
```

**48. What does this print?**
```js
const events = new Map();
function on(name, fn) {
  if (!events.has(name)) events.set(name, new Set());
  events.get(name).add(fn);
  return () => events.get(name).delete(fn);
}
const off = on("tick", () => {});
on("tick", () => {});
console.log(events.get("tick").size);
off();
console.log(events.get("tick").size);
```

**49. Which approach, and why?** Sorting a list of users by age, descending, in a UI that also shows the original order elsewhere.
```js
users.sort((a, b) => b.age - a.age);                        // A
[...users].sort((a, b) => b.age - a.age);                   // B
sortBy(users, (u) => u.age, { descending: true });          // C
```

**50. Predict the test result.** All three, pass or fail.
```js
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
test("1", () => assert.equal(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), true));
test("2", () => assert.equal(deepEqual({ a: undefined }, {}), false));
test("3", () => assert.equal(deepEqual({ a: NaN }, { a: null }), false));
```

---
---

# ✅ Answers

### ⭐ Warm-ups

**1.** `53 2 33 123`. `+` joins strings when either side is a string, and it runs strictly left to right — `1 + 2` is `3` before `"3"` arrives, but `1 + "2"` is `"12"` before `3` does. Every other arithmetic operator only means maths, which is why `"5" - 3` is `2`. → **project 05**

**2.** `object object function true`. `typeof null === "object"` is a 1995 bug that can never be fixed without breaking the web, and arrays are objects. `Array.isArray` is the only reliable array check. → **project 25**

**3.** `[ 1, 10, 9 ]`. The default comparator converts every element to a string and sorts alphabetically, so `"10" < "9"`. Always pass a comparator: `.sort((a, b) => a - b)`. → **project 26**

**4.** `true true true true`. Only six values are falsy: `false`, `0`, `""`, `null`, `undefined`, `NaN`. `"0"`, `"false"`, `[]` and `{}` are all truthy — the string "false" is just a non-empty string. → **project 27**

**5.** `50 0`. `||` falls back on any falsy value, so a legitimate volume of 0 becomes 50. `??` only falls back on `null`/`undefined`, which is what you almost always mean. → **project 11**

**6.** `1 2 1`. Each call to `makeCounter()` creates a fresh, private `c` in a new closure, so `b`'s counter is completely independent of `a`'s. That independence is the entire point of `memoize`. → **project 27**

**7.** It prints `Ada Paris` — the name is safely copied but the city isn't. Spread is a **shallow** copy: `copy.address` and `original.address` are the same object. Use `structuredClone(original)` for a real copy. → **project 25**

**8.** `double(5)` returns `undefined`. An arrow with a `{}` body needs an explicit `return`; braces mean "function body", not "the value". Either `(n) => n * 2` or `(n) => { return n * 2; }`. → **project 03**

**9.** `total = total + 1` throws `TypeError: Assignment to constant variable`. `const` freezes the **binding**, not the value — that's why mutating `settings.theme` is fine while reassigning `total` is not. Use `let` for anything you reassign. → **project 01**

**10.** **B.** `==` converts before comparing, by rules nobody remembers correctly (`null >= 0` is `true` but `null == 0` is `false`; `[] == false` is `true`). Use `===` everywhere; the only defensible exception is `x == null` as a compact "null or undefined?". → **project 25**

**11.** `[ 1, 2, 3 ]` then `[ 1, NaN, NaN ]`. `map` passes `(value, index, array)`, and `parseInt(string, radix)` reads that index as a number base: base 0 defaults to 10, base 1 is invalid, base 2 parses "3" as binary and fails. Only pass callbacks whose arity you control. → **project 26**

**12.** Unknown names cache `null`, and `null != undefined` is **false** with loose `!=` — so every unknown name misses the cache and redoes the slow lookup forever, exactly where the work was most wasted. Ask "does an entry exist?" instead: a `Map` with `cache.has(name)`. Bonus bug: `findUser("toString")` returns a function straight off `Object.prototype`, and the global `cache` is shared with every other function that pastes this pattern. → **project 27**

**13.** **B.** A plain object inherits properties, so `counts["toString"]` is already a function before you count anything, and `"__proto__"` can't be used as a key at all. A `Map` has no inherited keys, keeps insertion order, and `has`/`get` mean exactly what they say. → **project 02**

**14.** **It fails.** `assert.equal` is `===`, and two arrays with the same contents are different objects. You want `assert.deepEqual([1, 3], [1, 3])`, which compares structure. → **project 45**

**15.** **B.** A sentinel return (`null`) puts the burden on every caller to remember a check, and the one who forgets gets `null` flowing three layers deep before anything complains. Throwing makes ignoring the failure impossible and carries a message; catch it once, at the boundary. → **project 30**

### ⭐⭐ Real code

**16.** `[ 3, 3, 3 ]`. `var` is function-scoped, so all three arrows close over the *same* `i`, which is 3 by the time they run. `let` creates a fresh binding per iteration and gives `[ 0, 1, 2 ]`. → **project 27**

**17.** `canCheckout([])` returns `true` — an empty cart passes checkout. `[].every(fn)` is vacuously true ("all zero items pass"). Add the emptiness check you actually meant: `cart.length > 0 && cart.every(...)`. → **project 26**

**18.** Prints `X..|X..|X..` — one `X` becomes three. `fill` puts the *same* inner array in all three slots, so all rows are one object. Use `Array.from({ length: 3 }, () => Array(3).fill("."))`. → **project 16**

**19.** `sort` mutates in place *and* returns the same array, so `topThree` silently reorders the caller's `leaderboard` and `sorted === rows`. A function that takes data should never modify it: `[...rows].sort(...)` or `rows.toSorted(...)`. → **project 26**

**20.** `null 10`. Destructuring defaults fire only for `undefined`, never for `null` — `null` is a value, and someone explicitly chose it. If `null` should also mean "absent", use `theme ?? "dark"`. → **project 31**

**21.** The file gets `{"theme":"dark","ratio":null,"tags":{}}`. `JSON.stringify` silently drops functions and `undefined`, turns `NaN` (and `Infinity`) into `null`, and flattens a `Set` to `{}`. Stored data is input: only serialise plain data, and validate it on the way back in. → **projects 55, 63**

**22.** `2 [Function: toString]`. The count of `l` is right, but `counts["toString"]` was never counted — it's inherited from `Object.prototype`. A `Map`, or `Object.create(null)`, has no such ghosts. → **project 02**

**23.** `err.name` is `"Error"`, not `"AppError"` — subclassing doesn't set the name, so every log line loses the one word identifying the failure. Add `this.name = "AppError";` after `super(message)`. → **project 30**

**24.** `B`, then `A`, then `C`. `finally` always runs, even on the way out through a `return` — so `f` prints B before delivering "A". And a `return` inside `finally` *replaces* the one in `try`, which is why `g()` is "C" (and why you should never return from `finally`). → **project 30**

**25.** `loadAll` returns `[]` immediately. `forEach` ignores the promises its callback returns, so nothing is awaited and the pushes happen long after `return`. Use `for (const id of ids) users.push(await fetchUser(id))` for sequential, or `await Promise.all(ids.map(fetchUser))` for parallel. → **project 42**

**26.** `one four three two`. Synchronous code first; then all microtasks (promise callbacks); then macrotasks (timers). `setTimeout(fn, 0)` means "after everything already queued", never "now". → **project 42**

**27.** Prints `2 2 true` — "one month after Jan 31" is March 2, and `jan31` was modified. `Date` is mutable, months are 0-indexed, and setting month 1 on day 31 overflows Feb into March. Copy first (`new Date(date)`) and do day-based math. → **project 33**

**28.** `4 1 2`. Splitting `"a,b,,c"` keeps the empty field. Splitting an empty string gives `[""]`, not `[]` — the single most common off-by-one in file parsing. And `","` splits into two empty strings. → **project 34**

**29.** Throws `TypeError: Cannot read properties of undefined (reading 'balance')`. `this` is decided by *how* a function is called; pulled off the object it's a plain call, and class bodies always run in strict mode, so `this` is `undefined` (even in a non-module script). Fix with `acc.report.bind(acc)`, `() => acc.report()`, or by using a closure-based factory with no `this` at all. → **project 29**

**30.** **A, debounce.** Debounce waits for a pause — one request after the user stops typing, which is what a search box wants. Throttle fires on a schedule *while* the user types, so you'd still send a request every 300ms and pay for answers nobody reads. Throttle is for continuous streams you must sample: scroll, mousemove, resize. → **project 28**

**31.** **B.** `Promise.all` rejects on the *first* failure and throws away the four results you already have. `allSettled` never rejects — you get `{status, value}` / `{status, reason}` per widget and render what worked. `race` returns only one. → **projects 43, 52**

**32.** Prints `[ 'Ada', '"hello', ' world"' ]` — the quoted field is split at the comma inside it. `split` has no idea what a quote is; CSV needs a real parser, and the minimum viable one is a character loop with a single `inQuotes` boolean. Same lesson for HTML, JSON and "regex parsers". → **project 34**

**33.** A comment whose `body` contains `<img src=x onerror=alert(1)>` executes. `innerHTML` parses its string as HTML, so any user text becomes code — that's **XSS**. Build the node with `createElement` and `textContent`, or escape by default before interpolating. → **projects 35, 62**

**34.** **The test itself passes — falsely.** `assert.rejects` returns a promise, and without `await` (or `return`) the test function finishes before the assertion resolves, so nothing can fail it. Node 22 is kind enough to add a separate diagnostic — *"generated asynchronous activity after the test ended… would have caused the test to fail"* — but the green tick is still there. Always `await` async assertions; that false green is the whole subject of the test-runner rebuild. → **project 58**

**35.** **B, integer cents.** `1.10 + 2.20` is `3.3000000000000003`, so `total === 3.30` is `false` — and converting back with `4.35 * 100` gives `434.99999999999994`, which `Math.floor` turns into 434 cents. Store integers, do all arithmetic in integers, and divide by 100 only inside `Intl.NumberFormat` at the moment of display. → **project 32**

### ⭐⭐⭐ The deep end

**36.** `A C F D E B`. The async function runs synchronously up to its first `await`, so `C` prints immediately and its continuation (`D`) is queued as the *first* microtask — before the `.then` that queues `E`. `F` finishes the synchronous pass; then microtasks in order (D, E); then the timer (B). → **projects 42, 57**

**37.** `[ 'a', 'b' ]`. Spreading a generator collects everything it *yields*; the `return` value is delivered as `{value: "c", done: true}` and iteration protocols discard it. If a generator needs to report a final value, yield it. → **project 22**

**38.** `[ 'a', 'b', 'c' ]` then `[ 'b', 'c', 'a' ]`. `Map` guarantees insertion order and `get` does not change it — only delete-then-set moves a key to the end. That's exactly how an LRU cache tracks recency in one structure, with the first key always being the eviction candidate. → **project 41**

**39.** The slow "s" response arrives 450ms *after* the "search" results and overwrites them — the user sees results for a query they've moved on from. Fix with a latest-wins ticket (`const t = ++latest; ...; if (t !== latest) return;`) or an `AbortController`. Debouncing reduces the odds but does not close the race. → **project 54**

**40.** **The second assertion fails**, expecting "Grace" but getting "Ada". The custom `keyOf` says "these two users are the same" because the ids match, so the cached name comes back for a different object — the correct, documented behaviour of a custom key function, and the reason `keyOf` is a parameter rather than a hardcoded `JSON.stringify`. → **project 27**

**41.** **B.** `race` settles on the first promise to *settle either way* — one fast rejection and you get an error while a working mirror is still in flight. `any` resolves on the first *success*, rejecting only if all fail. `all` needs every mirror to work, which is the opposite of what mirrors are for. → **project 43**

**42.** A brand-new debounced function is created on every keystroke and immediately called once, so nothing is ever cancelled and `search` fires on *every* character. The debounced function must be created **once**, outside the handler: `const onInput = debounce(search, 300); input.addEventListener("input", (e) => onInput(e.target.value));`. → **project 28**

**43.** `true -1 true`. `NaN` is the only value not equal to itself, so `indexOf` (which uses `===`) can't find it, while `Set` and `includes` use same-value-zero and can. This is exactly why a deep-equality function needs `Object.is`, not `===`. → **project 25**

**44.** **B.** The JSON round-trip turns the `Date` into a string, and would also drop functions and `undefined`. Spread is shallow, so `nested` stays shared. `structuredClone` is built into Node and browsers, handles dates, Maps, Sets and cycles, and needs no library. → **project 25**

**45.** **It fails**, with `Missing expected exception.` — `transition("pending", "pay")` is a *legal* move and returns `"paid"`. The test name says "cannot pay twice", so it should exercise the second payment: `assert.throws(() => transition("paid", "pay"), /Cannot pay while paid/)`. → **project 40**

**46.** Two lines: `fetching page 1` and `fetching page 2`. An async generator is lazy — it only runs up to the next `yield` when the consumer asks — so `break` stops it before page 3 is ever fetched. That laziness is the whole point: pagination that stops costing money the moment you have what you need. → **project 44**

**47.** **C.** A is 2,000 sequential round-trips — minutes of waiting for work that could overlap. B opens 2,000 connections at once and earns you a 429 rate-limit, dropped sockets, or a ban. A pool with a small concurrency limit gets nearly all of B's speed while staying a good citizen. → **project 42**

**48.** `2` then `1`. `on` returns a closure that remembers exactly which function it added, so callers unsubscribe without needing to hold onto the original reference or guess at an `off(name, fn)` signature. Returning the undo handle from the do-er is a pattern worth stealing everywhere. → **project 38**

**49.** **C, or B if you have no helper.** A mutates the caller's array, so the "original order" view silently reorders too — the bug from question 19. B is correct but repeats the comparator at every call site. C names the intent, takes a **key function** (`(u) => u.age`) instead of a comparator you can get backwards, and never mutates. → **project 26**

**50.** Test 1 **fails** (JSON key order differs, so it returns `false` for two equal objects). Test 2 **fails** (`undefined` is dropped, so both stringify to `{}` and it returns `true`). Test 3 **fails** (`NaN` serialises to `null`, so it returns `true` for two different values). JSON comparison lies in both directions — write a real recursive deep-equal using `Object.is`. → **project 25**

---

*Scored under 35? Don't reread this file — go run the `original.js` of the projects you missed and break them on purpose. The bug you've watched happen is the one you stop writing.*
