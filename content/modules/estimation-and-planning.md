# Estimation and planning

"How long will it take?" is the question you will be asked most often in your career, and "How do you estimate?" is a staple of interviews for mid-level roles. Nobody expects you to be accurate. They expect you to break work down sensibly, express uncertainty honestly, and warn early when things change. This guide covers the techniques teams actually use and how to talk about them.

## Why estimates are wrong, and why teams still want them

Software estimates are wrong because most of the work is discovering what the work is: unclear requirements, unfamiliar code, integration surprises, review and deployment time. Early in a project, estimates can be off by a factor of two to four either way; the range narrows as the unknowns get resolved. This is the **cone of uncertainty**, and knowing its name helps you explain why an early date must be a range.

Teams still need estimates to make decisions: which of two features to build first, whether a date for a customer is realistic, how many people a project needs. An estimate is a tool for a decision, so the right precision depends on the decision. "Is this days or months?" needs a very different effort from "Can this ship by Friday?"

## Break the work down first

Almost all estimation error comes from work you did not see. Before putting a number on anything, split it into vertical slices a user could see, then list the tasks behind each:

```text
Feature: customers can save delivery addresses
  Slice 1: add an address at checkout (end to end)
    - migration: address table, FK to customer
    - POST /customers/me/addresses + validation + tests
    - form in checkout, error states, accessibility check
  Slice 2: pick a saved address at checkout
  Slice 3: edit and delete, set a default
  Hidden work: postcode lookup API? data retention rules? mobile app too?
```

The "hidden work" line is where estimates are won or lost. Things people forget: tests, code review rounds, migrations on real data volumes, feature flags, analytics events, documentation, deployment, and time to answer questions from QA. If a slice is still more than a few days, split it again.

## Estimation techniques

| Technique | How it works | Good for |
| --- | --- | --- |
| Story points with planning poker | Relative size vs reference stories, revealed simultaneously | Sprint planning in a stable Scrum team |
| T-shirt sizes (S/M/L/XL) | Rough buckets, no arithmetic | Roadmaps and comparing epics |
| Three-point estimate | Optimistic, likely, pessimistic; report a range | A single feature someone needs a date for |
| Throughput forecasting | Count finished items per week; simulate from history | Kanban teams and "when will these 30 items be done?" |
| No estimates | Split everything small and similar; count items | Mature teams with steady flow |

**Story points** measure effort, complexity and uncertainty relative to other stories, not hours. They work because a team compares new work with work it has already done. They break when converted to hours, compared between teams, or used to rate individuals; once people are judged on points, points inflate.

A **three-point estimate** is the most useful single technique for an individual. For each task give the best case, the likely case and the worst realistic case. The spread tells you where the risk is, and a common weighted average is `(best + 4 × likely + worst) / 6`:

```ts
const tasks = [
  { name: 'migration', best: 0.5, likely: 1, worst: 2 },
  { name: 'API + tests', best: 1, likely: 2, worst: 4 },
  { name: 'checkout form', best: 1, likely: 2, worst: 5 },
];
const days = tasks.reduce((sum, t) => sum + (t.best + 4 * t.likely + t.worst) / 6, 0);
console.log(days.toFixed(1)); // 5.6
```

Report it as "about five to seven days, most likely five and a half", not "5.6 days". False precision is its own kind of dishonesty.

**Throughput forecasting** uses history rather than guesses: if the team finished between 4 and 9 items a week for the last ten weeks, a Monte Carlo simulation of those weeks gives "30 items: 50% chance by 14 November, 85% chance by 28 November". It automatically includes meetings, bugs and review time, which is why it tends to beat bottom-up estimates for batches of work.

## Estimates, targets and commitments

Three different things often share one word:

- An **estimate** is a forecast: "probably six days, could be ten".
- A **target** is a business wish: "we want it for the conference on the 12th".
- A **commitment** is a promise: "we will deliver X by the 12th".

Most conflict comes from treating an estimate as a commitment, or a target as an estimate. When someone gives you a date, ask whether it is fixed and why. If the date is fixed, scope is the variable: agree what the smallest valuable version is and what gets cut first.

## Planning a sprint

A good sprint plan starts from a **goal**, one sentence about the outcome ("customers can pay by card"), then chooses stories that serve it. Check capacity first: holidays, on-call, support rotation and meetings take real time, so a team whose average velocity is 30 points plans fewer when two people are out. Leave slack; a plan at 100% capacity cannot absorb the bug that will certainly arrive. At the end of the sprint unfinished work goes back to the backlog rather than counting partially, which keeps velocity honest.

## When the estimate turns out wrong

It will. What matters is how quickly you say so. As soon as you know a task will overrun meaningfully, tell whoever depends on it, with:

1. what you learned ("the payment provider's sandbox does not support refunds"),
2. the new estimate as a range, and
3. options ("ship without refunds and add them next sprint, or move the date by a week").

Bad news with options on day three is a normal part of engineering. The same news on the due date damages trust. Afterwards, compare the estimate with what happened and note what you missed; over time your personal list of forgotten work becomes the most valuable estimating tool you have.

## Talking about estimation in an interview

Interviewers are listening for four things: that you break work down before estimating, that you give ranges and name the uncertainty, that you know points are relative and not a productivity measure, and that you raise risks early. A short real story (the time an integration took twice as long, how you found out, what you told the product owner, and what you now check up front) is worth more than any description of planning poker. [The behavioural interview](behavioural-interview-star.md) shows how to structure it.

## What you should be able to answer

- How do you estimate a feature you have not built before?
- What are story points, and why should they not be converted to hours or compared between teams?
- A stakeholder needs a date for work that has not been broken down. What do you tell them?
- What is the difference between an estimate, a target and a commitment?
- Halfway through, you realise a task will take twice as long. What do you do?
- How does throughput forecasting differ from summing task estimates, and when is it better?
