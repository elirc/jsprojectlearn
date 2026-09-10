# ✈️ Start Here — Offline Learning Guide

**Most people should start with the app instead:** `npm install && npm run dev`
gives you the ordered roadmap, the drills with spaced repetition, and progress
tracking. See [README.md](README.md).

This page is for using the raw project folders directly — especially offline
(like on a plane with no wifi). Every project folder has a **`LEARN.md`** file
written for a beginner; this explains how to use them.

The app itself works offline too, once `npm install` has run: everything it
serves is generated onto disk and fetched from your own machine.

## What's in each project folder

| File | Who it's for | What it does |
|------|--------------|--------------|
| `LEARN.md` | **Beginners — read this first** | Teaches every concept the project uses from scratch, walks through the code line by line, gives hints so you can try the fix yourself, ends with a glossary and offline experiments |
| `README.md` | After LEARN.md | The expert explanation of *what* changed in the refactor and *why it matters* |
| `original.js` / `original.html` / `original.ts` / `original.cs` | Read second | A **working but flawed** first version — your job is to figure out what's wrong |
| `refactored/` | Read last | The cleaned-up version, usually with tests |
| `PRACTICE.md` | After all of the above | 4–6 graded exercises (⭐ → ⭐⭐⭐) with full worked solutions at the bottom — where the learning actually sticks |

And beyond the project folders:

- **`content/modules/` (22 guides)** — the written material with no project
  attached: HTTP, SQL, REST design, auth, EF Core, Docker, CI/CD, caching,
  observability, debugging, and the interview playbook.
- **`content/questions/` (450 questions)** — the interview drill decks the app
  serves with spaced repetition. Plain JSON, readable offline.
- **`HANDBOOK.md` + `QUIZ.md` in each track** (JS at the root, and in
  `react/`, `typescript/`, `csharp/`) — a cover-to-cover offline reference
  and a 50-question quiz bank with explained answers.

## The learning loop (repeat per project)

1. Read `LEARN.md` sections 1–4 (what it is, the concepts, the code walkthrough, the flaws).
2. Read `original.*` yourself and try to spot the problems.
3. Use the hints in `LEARN.md` section 5 and **try to fix the original yourself**. Copy it to a scratch file first so you keep the original.
4. Compare with `refactored/` using LEARN.md section 6 and the README.
5. Do the experiments in section 8 — actually changing code is where learning sticks.

## What works offline

- **Everything in the JS track (01–85) that runs with `node`** — Node runs
  100% locally. `node 01-fizzbuzz/original.js`, `node --test 01-fizzbuzz/`,
  and `npm test` all work with no internet.
- **Plain HTML projects** (todo app, snake, connect four, sierpinski, etc.) —
  double-click the file; browsers render local files without internet.
- **The TypeScript track** — `npm run typecheck` from `typescript/` works
  offline **if `node_modules` is already installed**. If you haven't run
  `npm install` yet, do it before you board.
- **The entire C# / .NET track (csharp/01–36)** — needs only the .NET SDK
  (already installed). It uses zero NuGet packages, so building, running,
  and testing all work with no internet:
  `dotnet run csharp/01-hello-fizzbuzz/original.cs`,
  `dotnet run --project csharp/01-hello-fizzbuzz/refactored`, and
  `dotnet run --project csharp/01-hello-fizzbuzz/refactored -- test`.
  The web projects (15–28) serve at `http://localhost:50NN` — a server on
  your own machine needs no wifi, and the capstone frontends (25–28) are
  plain local HTML/JS with no CDN, so they run fully offline in the browser.
- ⚠️ **React track pages** load React from a CDN, so *running* them needs
  internet on first load (if you opened one before, your browser may have it
  cached). Reading the code and the LEARN.md files works offline regardless —
  and that's most of the learning.

### Before you board — 2-minute checklist

```
cd JSProjectLearn
npm install        # so tests and typecheck work offline
npm test           # confirm the test runner works
npm run typecheck  # confirm the TS track compiles
dotnet run --project csharp/01-hello-fizzbuzz/refactored -- test   # warm up the C# toolchain
```

Optionally open a few React projects in browser tabs while you still have
wifi so React gets cached.

## Suggested plane itinerary

Pick by energy level, not by order pressure:

- **Fresh and focused:** JS track in order, starting wherever you left off.
  Projects 01–13 are the foundation everything else refers back to.
- **Want variety:** one JS project, then the TypeScript exercise on a similar
  theme (the TS track reuses JS-track ideas — e.g. js#40 state-machine ↔
  ts#33, js#41 lru-cache ↔ ts#41).
- **Tired:** just read LEARN.md files and do the "spot the flaw" step
  mentally. Even without running anything you'll learn a lot.
- **React track:** read-only is fine on the plane (see CDN note above). The
  LEARN.md walkthroughs describe exactly what you'd see on screen.
- **Ready for a new language:** the C# track (`csharp/`) re-teaches the
  repo's lessons in C#, then goes fullstack with ASP.NET Core. Its LEARN.md
  guides assume you know JS but zero C#, with "in JS you wrote X — in C#
  it's Y" comparisons throughout. Start at `csharp/01-hello-fizzbuzz`, and
  do it after JS 01–13 at minimum.

## The one big idea this repo teaches

> **Good code is code that's easy to change.**

Every project is the same lesson in a new costume: the original *works* but
is hard to test and hard to change; the refactor separates **deciding**
(pure functions you can test) from **doing** (printing, DOM, network). When
you can predict what the README will criticize before you read it, you've
got it.
