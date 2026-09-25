# Strings, Unicode and regular expressions

Strings are most of the data a CRUD app handles: names, emails, slugs, search
terms, CSV cells. Interviewers probe two areas. First, Unicode — why an emoji
has a `length` of 2 and why "café" can fail to equal "café". Second, regular
expressions — whether you can read and write the everyday ones, and whether you
know when a regex is the wrong tool or a security risk.

## What `length` counts

JavaScript strings are sequences of **UTF-16 code units**. Most characters fit
in one unit, but anything outside the Basic Multilingual Plane (emoji, many
historic scripts) takes two, a *surrogate pair*. What a user sees as one
character — a **grapheme** — can be several code points joined together.

| Level | `'👍'` | `'👨‍👩‍👧'` | How to count |
|-------|------|--------|--------------|
| UTF-16 code units | 2 | 8 | `str.length` |
| Code points | 1 | 5 | `[...str].length` |
| Graphemes | 1 | 1 | `Intl.Segmenter` |

```js
const family = '👨‍👩‍👧';
const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
console.log(family.length, [...family].length, [...seg.segment(family)].length); // 8 5 1

const preview = 'Hi 👋 there'.slice(0, 4);
console.log(JSON.stringify(preview)); // "Hi \ud83d": half an emoji
```

Consequences: a character counter or a "max 280 characters" rule should count
graphemes; truncating with `slice` can cut an emoji in half; and a database
column limit (`varchar(50)` counts characters, byte limits count UTF-8 bytes)
may disagree with your client-side count. Validate lengths on the server with
the same rule the database uses.

## Normalisation and comparison

The same visible text can be encoded differently. "é" can be one code point
(U+00E9) or "e" followed by a combining accent (U+0301). macOS file names and
some keyboards produce the second form.

```js
const stored = 'café';
const typed = 'café';
console.log(stored === typed, stored.length, typed.length); // false 4 5
console.log(stored.normalize('NFC') === typed.normalize('NFC')); // true
```

Normalise to **NFC** when you store or compare user-entered identifiers such as
usernames, and normalise both sides of a search.

Sorting and case-insensitive matching are locale questions, not byte
questions. The default `sort()` compares code units, so uppercase sorts before
lowercase and accented letters go to the end:

```js
const names = ['zebra', 'Éclair', 'apple', 'Zoe'];
console.log(names.toSorted());                              // [ 'Zoe', 'apple', 'zebra', 'Éclair' ]
console.log(names.toSorted(new Intl.Collator('en').compare)); // [ 'apple', 'Éclair', 'zebra', 'Zoe' ]

const same = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }) === 0;
console.log(same('Resume', 'résumé'), 'Straße'.toUpperCase()); // true STRASSE
```

`Intl.Collator` also takes `numeric: true` so that `file-2` sorts before
`file-10`. Create the collator once and reuse its `compare`.

## Everyday string methods worth knowing precisely

| Method | Watch out for |
|--------|---------------|
| `slice(start, end)` | negative indexes count from the end; prefer it to `substring` |
| `at(-1)` | last character; `str[-1]` is `undefined` |
| `split(sep, limit)` | the limit **drops** the rest, it does not keep a remainder |
| `replace('x', y)` | replaces the **first** match only; use `replaceAll` |
| `replace(str, str)` | `$&`, `$1` in the replacement are special even for string patterns |
| `trim()` | removes all Unicode whitespace, including non-breaking spaces |
| `padStart(n, '0')` | never truncates a longer string |
| template literals | `${null}` prints `"null"`; filter empties before joining |

Strings are immutable: every method returns a new string, and
`status[0] = 'X'` silently does nothing (or throws in strict mode).

## Regex essentials: flags

A regex literal is `/pattern/flags`. The flags change behaviour more than most
people expect.

| Flag | Effect |
|------|--------|
| `g` | find all matches; makes the regex **stateful** with `lastIndex` |
| `i` | case-insensitive |
| `m` | `^` and `$` match at every line break |
| `s` | `.` also matches newlines |
| `u` | work in code points; enables `\p{…}` property escapes |
| `v` | a stricter, newer `u` with set operations in classes |
| `y` | sticky: match only at `lastIndex` (tokenisers) |
| `d` | record match indices |

The `g` flag's state is a classic bug: a shared `/admin/g` alternates between
`true` and `false`, because `test` resumes from `lastIndex`.

```js
const isAdmin = /admin/g;
console.log(isAdmin.test('admin'), isAdmin.test('admin')); // true false
console.log(/^.$/.test('👍'), /^.$/u.test('👍'));            // false true
```

Use `g` only when you need every match, and add `u` (or `v`) whenever user text
may contain emoji or non-Latin letters: `/^[\p{L} '-]+$/u` accepts "Zoë
O'Brien", where `/^[a-z]+$/i` rejects most of the world's names.

## Extracting and replacing

Named groups make extraction readable, `matchAll` gives every match with its
groups, and `replace` accepts a function for computed replacements:

```js
const { groups } = '2026-09-24'.match(/(?<y>\d{4})-(?<m>\d{2})-(?<d>\d{2})/);
console.log(`${groups.d}/${groups.m}/${groups.y}`); // 24/09/2026

const tags = [...'Loving #js and #node'.matchAll(/#(\w+)/g)].map((m) => m[1]);
console.log(tags); // [ 'js', 'node' ]

console.log('price: 10, tax: 2'.replace(/\d+/g, (n) => n * 100)); // price: 1000, tax: 200
console.log('2026-09-24'.replace(/(?<y>\d+)-(?<m>\d+)-(?<d>\d+)/, '$<d>.$<m>.$<y>')); // 24.09.2026
```

Lookaheads let one pattern enforce several rules. `(?=.*\d)` means "somewhere
ahead there is a digit" without consuming anything:

```js
const strong = /^(?=.*\d)(?=.*[A-Z]).{12,}$/;
console.log(strong.test('CorrectHorse9'), strong.test('correcthorse9')); // true false
```

(For real password policy, prefer length plus a breached-password check over
composition rules — see [web security basics](web-security-basics.md).)

## User input in patterns, and ReDoS

Two security problems come from regexes.

**Unescaped input.** `new RegExp(search, 'i')` treats `c++` or `(` as syntax,
so the search throws or matches the wrong thing. Node 24 has
`RegExp.escape`:

```js
const term = 'c++ (beta)';
const re = new RegExp(RegExp.escape(term), 'i');
console.log(re.test('Try C++ (Beta) today')); // true
```

**Catastrophic backtracking (ReDoS).** Nested quantifiers such as
`/^(a+)+$/` or `/^(\w+\s?)*$/` can take exponential time on a crafted
near-miss input, freezing Node's single thread for every user. Avoid nested
repetition over overlapping character classes, cap input length before
matching, and treat user-supplied patterns as untrusted. Linters such as
`eslint-plugin-regexp` flag the dangerous shapes.

## When not to use a regex

- **Email addresses:** a loose `^[^\s@]+@[^\s@]+\.[^\s@]+$` shape check, then a
  confirmation email. RFC-complete patterns are unreadable and still cannot
  prove the address exists.
- **URLs:** `new URL(input)` parses and validates, and `URL.canParse` checks
  without throwing.
- **HTML:** use a parser (`DOMParser`, or a sanitiser such as DOMPurify), never
  a regex, for anything security-relevant.
- **Query strings:** `URLSearchParams`.
- **CSV:** quoted fields with commas defeat `split(',')`; see
  [../../34-csv-parser/](../../34-csv-parser/).

If you want to see how regex engines work inside, build one:
[../../72-regex-engine/](../../72-regex-engine/). Modern regex features are
summarised in [modern JavaScript features](modern-js-features.md).

## What you should be able to answer

- Why is `'👍'.length` 2, and how do you count what the user sees as characters?
- Two strings look identical but `===` is false. What is going on, and how do
  you fix it?
- How do you sort names the way a user expects, including accents and
  numbers?
- Why does a shared `/g` regex return `true` then `false` for the same input?
- How do you safely build a regex from a search box value, and what is ReDoS?
- When would you refuse to use a regex, and what would you use instead?
