# JSON edge cases

JSON is the format every CRUD app speaks: request bodies, API responses,
`localStorage`, config files, queue messages. `JSON.stringify` and `JSON.parse`
look trivial, but they silently drop fields, change types, lose precision and
can open a security hole. Interviewers ask "what does `JSON.stringify` do with
`undefined`?" or "why did this id change?" to see whether you have debugged
real payloads.

## JSON is not JavaScript

JSON is a data format with six types: object, array, string, number, boolean
and `null`. It has no `undefined`, no functions, no dates, no comments, no
trailing commas, and keys must be double-quoted strings.

```js
for (const text of ["{'a':1}", '{"port":3000,}', '']) {
  try {
    JSON.parse(text);
  } catch (e) {
    console.log(e.name); // SyntaxError, three times
  }
}
console.log(JSON.parse('1e400'), JSON.parse(' [1] ')); // Infinity [ 1 ]
```

If a config file needs comments, use a format that allows them (JSONC, YAML,
TOML) or a `.js`/`.ts` config — not `JSON.parse` with hand-rolled stripping.

## What `JSON.stringify` drops or changes

| Value | In an object property | In an array | At top level |
|-------|-----------------------|-------------|--------------|
| `undefined`, function, symbol | property **omitted** | `null` | returns `undefined` |
| `NaN`, `Infinity`, `-Infinity` | `null` | `null` | `"null"` |
| `-0` | `0` | `0` | `"0"` |
| `Date` | ISO string (via `toJSON`) | ISO string | ISO string |
| `Map`, `Set`, class instance | own enumerable props only (`{}` for Map/Set) | same | same |
| `BigInt` | **throws** TypeError | throws | throws |
| circular reference | **throws** TypeError | throws | throws |
| symbol keys, non-enumerable props | ignored | — | — |

```js
console.log(JSON.stringify({
  a: undefined, b: () => 1, d: NaN, f: new Date(0), g: new Map([[1, 2]]), h: [undefined], j: null,
}));
// {"d":null,"f":"1970-01-01T00:00:00.000Z","g":{},"h":[null],"j":null}
```

The dropped-`undefined` rule has an API consequence. In a PATCH body,
`{ phone: undefined }` is sent as `{}` — "don't change phone" — while
`{ phone: null }` means "clear phone". Decide which one your client means and
send `null` explicitly when clearing.

Errors are a special case: `message` and `stack` are non-enumerable, so
`JSON.stringify(new Error('x'))` is `{}`. Structured loggers copy `name`,
`message`, `stack` and `cause` explicitly.

## Controlling output: `toJSON`, replacers and indentation

`JSON.stringify(value, replacer, space)` has two optional arguments, and any
object can define `toJSON()` to choose its own representation.

```js
class Money {
  #pence;
  constructor(pence) { this.#pence = pence; }
  toJSON() { return { amount: this.#pence, currency: 'GBP' }; }
}

const user = { id: 1, name: 'Ada', passwordHash: 'x9f...', balance: new Money(1097) };
console.log(JSON.stringify(user, ['id', 'name']));        // {"id":1,"name":"Ada"}
console.log(JSON.stringify({ balance: user.balance }));   // {"balance":{"amount":1097,"currency":"GBP"}}
console.log(JSON.stringify({ id: 42n }, (key, value) =>
  typeof value === 'bigint' ? value.toString() : value)); // {"id":"42"}
console.log(JSON.stringify({ a: [1] }, null, 2).split('\n').length); // 5 lines, pretty-printed
```

- An **array replacer** is an allow-list of keys. It is a quick way to strip
  secrets, but do not rely on it as your only defence: map database rows to
  explicit response DTOs so a new column never leaks by default.
- A **function replacer** sees every key/value pair and can transform or drop
  it (return `undefined`).
- `space` (a number or string) pretty-prints for logs and files; APIs should
  send compact JSON.

## Dates: going out is easy, coming back is not

Dates serialise to ISO 8601 strings in UTC, which is exactly what you want on
the wire. `JSON.parse` does not know they were dates, so they come back as
strings. `createdAt.getTime()` then throws.

Use a **reviver** to convert known fields, or better, validate the payload with
a schema that coerces them:

```js
const text = '{"id":7,"createdAt":"2026-01-01T09:30:00.000Z","note":"2026 plan"}';
const order = JSON.parse(text, (key, value) =>
  key.endsWith('At') && typeof value === 'string' ? new Date(value) : value);

console.log(order.createdAt instanceof Date, typeof order.note); // true string
```

Keying on field names is safer than "anything that looks like a date": a
free-text field that happens to start with digits should stay a string.

## Big numbers and ids

JSON numbers have no size limit, but `JSON.parse` turns them into JavaScript
doubles, which are exact only up to 2^53 − 1. A 64-bit id is silently
rounded:

```js
console.log(JSON.parse('{"id":9007199254740993}').id); // 9007199254740992

const exact = JSON.parse('{"id":9007199254740993}', (key, value, ctx) =>
  key === 'id' ? BigInt(ctx.source) : value);
console.log(exact.id); // 9007199254740993n
```

The fix belongs in the API contract: send big ids (and exact decimals such as
money amounts) as **strings**. The reviver's `context.source` argument, available
in Node 24, lets you recover the original digits when you cannot change the
producer. See [numbers and money](numbers-and-money.md).

## Key order and repeated keys

`JSON.stringify` writes keys in the object's property order: integer-like keys
first in ascending order, then the rest in insertion order. Two objects with
the same content can therefore serialise differently, which is why comparing
`JSON.stringify(a) === JSON.stringify(b)` is not a reliable equality check, and
why cache keys built this way need sorted keys.

```js
console.log(JSON.stringify({ b: 1, a: 2, 1: 3 })); // {"1":3,"b":1,"a":2}
console.log(JSON.parse('{"role":"user","role":"admin"}').role); // admin
```

Repeated keys are legal to parse, and the **last one wins**. If a proxy or
validator reads the first value and your app reads the last, an attacker can
smuggle `"role":"admin"` past the check. Reject duplicates at the edge if your
security depends on them.

## Untrusted JSON and prototype pollution

`JSON.parse` treats `"__proto__"` as an ordinary own property. The danger comes
later, when naive merge code copies it with plain assignment:

```js
const body = JSON.parse('{"__proto__": {"isAdmin": true}}');
console.log(Object.keys(body)); // [ '__proto__' ]

const merged = Object.assign({}, body);
console.log(merged.isAdmin, {}.isAdmin); // true undefined: this object's prototype was replaced

const spread = { ...body };
console.log(spread.isAdmin); // undefined: spread defines an own property instead
```

A recursive "deep merge" that does `target[key] = …` for every key can go one
step further and write into `Object.prototype` itself, making every object in
the process look like an admin. Defences:

- validate request bodies against a schema and copy only known fields (see
  [runtime validation](typescript-runtime-validation.md));
- skip `__proto__`, `constructor` and `prototype` keys in any merge helper;
- use `Object.create(null)` or a `Map` for dictionaries of user-supplied keys.

Always wrap `JSON.parse` of external input in `try`/`catch` (or `Response.json()`
error handling) and return a 400 with a useful message, rather than letting a
`SyntaxError` become a 500.

## Deep copies and the JSON round trip

`JSON.parse(JSON.stringify(x))` was the old deep-copy trick. Everything in the
table above applies: Dates become strings, Maps become `{}`, `undefined` fields
vanish, cycles throw, class instances lose their methods. Use `structuredClone`
for plain data instead — see [immutability and copying](immutability-and-copying.md).
Maps and Sets need converting explicitly before stringifying; see
[Maps, Sets and weak references](maps-sets-and-weak-refs.md). To see how a JSON
parser works from the inside, build one: [../../69-json-parser/](../../69-json-parser/).

## What you should be able to answer

- What does `JSON.stringify` do with `undefined`, functions, `NaN`, Dates and
  Maps, in objects versus arrays?
- Why does a 19-digit id come back from an API with different digits, and what
  are the two fixes?
- How do you turn ISO date strings back into `Date` objects when parsing, and
  why key on field names?
- What are `toJSON`, an array replacer and a function replacer each for?
- How can `{"__proto__": …}` in a request body become a security problem, and
  how do you prevent it?
- What is the difference between `{ phone: undefined }` and `{ phone: null }` in
  a PATCH request?
