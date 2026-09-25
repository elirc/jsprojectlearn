# Numbers, money and precision

Every CRUD app eventually shows a price, a total or an id, and JavaScript has
exactly one everyday number type: a 64-bit binary float. Interviewers ask
"why is `0.1 + 0.2` not `0.3`?" and "how would you store money?" because the
answers separate people who have shipped a checkout from people who have only
read about one. This guide gives you the mechanism and the working rules.

## One number type, and what it can hold

`number` is an IEEE 754 double: 52 bits of fraction, 11 bits of exponent, one
sign bit. Two consequences matter at work.

**Integers are exact up to 2^53 − 1.** Beyond `Number.MAX_SAFE_INTEGER`
(9,007,199,254,740,991), neighbouring integers can no longer all be
represented, so they silently collapse together.

```js
console.log(Number.MAX_SAFE_INTEGER);            // 9007199254740991
console.log(2 ** 53 === 2 ** 53 + 1);             // true
console.log(JSON.parse('{"id":9007199254740993}').id); // 9007199254740992
```

That last line is a real production bug: a 64-bit database id or a Twitter-style
snowflake id arrives as a JSON number and is quietly changed by one. APIs that
hand out big ids send them as **strings** for this reason, and so should yours.

**Most decimal fractions are not exact.** 0.1 in binary is a repeating fraction,
like 1/3 in decimal, so it is stored as the nearest double.

```js
console.log(0.1 + 0.2);                 // 0.30000000000000004
console.log(19.99 * 100, 0.07 * 100);   // 1998.9999999999998 7.000000000000001
console.log(Math.abs(0.1 + 0.2 - 0.3) < Number.EPSILON); // true
```

Comparing floats with a tolerance is fine for measurements and tests
(`expect(x).toBeCloseTo(0.3)` in Vitest). It is not a strategy for money.

## Store money as integers in minor units

The standard answer: hold money as an **integer count of the smallest unit** —
pence, cents — plus a currency code. Integer addition, subtraction and
multiplication by integers are exact, so totals never drift.

```js
const lines = [
  { name: 'Tea', pence: 250, qty: 2 },
  { name: 'Cake', pence: 199, qty: 3 },
];
const subtotal = lines.reduce((sum, l) => sum + l.pence * l.qty, 0);
console.log(subtotal); // 1097, i.e. £10.97
```

| Layer | Representation |
|-------|----------------|
| JavaScript | integer `number` of minor units, or `BigInt` for very large sums |
| JSON | integer (`"amount": 1097, "currency": "GBP"`) or a decimal **string** |
| Postgres | `numeric(12,2)` or `bigint` minor units — never `real`/`double` |
| SQL Server | `decimal(19,4)` or `bigint` minor units — avoid `money`'s rounding quirks |
| C# | `decimal` |

Not every currency has two decimal places: yen has none and some dinars have
three. Store the currency alongside the amount and ask `Intl` how many digits
it uses rather than hard-coding 100. For the full exercise, see
[../../32-money-cart/](../../32-money-cart/).

## Parsing what users type

Never run user input through `parseFloat` and multiply by 100: `'19.99' * 100`
is `1998.9999999999998`, and `parseFloat('1,299.00')` is `1`. Parse the string
directly into minor units and reject anything you do not understand.

```js
function toPence(input) {
  const m = /^\s*(\d+)(?:\.(\d{1,2}))?\s*$/.exec(input);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

console.log(toPence('19.99'), toPence('19.9'), toPence('20')); // 1999 1990 2000
console.log(toPence('1,299.00'), toPence('abc'));              // null null
```

Real forms also need locale awareness (a German user types `1.299,00`). Either
constrain the input (`inputmode="decimal"` and a known locale) or use a
library; do not guess.

## Rounding, and where it bites

You need rounding whenever you divide or apply a percentage: VAT, discounts,
currency conversion, splitting a bill. Three traps:

```js
console.log((1.005).toFixed(2), (1.255).toFixed(2)); // 1.00 1.25
console.log(Math.round(2.5), Math.round(-2.5));      // 3 -2
console.log(Math.round(1.005 * 100) / 100);          // 1
```

- `toFixed` rounds the *stored* binary value, which for `1.005` is slightly
  below 1.005, so it rounds down. It also returns a **string**.
- `Math.round` rounds halves towards +∞, so negative halves go the "wrong"
  way for refunds.
- Multiply-round-divide on a float is the same problem at a smaller scale.

Do the arithmetic in integers and round **once**, with an explicit rule:

```js
const vatPence = (netPence, basisPoints) => Math.round((netPence * basisPoints) / 10000);
console.log(vatPence(1999, 2000)); // 400: 20% VAT on £19.99, rounded to the penny

function roundHalfEven(x) {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff !== 0.5) return Math.round(x);
  return floor % 2 === 0 ? floor : floor + 1;
}
console.log(roundHalfEven(2.5), roundHalfEven(3.5)); // 2 4
```

**Banker's rounding** (half to even) is what C#'s `Math.Round` does by default
and what many finance systems expect, because it does not bias totals upwards.
Whatever rule you pick, agree it with the business and use it in one place.

## Splitting without losing a penny

£10.00 split three ways is not three × £3.33. Hand out the remainder:

```js
const allocate = (totalPence, parts) =>
  Array.from({ length: parts }, (_, i) =>
    Math.floor(totalPence / parts) + (i < totalPence % parts ? 1 : 0));

const shares = allocate(1000, 3);
console.log(shares, shares.reduce((a, b) => a + b)); // [ 334, 333, 333 ] 1000
```

The same idea applies to spreading a discount across order lines: allocate in
integers so the lines always sum to the order total, and your accounting export
reconciles.

## `BigInt` for big integers

`BigInt` (`123n`) represents integers of any size exactly. It is the right type
for 64-bit database ids you need to do arithmetic on, and for sums that could
exceed 2^53 minor units.

```js
console.log(10n / 3n, 10n % 3n, typeof 10n); // 3n 1n bigint
try {
  console.log(1n + 1);
} catch (e) {
  console.log(e.message); // Cannot mix BigInt and other types, use explicit conversions
}

const parsed = JSON.parse('{"id":9007199254740993}', (key, value, ctx) =>
  key === 'id' ? BigInt(ctx.source) : value);
console.log(parsed.id); // 9007199254740993n
```

Rules: you cannot mix `BigInt` and `number` in arithmetic; division truncates;
`JSON.stringify` throws on a BigInt unless you add a `toJSON` or replacer; and
`Math` functions do not accept it. The reviver's third argument (`ctx.source`,
available in Node 24) lets you recover the exact digits of big JSON numbers.
More in [JSON edge cases](json-edge-cases.md).

## Formatting for display

Formatting is the last step, at the edge, with `Intl.NumberFormat`. Never build
currency strings by hand.

```js
const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
console.log(gbp.format(1097 / 100)); // £10.97
console.log(new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(1234.5)); // 1.234,50 €
console.log(new Intl.NumberFormat('en', { style: 'currency', currency: 'JPY' })
  .resolvedOptions().maximumFractionDigits); // 0
```

Create formatters once and reuse them; constructing one per table cell is
measurably slow. Dividing by 100 here is safe because the result is only
displayed, never fed back into arithmetic.

## What you should be able to answer

- Why is `0.1 + 0.2 !== 0.3`, and when is comparing with a tolerance
  acceptable?
- How would you store and transmit money in a JavaScript/Postgres/C# stack?
- What is `Number.MAX_SAFE_INTEGER`, and what goes wrong with 64-bit ids in
  JSON? How do you fix it?
- Why is `(1.005).toFixed(2)` `"1.00"`, and how should you round a VAT amount?
- How do you split £100 three ways so the parts add up exactly?
- When would you use `BigInt`, and what are its restrictions?
