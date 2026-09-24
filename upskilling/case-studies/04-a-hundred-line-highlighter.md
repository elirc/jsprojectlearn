# 04. A hundred-line highlighter

Every "we wrote our own" decision has two costs: the one you pay up front, and
the class of bug the library had already fixed. This case is about DevPath's
hand-rolled syntax highlighter, one bug of exactly that class, and a number
nobody has measured yet.

## The decision

In `2220491` (2026-09-09) `app/src/lib/highlight.ts` was 112 lines. Its header
still states the reasoning:

```ts
/**
 * A ~100-line syntax highlighter.
 *
 * Deliberately not highlight.js: the whole app ships four languages, and a
 * single pass over a combined regex is both smaller and easier to read than a
 * general-purpose grammar engine. It is approximate by design — good enough to
 * read code by, and it never crashes on input it doesn't understand.
 */
```

The main path builds one regular expression per language out of named groups
(comment, string, number, keyword, a capitalised word treated as a type, and a
word before `(` treated as a function call), walks the code once with
`matchAll`, and escapes every slice it emits. HTML had its own function,
`highlightMarkup`.

The alternatives were highlight.js core with a few languages registered,
Prism, Shiki at build time (pre-highlighting in `build-content.mjs`), or no
highlighting. The author bought no dependency, a smaller bundle and code a
learner can read in one sitting. The author paid in accuracy (a template
literal's `${}` is not highlighted inside; `Foo` is a "type" because it starts
with a capital) and in maintenance for every new language. This fits the constraint
the repo owner set for the work: "a small, well-justified dependency is
acceptable; prefer none". That rule is not written anywhere in the repo yet,
which is its own small finding. Dan McKinley's "Choose Boring Technology"
argues the other side: spend
your innovation tokens where they matter, and a highlighter is not where
DevPath's value is.

## What it hid

The main path was careful: it matched against the raw code and escaped each
piece as it emitted it. `highlightMarkup` did the opposite. It escaped the
whole input first, then ran three `replace` calls over the escaped text in
sequence: comments, then tag names, then `attr="value"` pairs.

The second pass inserted markup: `<span class="tok-kw">div</span>`. The third
pass's attribute regex accepted a literal `"` as a quote, and the text now
contained `class="tok-kw"`, which the second pass had put there moments earlier. So
it wrapped the highlighter's own attribute in spans. For
`<div class="box" id='x'>hi</div>` the output began:

```text
&lt;<span <span class="tok-fn">class</span>=<span class="tok-str">"tok-kw"</span>>div</span> …
```

A browser does its best with that and renders something wrong. Single-quoted
attribute values were never highlighted at all, because the regex only knew
double quotes.

Two properties made it hard to see. The output was not empty and did not
throw, so the "never throws on odd input" test in `lib.test.ts` passed. And
the number of `<span` and `</span>` tags *balanced*, 8 and 8, so the obvious
invariant ("opens equal closes") passed too. A mature library has usually
met this class of bug already, in someone else's bug tracker. Writing your own
means meeting it yourself.

The same file had a smaller tell: `const flags = lang === 'sql' ? '' : '';`,
a line that computes the empty string either way. Harmless, but it signals a
file nobody had re-read since it was written.

## How it was found

A refactor plan written on 2026-09-23 ran the real `highlight()` over HTML
input in Node and read the output. Its
adversarial review confirmed it with a one-line reproduction and then did the
more useful thing. It pointed out that the plan's proposed test ("count
`<span` equals `</span>`") would have passed on the broken output, and wrote
the invariant that fails: strip every well-formed `<span class="tok-x">` and
`</span>`; what remains must equal the escaped input. A test is only as good
as the property it checks, and the first property anyone thinks of is often
one the bug satisfies.

## What changed

`git diff 2220491 -- app/src/lib/highlight.ts app/vite.config.ts`:

- `highlightMarkup` is now one pass over the raw source (`highlight.ts:100-127`)
  with a single regex, `MARKUP` (`:106`), whose alternation covers comments,
  tag openers, and `attr="…"` or `attr='…'`. Each slice is escaped as it is
  emitted, like the main path. The comment above it names the old failure so
  nobody reintroduces it.
- A `css` branch was added (`highlightCss`, `:129-160`), with its own rules for
  selectors, properties, values and at-rules. The file is 160 lines on
  2026-09-24 (`wc -l app/src/lib/highlight.ts`), so the header's "~100-line"
  is now a description of intent more than of size.
- The dead `flags` line is gone; the keyword rule is pushed without it (`:75-77`).
- `highlight.test.ts` encodes the invariant as `assertWellFormed` (`:18-26`)
  and runs it over the fixture above (`:60-66`), over every ```` ```html ````
  fence and HTML question in the real content (`:68-72`), and over every
  language on the real code in the docs and decks (`:74-80`). The test grows
  with the content: a new guide with an awkward snippet is tested the day it
  lands.
- `vite.config.ts` lost `chunkSizeWarningLimit: 900`. It raised a warning
  threshold the bundle was nowhere near (Vite's default is 500 kB), so it
  silenced nothing and was deleted as dead config.

The decision to hand-roll stands. What changed is that it now has a test that
would catch the class of bug a library would have spared you.

## Exercise

Everything the register holds for this case is fixed
([F-09 and F-13](../loose-threads.md)). What is still missing is the decision
record that should have existed in 2220491, and the number it would have
needed: the size argument in the header has never been measured. "Smaller" is
a claim; nobody has recorded the alternative's cost.

Measure it. On a throwaway branch, add `highlight.js` to `app/`, register only
the core plus `javascript`, `typescript`, `csharp`, `sql`, `xml` and `css`, and
make `highlight()` delegate to it. Run `npm run build` on `main` and on the
branch and record the size of the main JavaScript chunk from
`ls -l app/dist/assets/*.js` for each. For reference, the last build on
2026-09-24 produced a 399,437-byte main chunk without highlight.js, 126,405
bytes through `gzip -c <file> | wc -c` (the 2026-09-09 build was 351,601
bytes). Also record the gzipped size of each, because that is what a learner
downloads. [Chapter 07](../senior-behaviours/07-the-economics-of-tech-debt.md)
reports one measurement of the delta; yours replaces it if they disagree.

Then write the decision record either way, using
[the template](../templates/decision-record.md), with both numbers, the
commands and the date in it. Include one sentence on the maintenance side:
how many lines of `highlight.ts` you would delete, and what the approximations
listed above would stop costing. Delete the branch afterwards.

Done when: `../decisions/` holds a record whose Context section contains the
two raw and two gzipped sizes with the command and date, whose Decision
section says keep or switch, and whose "Revisit when" names a threshold (for
example, a fifth language, or a size delta under N kB). If you chose to
switch, the change is a separate PR that keeps `highlight.test.ts` passing.

Write in your journal: one claim in your own codebase that is stated as a
number ("faster", "smaller", "cheaper") and has never been measured.
