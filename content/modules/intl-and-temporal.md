# Intl and Temporal: formatting and time done properly

Prices, dates, "3 days ago", plurals and sorted name lists appear on nearly
every screen of a CRUD app, and each has a hand-rolled version that is subtly
wrong for someone. The built-in `Intl` APIs fix formatting; Temporal, now
shipping, fixes the `Date` object. Interviewers ask about both because
time-zone and currency bugs reach real customers and are expensive to unpick.

Output below is from Node 24 with its bundled ICU data. Browsers can differ in
small details such as spacing characters.

## `Intl.NumberFormat`: money, compact numbers, units

```js
const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });
gbp.format(1234.5);                                      // '£1,234.50'
new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
  .format(1234.5);                                       // '1.234,50 €'
new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' })
  .format(1234.5);                                       // '￥1,235' (yen has no minor unit)
new Intl.NumberFormat('en-GB', { notation: 'compact' }).format(1_530_000); // '1.5m'
new Intl.NumberFormat('en-GB', { style: 'unit', unit: 'kilobyte', unitDisplay: 'short' })
  .format(512);                                          // '512 kB'
new Intl.NumberFormat('en-GB', { style: 'percent', maximumFractionDigits: 1 })
  .format(0.1234);                                       // '12.3%'
```

Points interviewers probe:

- **The locale and the currency are separate.** The locale decides separators
  and symbol position; the currency decides the symbol and the number of
  decimals. A German user viewing a GBP price wants `1.234,50 £`.
- **Formatting is for display only.** Store and calculate money in integer
  minor units (pence) and divide at the edge, as in the
  [money cart project](../../32-money-cart/). Never parse a formatted string
  back into a number.
- **Construct once, reuse.** Creating a formatter is far slower than calling
  `format`. Build it at module level or memoise it, not inside a render loop.

## `Intl.DateTimeFormat` and the `timeZone` option

A `Date` is an instant. How it *reads* depends on the time zone you format it
in, and by default that is the zone of whatever machine runs the code:

```js
const when = new Date('2026-11-03T14:00:00Z');
const opts = { dateStyle: 'medium', timeStyle: 'short' };
new Intl.DateTimeFormat('en-GB', { ...opts, timeZone: 'Europe/London' }).format(when);
// '3 Nov 2026, 14:00'
new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'America/New_York' }).format(when);
// 'Nov 3, 2026, 9:00 AM'
new Intl.DateTimeFormat('en-GB', {
  hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Tokyo', timeZoneName: 'short',
}).format(when);
// '23:00 GMT+9'
```

On a server, **always pass `timeZone`** when formatting for a user (from their
profile, or `Intl.DateTimeFormat().resolvedOptions().timeZone` sent up from the
browser). Your container is almost certainly running in UTC; your developer
laptop is not, which is why these bugs pass locally. One gotcha from that last
example: `dateStyle`/`timeStyle` cannot be combined with individual fields like
`timeZoneName`; Node throws `TypeError: Invalid option`.

## Relative times, plurals and lists

```js
const rtf = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });
rtf.format(-1, 'day');   // 'yesterday'
rtf.format(3, 'hour');   // 'in 3 hours'
rtf.format(-2, 'week');  // '2 weeks ago'

new Intl.PluralRules('en-GB').select(1);                     // 'one'
new Intl.PluralRules('en-GB').select(0);                     // 'other'
new Intl.PluralRules('en-GB', { type: 'ordinal' }).select(22); // 'two' (22nd)
new Intl.PluralRules('pl-PL').select(2);                     // 'few'
new Intl.PluralRules('pl-PL').select(5);                     // 'many'

new Intl.ListFormat('en-GB').format(['Ana', 'Ben', 'Chloé']); // 'Ana, Ben and Chloé'
new Intl.ListFormat('en-US').format(['Ana', 'Ben', 'Chloé']); // 'Ana, Ben, and Chloé'
new Intl.ListFormat('en-GB', { type: 'disjunction' }).format(['card', 'PayPal']);
// 'card or PayPal'
```

`RelativeTimeFormat` does not work out the difference for you: you compute
"-1 day" yourself and it supplies the words. `PluralRules` is why
`count === 1 ? 'item' : 'items'` is an English-only shortcut; Polish has
separate forms for 2 and 5. It returns a *category*, which you use as a key
into your translation strings. The i18n library you use (i18next, FormatJS)
calls these APIs underneath.

## Sorting and splitting text: `Collator` and `Segmenter`

The default `sort()` compares UTF-16 code units, so capitals sort before
lower case and accented letters land at the end:

```js
['zebra', 'Émile', 'apple', 'Zoë'].sort();
// [ 'Zoë', 'apple', 'zebra', 'Émile' ]
['zebra', 'Émile', 'apple', 'Zoë'].sort(new Intl.Collator('en-GB').compare);
// [ 'apple', 'Émile', 'zebra', 'Zoë' ]
['item10', 'item2', 'item1'].sort(new Intl.Collator('en', { numeric: true }).compare);
// [ 'item1', 'item2', 'item10' ]
'résumé'.localeCompare('RESUME', 'en', { sensitivity: 'base' }); // 0: equal
```

`a.localeCompare(b, locale, options)` is the one-off form; a `Collator`'s
`compare` is faster for sorting large lists. `sensitivity: 'base'` gives
accent- and case-insensitive matching for search boxes.

`Intl.Segmenter` splits text into what users perceive as characters, words or
sentences. `'👍🏽👨‍👩‍👧'.length` is `12`, but segmenting by grapheme gives `2`, which
is the number a "characters remaining" counter should show. Word
segmentation handles apostrophes and languages without spaces:
`"Don't stop, now."` gives `Don't`, `stop` and `now` as the word-like segments.

## The `Date` pitfalls you will be asked about

```js
new Date(2026, 1, 31).toDateString(); // 'Tue Mar 03 2026'

// with the process in New York (TZ=America/New_York):
new Date('2026-09-24').toString();       // Wed Sep 23 2026 20:00:00 GMT-0400
new Date('2026-09-24T00:00').toString(); // Thu Sep 24 2026 00:00:00 GMT-0400
```

1. **Months are zero-based** in the constructor and `getMonth()`; days are not.
   Month `1` is February, and the 31st overflows silently into March.
2. **A date-only ISO string is parsed as UTC midnight**, while a date-time
   string without an offset is parsed as *local* time. So a birthday of
   `2026-09-24` displays as the 23rd for everyone west of Greenwich. This is
   the most common date bug in CRUD apps.
3. **"Local" means the machine's zone.** On a server that is the container's
   zone, not your user's.
4. **`Date` is mutable.** `setDate` changes the object in place, so a shared
   "today" can be altered by any function you pass it to.
5. **There is no date-only or time-only type.** Everything is an instant, so
   "a date" is really "midnight somewhere", and you have to remember where.

The [date utils project](../../33-date-utils/) walks through fixing several of
these by hand. Temporal removes them at the type level.

## Temporal: a type for each job

Temporal is the new built-in date-time API. It ships in Chrome 144, Firefox 139
and Node 26; in Node 24 it sits behind `--harmony-temporal`, and that flagged
build is incomplete (for instance `zonedDateTime.timeZoneId` is `undefined`
there), so do not use it in production on Node 24. For older runtimes use the
`@js-temporal/polyfill` package. All Temporal objects are **immutable**, and
months are 1-based.

| Type | Holds | CRUD example | Database column |
|------|-------|--------------|-----------------|
| `Temporal.Instant` | An exact moment, no zone | `createdAt`, audit logs, token expiry | `timestamptz` / `datetimeoffset` |
| `Temporal.PlainDate` | A calendar date | Birthday, invoice due date, bank holiday | `date` |
| `Temporal.PlainTime` | A wall-clock time | Shop opens at 09:00 | `time` |
| `Temporal.PlainYearMonth` | A month | Card expiry, billing period | `date` (first of month) or text |
| `Temporal.ZonedDateTime` | Instant + IANA zone + calendar | A meeting at 9am in New York | Local date-time + zone id |
| `Temporal.Duration` | A length of time | Subscription term, SLA | `interval` or ISO 8601 text |

Run with `node --harmony-temporal` on Node 24:

```js
Temporal.PlainDate.from('2026-01-31').add({ months: 1 }).toString();
// '2026-02-28': clamps instead of overflowing

const meeting = Temporal.ZonedDateTime.from({
  year: 2026, month: 11, day: 3, hour: 9, timeZone: 'America/New_York',
});
meeting.toString();   // '2026-11-03T09:00:00-05:00[America/New_York]'
meeting.toInstant().toString(); // '2026-11-03T14:00:00Z'
meeting.withTimeZone('Europe/London').toPlainTime().toString(); // '14:00:00'

// Clocks go forward in London at 01:00 on 29 March 2026:
const z = Temporal.ZonedDateTime.from('2026-03-29T00:30[Europe/London]');
z.add({ hours: 1 }).toString(); // '2026-03-29T02:30:00+01:00[Europe/London]'
z.add({ days: 1 }).toString();  // '2026-03-30T00:30:00+01:00[Europe/London]'

Temporal.PlainDate.from('2026-09-24').until('2026-12-25').days; // 92
const d = Temporal.Duration.from({ hours: 1, minutes: 90 });
d.round({ largestUnit: 'hour' }).toString(); // 'PT2H30M'
```

Adding one *hour* across the DST change moves the wall clock by two, because
01:30 does not exist that night; adding one *day* keeps the same wall-clock
time. `Date` arithmetic in milliseconds cannot tell those apart. Compare values
with `Temporal.PlainDate.compare(a, b)` or `a.equals(b)`, never `<`, which
throws on Temporal objects by design.

## Storage advice

- **Past events: store the instant in UTC.** `created_at`, `paid_at` and log
  timestamps go in a `timestamptz` (Postgres) or `datetimeoffset` (SQL Server)
  column, and cross the API as ISO 8601 strings ending in `Z`. Format into the
  viewer's zone at display time.
- **Dates that are just dates: store a `date`.** A birthday is not an instant.
  Send it as `"2026-09-24"` and parse it with `Temporal.PlainDate.from`, never
  `new Date()`.
- **Future local events: store the wall time and the IANA zone.** "Every Monday
  09:00, Europe/London" or "9am on 3 November, America/New_York". Governments
  change time-zone rules; if you convert a meeting a year away to UTC today and
  the rules change, the meeting silently moves. Store the zone id
  (`Europe/London`), not an offset (`+01:00`), because the offset changes twice
  a year.
- **Durations: store the ISO 8601 form** (`P1M`, `PT30M`), since "one month" is
  not a fixed number of seconds.

## What you should be able to answer

- Why does `new Date('2026-09-24')` show the 23rd for a user in New York, and how would you represent a birthday instead?
- A Node server formats order times correctly on your laptop but an hour or more off in production. What is the likely cause and fix?
- How would you format a price for a German user paying in pounds, and why store it in pence?
- Why is `count === 1 ? 'item' : 'items'` wrong for an international app, and which API replaces it?
- Which Temporal type would you use for `createdAt`, a birthday, and a meeting next spring, and how would you store each?
- Why store a future event's IANA time zone rather than converting it to UTC now?
