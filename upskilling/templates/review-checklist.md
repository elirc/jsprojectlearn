# Review: <PR, branch or file>

<!-- One page maximum. Copy it into the PR, or into your journal for a solo
review. Tick what you checked; write findings underneath. -->

## Before reading the diff

- [ ] What is this for? Can I say it in one sentence?
- [ ] Does the description say how it was tested, with output?
- [ ] Did `npm run content`, `npm run typecheck`, `npm test` and
      `npm run build` pass? I ran them, or saw the output.
- [ ] I ran the branch and used the change.

## Correctness

- [ ] Edge inputs: empty, missing, `NaN`, duplicate, hand-typed URL.
- [ ] Errors: what the user sees when this fails.
- [ ] React: side effects inside render or state updaters (StrictMode runs
      them twice in development).

## Outside the diff

- [ ] Callers of every changed export (`git grep` the symbol).
- [ ] Data already persisted in users' `localStorage`: does old data still
      parse? Is there a migration and a backup?
- [ ] Generated content: does `npm run content` need re-running, and is
      anything generated committed by mistake?
- [ ] Any file shown as binary (`git diff --stat` says `Bin`), or too large
      to review?
- [ ] Docs, comments and `content/roadmap.json` references that now say
      something untrue.

## Tests

- [ ] Does a test fail without the change?
- [ ] Do the tests test behaviour, or restate the implementation?

## Design

- [ ] Is this the smallest change that works?
- [ ] What becomes harder next?
- [ ] One-way door? If so, is there a decision record?

## Comment hygiene

Label every comment `blocking:`, `suggestion:`, `question:` or `nit:`. Say
what it costs a user or a maintainer. Offer an alternative.
