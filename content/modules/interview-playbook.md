# The mid-level interview playbook

Knowing the material and performing it are different skills. This guide is about
the second one. Everything else on this path makes you competent; this makes the
competence visible in 45 minutes.

## What they are actually assessing

Regardless of what the questions look like, interviewers are answering four
questions about you:

1. **Can they do the work?** Technical competence.
2. **Will they need constant supervision?** Judgement and autonomy.
3. **Can they explain their thinking?** Communication.
4. **Do I want to debug something with them at 6pm on a Friday?** Collaboration.

Candidates over-index on the first and lose on the others. The strongest single
change most people can make is **thinking out loud**.

## The stages, and what each is for

| Stage | Length | Testing |
|-------|--------|---------|
| Recruiter screen | 20 min | Do you match the role, salary, availability |
| Technical phone screen | 45 min | Fundamentals — the drill material |
| Take-home or live coding | 1–4 hrs | Can you actually build something |
| System/API design | 45 min | Judgement, trade-offs |
| Behavioural | 45 min | How you work with people |
| Team fit | 30 min | Mutual |

## The phone screen

Rapid-fire fundamentals. This is exactly what the drills prepare you for.

Two rules:

- **Answer, then stop.** Give the direct answer, add one sentence of context or
  a real example, then stop talking. Rambling past a correct answer often
  unwinds it.
- **Say the trade-off.** For anything with two options — sessions vs JWT,
  offset vs cursor, context vs a store — the interviewer wants "it depends, and
  here is what on", not a preference stated as a fact.

**"I don't know"** is a complete and respectable answer when followed by
something. "I haven't used message queues in production. My understanding is
they decouple producers from consumers and give you retries and buffering —
I'd want to read about delivery guarantees before designing with one." That is
a *good* answer. Bluffing is the worst outcome available, because the follow-up
question always comes.

## Live coding

They are watching your process, not your typing speed.

1. **Restate the problem.** "So I need an endpoint that returns a customer's
   orders, filtered by status, paginated. Should it include cancelled orders by
   default?" This catches misunderstandings while they are free.
2. **Ask about edge cases before you code.** Empty results, large results,
   invalid input, unauthorised access. Naming these unprompted is a strong
   signal.
3. **Say what you are about to do.** "I'll write the happy path first, then come
   back to validation."
4. **Write something that works, then improve it.** A working simple version
   beats an unfinished clever one, every time.
5. **Name what you would do with more time.** "In real code I'd extract this
   validation and add a test for the boundary." You get credit for knowing, even
   without doing.

If you get stuck: say so, out loud, with what you have ruled out. "I'm trying to
remember the exact syntax for the window function — the shape is
`ROW_NUMBER() OVER (PARTITION BY ...)`, I'd check the docs." Silence is the only
wrong move.

## The take-home

The most common failure is **doing too much**. A sprawling, half-finished
project reads worse than a small, complete, well-tested one.

- **Respect the stated time.** If it says four hours, spend four and note what
  you would do next. Spending twenty signals poor judgement, and it is unfair to
  candidates who cannot.
- **Write a README.** How to run it, what you chose and why, what you left out
  deliberately, what you would do with more time. This is the highest-value file
  in the submission and most people skip it.
- **Include tests.** Not exhaustive — enough to show you know what is worth
  testing.
- **Handle the boring things.** Validation, error responses, an empty state, a
  loading state. That is the difference between a demo and software.
- **Commit incrementally**, with real messages. They will look at the history.
- **Ask what AI assistance is allowed.** Many take-homes now assume you will use
  a coding assistant; many live rounds forbid it. Ask rather than guess, and
  either way be ready to explain every line you submit. "The assistant wrote
  that part" is not an answer to "why is this here?".

## API and system design

Not distributed systems at this level — usually "design the API for X".

Structure that works:

1. **Clarify.** Who uses it? How much data? Read-heavy or write-heavy? What
   must be transactional?
2. **Sketch the resources and endpoints.** Nouns, methods, status codes.
3. **Model the data.** Tables, keys, relationships, indexes.
4. **Walk one request through.** Validation, authorization, query, response.
5. **Name the failure modes.** What if two users edit the same record? What if
   the payment provider times out? What if the list has 500,000 rows?
6. **Say what you would defer.** "I would not add caching until I had numbers."

The clarifying questions in step 1 matter more than steps 2–4. Someone who
starts drawing tables before asking anything is showing you how they will behave
on the job. For the fuller "design X" round, with rough numbers, scaling moves
and a 45-minute script, see [System design, mid-level
edition](system-design-for-crud.md).

## Behavioural questions

Use **STAR**, kept short: Situation, Task, Action, Result. Two minutes maximum,
then stop.

Prepare four stories, which cover almost everything:

1. **A hard technical problem you solved.** Emphasise the diagnosis, not the
   heroics. Include what you changed so it could not recur.
2. **A time you disagreed with someone.** Show that you can hold a position with
   reasons and then commit to a decision that went the other way.
3. **A time you got something wrong.** Real, with a real consequence, and a real
   change in how you work. "I'm a perfectionist" is a non-answer and everyone
   recognises it.
4. **Something you shipped end to end.** From requirements to production, with
   the boring parts included.

Say "I" for what you did and "we" for what the team did. Interviewers notice
both directions.

## "Walk me through a project you're proud of"

Two minutes, structured:

- **What it does and who for**, in one sentence.
- **The stack, and one reason for a choice.** Not a tool list.
- **The hardest part**, and how you approached it.
- **What you would do differently now.** This is where seniority shows.

Then stop and let them ask. Do not narrate every feature.

Have this rehearsed for both capstone projects. Not scripted — rehearsed.

## Questions to ask them

The ones that make you sound like a colleague:

- "What does the deployment pipeline look like — how long from merge to
  production?"
- "How do you handle database migrations on a live system?"
- "What is the test suite like, and do people trust it?"
- "What is the on-call situation?"
- "What would you want the person in this role to have accomplished in six
  months?"
- "What is the most frustrating part of the codebase right now?"

That last one gets honest answers and tells you a great deal.

Avoid asking things the job description answers. And do not ask "is there
anything that gives you doubts about me?" — it invites them to invent one.

## Compensation

- **Do not give the first number** if you can avoid it. "I'd rather understand
  the role first — what is the range budgeted for this position?"
- Research the market rate for the role, level and location before the first
  call.
- Negotiate on the total package, once, politely, with a reason. Employers
  expect it and the offer does not get withdrawn for asking.

## Rejection

You will be rejected, including for reasons that have nothing to do with you —
an internal candidate, a frozen budget, a re-scoped role.

Ask for feedback once, briefly. Most will not give it; occasionally you get
something genuinely useful.

The first few interviews will be bad no matter how much longer you prepare.
That is an argument for starting sooner, not later: **interviews are the only
practice for interviews.** Apply to a few roles you do not want first.

## The week before

- Re-read your own capstone code. You will be asked about it and forgetting
  your own project is a bad look.
- Run a 40-question mixed mock drill. Anything under 80% points at the topic to
  review.
- Rehearse the four behavioural stories out loud. Out loud, not in your head —
  they are different.
- Prepare your questions.
- Check the technology in the job description and skim anything unfamiliar
  enough to say something honest about it.

## The one-line version

**Be the person who says what they are thinking, names the trade-off, admits
what they do not know, and finishes the simple version before reaching for the
clever one.**
