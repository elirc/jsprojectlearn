# Code review as author and reviewer

Code review is where most of your working relationships are formed. It is also a common interview topic: "How do you review a pull request?", "What makes a good PR?", "Tell me about a review disagreement." A mid-level developer is expected to do both sides well: open changes that are easy to review, and review others' work in a way that finds real problems without slowing the team down. [Git as it is actually used](git-workflow.md) covers the mechanics of branches and merging; this guide is about the human and technical practice.

## What review is for

Review exists to catch defects a test would not, to spread knowledge of the codebase, and to keep the design coherent. It is not a place to enforce personal taste or formatting. Put everything a machine can check (formatting, lint rules, type errors, tests, coverage of changed lines) in CI, so humans spend their attention on:

- **Correctness:** does it do what the ticket asked, including edge cases (empty lists, nulls, concurrent requests, time zones)?
- **Design:** is it in the right place, at the right level of abstraction, consistent with how the codebase does similar things?
- **Risk:** migrations, security (authorisation checks, injection, secrets), performance (N+1 queries, unbounded lists), backwards compatibility of APIs.
- **Readability:** will the next person understand it in six months?

## As the author: make the change easy to review

The biggest single lever is **size**. Research on review effectiveness and every experienced team agree that defect detection falls sharply past a few hundred changed lines; big PRs get skimmed and approved. Keep PRs to one purpose:

| Instead of | Do |
| --- | --- |
| Refactor and feature in one PR | A pure refactor PR (no behaviour change), then the feature PR |
| A 1,500-line feature | A stack of small PRs, each shippable, or merged behind a feature flag |
| Renaming across the codebase mixed with logic | The rename alone, which reviewers can approve at a glance |

Then give the reviewer context the diff cannot:

```markdown
### Why
Customers on the annual plan were charged monthly after renewal (SUP-412).

### What
- `RenewalService` now reads the billing interval from the subscription, not the plan default.
- Migration backfills `billing_interval` for 312 existing rows.

### How I tested
- New unit tests for monthly/annual renewals; integration test for the backfill.
- Ran the migration against a copy of production: 1.2 s, no locks held over 50 ms.

### Notes for reviewers
The backfill is idempotent; safe to re-run.
```

Before requesting review, **review your own diff in the PR tool**. You will find the leftover `console.log`, the unrelated whitespace change and the confusing name before anyone else does. Leave comments on lines that need explaining, or better, make the code explain itself. Use a **draft PR** when you want feedback on direction before the details.

## As the reviewer: a reading order that works

Reviewing file by file in alphabetical order is how design problems slip through. A better order:

1. **Read the description and the ticket.** Do you understand what problem this solves? If not, ask before reading code.
2. **Look at the shape.** Which files changed? Is the change in the right layer? Is anything surprising included or missing, such as a migration without a rollback plan, or an endpoint without an authorisation check?
3. **Read the tests.** They tell you what the author thinks the behaviour is. Missing cases are often the most valuable comment.
4. **Read the core logic line by line.**
5. **Check the risky edges:** data migrations, public API contracts, anything touching money, auth or personal data.

For anything non-trivial, check it out and run it. Ten minutes clicking through a UI change finds things no diff reading will.

## Writing comments people can act on

Label every comment so the author knows what you expect. Conventional comments are a popular convention:

| Label | Meaning | Blocks merge? |
| --- | --- | --- |
| `issue:` | A defect or risk that must be addressed | Yes |
| `suggestion:` | A better way you recommend | Author's call |
| `question:` | You do not understand; not necessarily a problem | Until answered |
| `nit:` | Trivial; take it or leave it | No |
| `praise:` | Something done well | No |

Then make each comment concrete: what the problem is, why it matters, and a suggested direction.

> **issue:** this runs one query per order line (N+1). With 200-line orders that is 200 round trips. Could we load products with a single `WHERE id IN (...)`, or `Include` them?

compares well with "this is inefficient". Ask questions when you might be missing context ("Is there a reason this is not using the existing `PriceCalculator`?"). Comment on the code, not the person: "this function" not "you". And say what is good; people repeat what gets noticed.

## Turnaround, approval and merging

Slow reviews are the most common process complaint on teams. Waiting a day per round trip turns a two-hour change into a week. Useful norms:

- **First response within a few working hours.** Many teams review at fixed points (start of day, after lunch) so it does not fragment focus.
- **Approve with comments** when the remaining points are non-blocking; trust the author to address them.
- **Timebox back-and-forth.** After two rounds of written disagreement, have a short call. Written threads amplify tone.
- **The author merges** once approved and green, so they own the deploy and can watch it.

Branch protection (required reviews, required checks) and a `CODEOWNERS` file for sensitive paths make the rules automatic rather than social.

## Receiving feedback well

Treat comments as information about how your code reads, not a verdict on you. Reply to every comment: fix it, or explain why not, or move it to a follow-up ticket. Resist the urge to defend in the thread; if a reviewer misunderstood, the code or the description probably needs to be clearer, and that is worth fixing too. When you genuinely disagree, give your reason once, offer a call, and accept that sometimes the team's convention wins over your preference.

## Handling disagreements

Most review disputes are about taste presented as correctness. Ask "is this a defect, a risk, or a preference?" If it is a preference and there is no team convention, the author's choice should usually stand. If it keeps recurring, turn it into a convention (a lint rule, a short entry in the contributing guide or an [architecture decision record](application-architecture.md)) so the argument happens once. If it is a real risk and you cannot agree, bring in a third person, not a longer thread.

## What you should be able to answer

- What should a reviewer focus on, and what should be left to tools?
- What makes a pull request easy to review? What would you put in the description?
- Walk through how you review a medium-sized PR, in order.
- How do you phrase a comment about a performance problem so the author can act on it?
- Your PRs wait two days for review. What would you change, as author and as a team?
- A reviewer insists on a change you think is purely stylistic. What do you do?
