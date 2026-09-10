# How this path works

You are aiming at one specific job: **mid-level developer building CRUD web
applications** — the kind of role where you are handed a ticket like "add a
filter to the orders table and make it stick when the user reloads" and you
ship it without supervision. On JavaScript/TypeScript with React and Node, or
on C# with ASP.NET Core. Often both.

This page explains how to actually use the app so the next 300 hours aren't
wasted.

## The three kinds of work

Every module mixes them deliberately.

| Type | What it is | Why it's here |
|------|-----------|---------------|
| **Build** | A project folder with a working-but-flawed `original`, a `refactored/` version, and a README explaining the gap | Reading good code teaches taste. Writing it teaches everything else. |
| **Guide** | Long-form writing like this page | Some topics — HTTP, SQL, auth, Docker — cannot be learned by refactoring a JavaScript file |
| **Drill** | Rapid-fire multiple choice | Recall under time pressure is a separate skill from understanding, and interviews test the first one |

You need all three. Builds without drills means you know things you cannot say
out loud. Drills without builds means you can pass a phone screen and fail the
take-home.

## The loop for a build step

This is the part people get wrong. The project folders are not tutorials to
read — they are a specific exercise:

1. **Read `LEARN.md` sections 1–4.** It teaches the concepts the README assumes.
2. **Read `original.js` and form an opinion before reading anything else.**
   Write down what you think is wrong with it. Actually write it down.
3. **Try to fix it yourself.** Copy it to a scratch file first. This step is
   where the learning happens and it is the step everyone skips.
4. **Read `refactored/` and the README.** Compare against your list. The gap
   between your list and theirs is your actual curriculum.
5. **Do 2–3 exercises from `PRACTICE.md`.** Not all of them. The ⭐⭐ ones.

If you can predict what the README will criticise before you read it, you have
got that lesson and can move faster.

## The loop for a drill

Answer fast. The timer defaults to 45 seconds because that is roughly how long
you get in a real conversation before hesitation becomes visible.

When you get one wrong, **read the explanation properly** — do not click
through. The question comes back in a day or two either way, but understanding
it now means it comes back once instead of five times.

The scheduling is a simplified SM-2: wrong answers reset the interval, right
answers roughly double it, and answering quickly counts for more than answering
slowly. You do not have to manage any of this. Just do the "due" drills.

## How much, how often

The whole path is roughly **250–300 hours** of focused work. That is:

- 3 months at 20 hours a week
- 6 months at 10 hours a week
- Longer than any bootcamp promises and shorter than most people take

**Daily minimum that actually works:** one drill session (5 minutes) plus one
build step (45–90 minutes). The drill is non-negotiable and the streak counter
exists to make that annoying to break. The build step is where the hours go.

Do not batch. Four hours on Sunday is worth less than 40 minutes six days a
week, because spaced repetition is doing half the work and it needs the spacing.

## The order

Stages 0–3 are strictly sequential. The React track assumes stage 2 (the DOM
without a framework), and the TypeScript track assumes stage 1 (functions and
data modelling). Skipping ahead to React because it is the fun part is the most
common way people stall six weeks later.

After stage 5 you have a choice:

- **Going for a JS/TS job:** stages 6 and 8, then stage 7 if you have time.
  Node backends and deployment are what you will be asked about.
- **Going for a .NET job:** stage 7 immediately after stage 5, then 6 and 8.
  About half the CRUD jobs on the market are .NET jobs and the field is less
  crowded.
- **Not sure:** do stage 6 then 7. Being credible in both is a genuinely strong
  position and the concepts transfer almost completely.

## What "mid-level" actually means

It is not years. It is these four things, and interviewers are checking all of
them:

1. **You can be handed an unfamiliar broken system and make progress.** Not fix
   it immediately — make progress. Read the logs, form a hypothesis, narrow it
   down.
2. **You design before you type.** You ask what happens when the request fails,
   when two users edit the same row, when the list has 50,000 items.
3. **Your code survives other people.** Tested, named clearly, with the failure
   modes handled rather than ignored.
4. **You know the boundaries of what you know.** "I haven't used that, here's
   how I'd approach it" beats a confident wrong answer every single time.

Stage 8 exists because the fourth one is a skill you can practise.

## What this path deliberately skips

No LeetCode. No dynamic programming. No "invert a binary tree."

Not because algorithms are worthless, but because they are not what CRUD
interviews test, and time spent on them is time not spent on SQL joins, HTTP
semantics, and why your effect fires twice. If you later target a company that
does grind algorithm puzzles, that is a separate, well-covered body of prep —
do it after this, not instead of it.

## When you are ready to apply

You are ready earlier than you think. Concretely: **after stage 6** (or stage 7)
you can do the job. Stage 8 makes you better at proving it.

A reasonable signal: you can hold 80%+ accuracy on a 40-question mixed mock
drill, and you have two capstone projects you can talk about for ten minutes
each without notes.

Start applying then. The interviews themselves are the best remaining practice,
and the first few will be bad regardless of how much longer you prepare.
