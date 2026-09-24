# Senior behaviours

Ten chapters on what a senior does that a strong mid-level developer does
not. Each one names a behaviour, shows it in this repo, lists the ways it goes
wrong and ends with an exercise whose output lives in the repo. The case
studies own the analysis of individual decisions; these chapters own the
behaviour and link to the case studies for the evidence.

Read one chapter a week alongside the [90-day plan](../90-day-plan.md). The
arc column below is a suggestion; where the plan names a different week, the
plan wins.

| # | Chapter | Arc | Matrix dimensions it serves |
|---|---|---|---|
| 01 | [Landing a decision you cannot make alone](01-landing-a-decision-you-cannot-make-alone.md) | 3 | Communication, Operating in ambiguity |
| 02 | [Scoping work](02-scoping-work.md) | 1 | Operating in ambiguity, Estimation |
| 03 | [Saying no](03-saying-no.md) | 3 | Communication, Ownership |
| 04 | [Writing a design doc](04-writing-a-design-doc.md) | 3 | Design, Communication |
| 05 | [Running a code review](05-running-a-code-review.md) | 2 | Code review, Testing |
| 06 | [Debugging production](06-debugging-production.md) | 2 | Debugging, Ownership |
| 07 | [The economics of tech debt](07-the-economics-of-tech-debt.md) | 1 | Design, Estimation |
| 08 | [Giving feedback](08-giving-feedback.md) | 2 | Mentoring, Code review |
| 09 | [Growing yourself and one other person](09-growing-yourself-and-one-other-person.md) | 3 | Mentoring, all ten for self-assessment |
| 10 | [Designing for operability](10-designing-for-operability.md) | 1 | Design, Debugging, Ownership |

## Reading order

If you follow the plan, read by arc: 02, 07 and 10 while you own a slice of
the code; 05, 06 and 08 while you raise the floor for others; 01, 03, 04 and
09 in Arc 3, when you take on work above your role. Without the plan, read
02 first (everything else assumes you can scope) and 01 last (it assumes you
have written a design doc and given feedback).

## How a chapter is built

- The thesis is the first two sentences, in bold.
- Three to five sections of argument, each tied to a file, a commit or a
  number from this repo.
- **What this looks like in DevPath**: the worked example.
- **Common failure modes**: three to five, each one something you could catch
  yourself doing.
- **Exercise**: done in this repo, with an output location and a "done when".
  Where a row in [loose-threads.md](../loose-threads.md) fits, the exercise
  names it.
- One closing line: `Write in your journal: …`.

Line numbers in the chapters were checked against the working tree on
2026-09-24. They drift; the symbol names are the durable reference. A chapter
is done when its exercise output exists and someone else, or you after 48
hours with [the review checklist](../templates/review-checklist.md), has read
it (see "What done means" in the [folder README](../README.md)).
