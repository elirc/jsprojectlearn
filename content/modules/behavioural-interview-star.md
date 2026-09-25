# The behavioural interview with STAR

Behavioural rounds ("Tell me about a time when...") decide more mid-level offers than candidates expect. The logic is simple: how you handled real situations is the best available predictor of how you will handle the next ones. Technically strong candidates fail these rounds by being vague, saying "we" throughout, or picking stories that show nothing. This guide covers what interviewers score, how to structure answers, and how to prepare a small set of stories that covers almost any question. [The interview playbook](interview-playbook.md) places this round among the others.

## What is being scored

Most companies score behavioural answers against a handful of competencies, often written down in a rubric the interviewer fills in afterwards. For a mid-level developer they usually include:

| Competency | What they want to see | Typical question |
| --- | --- | --- |
| Ownership | You finish things, fix what you break, look beyond your ticket | "Tell me about a time you went beyond your role." |
| Collaboration and conflict | You disagree with evidence and keep relationships intact | "Tell me about a disagreement with a colleague." |
| Dealing with ambiguity | You clarify, make reasonable assumptions, and move | "Tell me about a time requirements were unclear." |
| Learning and feedback | You seek feedback and change as a result | "Tell me about feedback that changed how you work." |
| Impact | Your work changed something measurable | "What are you most proud of?" |
| Communication | You adjust to the audience and raise problems early | "Tell me about explaining something technical to a non-technical person." |

Interviewers write down evidence: specific actions you took and results you can point to. Adjectives ("I am a strong communicator") are not evidence. Stories are.

## STAR, with the right proportions

STAR is the standard structure: **Situation, Task, Action, Result**. The common mistake is spending most of the answer on the setting. Aim for roughly:

| Part | Share | Content |
| --- | --- | --- |
| Situation | 10–15% | Where, what was at stake, one or two sentences |
| Task | 10% | What *you* were responsible for |
| Action | 50–60% | What you did, in order, and **why** you chose it |
| Result | 15–20% | What changed, with a number if possible, and what you learned |

Two minutes is a good length for a first answer; the interviewer will ask for more detail where they want it. A worked example:

> **Situation:** At my last job our order export timed out for large customers, about 30 support tickets a month.
> **Task:** I picked up the ticket, and the fix had to ship before a big customer's quarter-end.
> **Action:** I reproduced it with a customer-sized dataset and found the export loaded every order into memory and ran one query per line. I considered a bigger timeout, but that would only move the failure, so I rewrote it to stream rows with a single joined query and moved it to a background job that emails a link. I paired with our support lead on the wording of the email so customers knew what to expect.
> **Result:** Exports of 200,000 rows finished in under a minute, and the tickets stopped. I learned to test with realistic data volumes, and I now ask for them in refinement.

Notice the "why" in the Action (a longer timeout would only move the failure), the number in the Result, and the lesson at the end. Those are what move an answer from average to strong.

## "I", not "we"

The interviewer is hiring you, so they need to know what you did. "We investigated the logs and fixed the bug" leaves them unable to tell whether you led it or watched. Use "I" for your actions and name others' contributions specifically: "I traced it to the parser; Sam wrote the migration." That is both honest and generous. If most of your sentences start with "we", expect the follow-up "What did you personally do?"

## Build a story bank

You do not need a story for every possible question. You need six to eight good stories, each of which can answer several questions. Write them down in note form before any interview:

```text
1. Export timeouts         -> impact, technical challenge, ownership, customer focus
2. Disagreed with lead     -> conflict, influence, changing my mind
   on caching approach
3. Migration locked table  -> failure, ownership, learning
4. Onboarded two juniors   -> mentoring, communication, collaboration
5. Vague "faster dashboard"-> ambiguity, prioritisation, stakeholder management
6. Missed an estimate      -> communication, planning, feedback
```

For each, note the numbers (before and after), your specific actions, what you would do differently, and who else was involved. Choose stories from the last two or three years where possible, of a size that fits the question: a failure story should be a real mistake with a real lesson, not a disaster, and not a disguised boast.

## The stories interviewers probe hardest

**Failure.** Pick something you genuinely caused, explain the impact plainly, then spend most of the time on what you did next and what you changed. Blaming others, or choosing a "failure" that is secretly a strength, both score lower than an honest small mistake.

**Conflict.** Show that you disagreed directly, used evidence, listened, and either persuaded or committed to the other decision. The worst answers are the ones where you "won" by going over someone's head, or where the conflict was never raised at all.

**Ambiguity.** Show the questions you asked, the assumptions you wrote down, and how you checked them early with something small (a prototype, a spike, a draft PR).

**Feedback.** Name the feedback, show that you understood it rather than defended against it, and describe the specific change and its effect.

## Follow-up questions

Interviewers dig into one or two parts of your answer. Common probes:

- "What would you do differently?" Have a real answer for every story.
- "What did your manager or teammate think?" Checks you noticed other people's views.
- "What was the hardest part?" Often reveals whether you really did the work.
- "How did you measure that?" Only claim numbers you can explain.

If you do not remember a detail, say so rather than inventing it; invented details collapse under a second follow-up.

## Hypothetical questions

"What would you do if a teammate kept breaking the build?" can be answered hypothetically, but it is stronger to anchor it in experience: "I would talk to them first. Something similar happened last year, and what worked was..." A real example is evidence; a hypothetical is only an intention.

## Preparing for a specific company

Read the company's published values or engineering principles, and the job description's list of responsibilities. Map your story bank to them: if the company emphasises "customer obsession", prepare to tell the export story with the customer impact first. Prepare two or three thoughtful questions to ask at the end about how the team works: how reviews happen, what on-call looks like, what the last incident taught them.

## Delivery

Answer the question that was asked, headline first: "The best example is when I cut our export time from timeouts to under a minute." Then tell the story. Pause and check ("Would you like more detail on the technical side?") rather than talking for five minutes. Practise out loud, ideally recorded or with a friend, until your stories are fluent but not memorised word for word. Nervousness is normal and interviewers allow for it; vagueness is what costs offers.

## What you should be able to answer

- What does each letter in STAR stand for, and roughly how should the time be split?
- Why do interviewers push back on answers that use "we" throughout?
- How would you choose a failure story, and what should most of the answer be about?
- Tell a conflict story in which you did not get your way. What makes it a good answer?
- How do you answer a hypothetical behavioural question more convincingly?
- What would you put in a story bank, and how many stories do you need?
