# Equality and coercion

"What's the difference between `==` and `===`?" opens a huge number of
JavaScript interviews. The junior answer is "one checks types". The mid-level
answer explains *how* values are converted, names the four equality algorithms
the language actually uses, and connects them to real bugs: query-string ids
that never match, an empty error list that counts as a failure, and two dates
that are "not equal" on the same day.

## Four kinds of equality

JavaScript has more than two equality checks, and different APIs use different
ones.

| Algorithm | Used by | `NaN` equals `NaN`? | `0` equals `-0`? | Converts types? |
|-----------|---------|---------------------|------------------|-----------------|
| Loose (`==`) | `==`, `!=` | no | yes | yes |
| Strict (`===`) | `===`, `switch`, `indexOf` | no | yes | no |
| SameValueZero | `includes`, `Map`, `Set` | yes | yes | no |
| SameValue | `Object.is`, React state and deps | yes | no | no |

```js
console.log(NaN === NaN, Object.is(NaN, NaN));       // false true
console.log([NaN].indexOf(NaN), [NaN].includes(NaN)); // -1 true
console.log(new Set([0, -0]).size, Object.is(0, -0)); // 1 false
```

For objects, all four compare **references**: two objects are equal only if
they are the same object. `{ a: 1 } === { a: 1 }` is false under every
algorithm. Comparing contents needs your own code or
`util.isDeepStrictEqual` in Node — see [../../25-deep-equal/](../../25-deep-equal/).

## Truthiness: the eight falsy values

Conditions (`if`, `&&`, `||`, `!`, `filter(Boolean)`) convert to boolean. Only
these values are falsy:

| Falsy | Notes |
|-------|-------|
| `false` | |
| `0`, `-0`, `0n` | a real zero quantity is falsy |
| `''` | only the empty string; `' '` and `'0'` are truthy |
| `null`, `undefined` | |
| `NaN` | |
| `document.all` | a browser legacy oddity; ignore it |

Everything else is truthy, including `'0'`, `'false'`, `[]` and `{}`. The bugs
come from both ends:

```js
const errors = [];
const qty = 0;
console.log(errors ? 'has errors' : 'ok');      // has errors: [] is truthy
console.log(qty || 1, qty ?? 1);                // 1 0
console.log(Boolean('0'), Boolean('false'));    // true true
```

Check what you actually mean: `errors.length > 0`, `qty ?? 1` (only
`null`/`undefined` fall back), `value !== undefined`.

## How `==` converts

The loose equality algorithm is short once you see it:

1. Same type → compare like `===`.
2. `null == undefined` is true, and they equal **nothing else**.
3. Number vs string → convert the string to a number.
4. Boolean vs anything → convert the boolean to a number (`true` → 1) first.
5. Object vs primitive → convert the object to a primitive (below), then retry.

```js
console.log('' == 0, '0' == false, [1] == 1, [1, 2] == '1,2'); // true true true true
console.log(null == 0, null == undefined, NaN == NaN);          // false true false
console.log([] == false, [] == ![]);                            // true true
```

Rule 4 is why `'0' == false` is true (false → 0, '0' → 0) while `'0'` is
truthy. Rule 2 is the one legitimate use of `==`: `value == null` checks for
`null` or `undefined` in one go. Most style guides allow exactly that and ban
the rest.

Relational operators (`<`, `>=`) use a different path again: `null >= 0` is
true while `null == 0` is false, because `>=` converts `null` to 0 but `==`
does not.

## Converting objects to primitives

When an object meets an operator, JavaScript calls **ToPrimitive** with a hint:

- `'number'` for unary `+`, `-`, `*`, comparisons with `<`;
- `'string'` for template literals and `String(x)`;
- `'default'` for binary `+` and `==`.

It then calls `obj[Symbol.toPrimitive](hint)` if present; otherwise `valueOf()`
then `toString()` (reversed for the `string` hint). Plain objects fall through
to `'[object Object]'`; arrays to `join(',')`. Dates treat `default` as
`string`, which is why `date + 1` concatenates while `date - 1` subtracts.

```js
const price = {
  pence: 250,
  valueOf() { return this.pence; },
  toString() { return `£${(this.pence / 100).toFixed(2)}`; },
};
console.log(price * 2, `${price}`, price + 1);   // 500 £2.50 251

const start = new Date('2026-01-01T00:00:00Z');
console.log(typeof (start + 1), typeof (start - 1)); // string number
console.log(`Saved ${{ id: 7 }}`);                // Saved [object Object]
```

## The `+` operator and number conversion

Binary `+` concatenates if **either** operand (after ToPrimitive) is a string;
every other arithmetic operator converts to numbers.

```js
console.log(1 + '2', '3' * '4', '5' - 2, true + 1); // 12 12 3 2
console.log([] + [], 1 + null, 1 + undefined);      // (empty string) 1 NaN
console.log(+'', +' 42 ', +'4 2', +'12px');         // 0 42 NaN NaN
```

That is the source of the most common form bug: `input.value` is always a
string, so `total += input.value` concatenates. Convert once, at the boundary,
with `Number(value)` (strict: the whole string must be numeric) or
`parseInt(value, 10)` / `parseFloat(value)` (lenient: stops at the first bad
character). Then check `Number.isNaN`. `Number('')` is 0, so treat an empty
field as missing *before* converting. More in
[numbers and money](numbers-and-money.md).

## Comparing the things you actually compare

| You have | Compare with | Not with |
|----------|--------------|----------|
| numbers or ids | `===`, after converting inputs | `==` across types |
| strings, case-insensitively | `a.localeCompare(b, undefined, { sensitivity: 'base' }) === 0` | `toLowerCase()` alone, for accented text |
| dates | `a.getTime() === b.getTime()` | `a === b` |
| objects (shallow) | same key count and `Object.is` per key | `JSON.stringify` |
| objects (deep) | `util.isDeepStrictEqual`, a tested helper | `==` |
| possibly `NaN` | `Number.isNaN(x)` | `x === NaN`, global `isNaN('abc')` |

```js
const a = new Date('2026-01-01');
const b = new Date('2026-01-01');
console.log(a == b, a.getTime() === b.getTime(), a <= b && a >= b); // false true true
```

The last expression works because `<=` converts both dates to numbers. It is
the one place a comparison operator saves you from `getTime()`.

## `switch`, `includes` and friends

`switch` uses `===`, so a string from a query parameter never matches a
numeric `case 1:`. `includes` uses SameValueZero, so `ids.includes('1')` is
false for `[1, 2]`. `Map` and `Set` keys use SameValueZero too, so `'1'` and `1`
are different keys, while a plain object converts every key to a string and
treats them as the same. The fix in every case is the same: parse inputs into
the right type as they enter the system (route params, query strings, form
fields, CSV cells) and compare with strict equality from then on. Validation
libraries such as Zod do exactly this — see
[runtime validation](typescript-runtime-validation.md).

## Rules that keep you out of trouble

- Use `===` and `!==` everywhere; allow `== null` if your team does.
- Convert at the boundary, then never mix types again.
- Use `??` for defaults unless you really want `0` and `''` replaced.
- Check `array.length`, not the array, and `Object.keys(obj).length` for
  "empty object".
- Never compare objects, arrays or dates with `==` or `===` expecting content
  equality.

## What you should be able to answer

- What is the difference between `==`, `===`, `Object.is` and SameValueZero,
  and which APIs use each?
- List the falsy values. Why is `'0'` truthy but `'0' == false` true?
- What does `[1, 2] + [3]` produce, and which conversion steps get you there?
- When is `== null` acceptable, and what does it match?
- How do you correctly compare two `Date` objects, and why does `a <= b` work
  when `a == b` does not?
- A total shows `"0105"` instead of 15. What happened, and where should the fix
  go?
