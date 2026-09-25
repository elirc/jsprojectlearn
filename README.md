# DevPath

**An interactive upskilling app that takes you from your first line of code to a
hireable mid-level CRUD web developer** — on JavaScript, TypeScript, React and
Node, and on C# with ASP.NET Core — with a journal that carries on to senior.

```bash
npm install
npm run dev          # http://localhost:5173
```

That opens the app. Everything below is the content it runs on.

## What it is

A **12-stage roadmap** (63 modules, 435 steps, ~380 hours) that sequences 234
hands-on projects, 189 written guides and **5,215 interview drill questions** into
one ordered path, tracks your progress through it, and tells you what to do today.

| | |
|---|---|
| **Today** | One card: the reviews that are due, a handful of new questions from topics you have reached, and the next step on the path. "Welcome back" after a gap. |
| **The path** | Levels 0–11, in order. Each module says why it exists and what interviewers ask about it. Mark steps done from the page you did them on. |
| **Drills** | Rapid-fire multiple choice with spaced repetition. Modes: today, due, new, missed, saved, and a 40-question timed **mock interview** with no feedback until the end and a readiness verdict. Save a question with `S`. |
| **Projects** | 234 build-it-then-refactor-it exercises, readable in the app with copyable run commands. |
| **Guides** | 189 guides on the material no project covers: HTTP, REST design, SQL, data modelling, EF Core, auth, security, DI, async in C#, testing in both stacks, background jobs, integrations, system design, architecture, Docker, CI/CD, observability, debugging, and the interview playbook. |
| **Progress** | Per-stage completion, per-topic accuracy, a 12-week activity heatmap, streaks. Stored in your browser, versioned, exportable. |
| **[Upskilling journal](upskilling/)** | For after the path: nine case studies drawn from decisions made in this very repo, ten chapters on how seniors work, a competency matrix, a 90-day plan, templates and worked examples. |

**Deliberately not here:** LeetCode and DSA grinding. Nothing asks you to invert
a binary tree. The drills are what teams actually ask about — how HTTP works,
why your effect runs twice, what a scoped DI lifetime is, why the API is doing
400 queries per page load.

## The stages

| Level | Stage | You are done when… |
|-------|-------|--------------------|
| 0 | Programming, actually | You can read a short program and predict what it prints |
| 1 | Code that survives contact with a team | You split pure logic from side effects, and write the test before the fix |
| 2 | The browser, without a framework | You can explain what React actually buys you, because you did it by hand |
| 3 | Async and the network | You can explain the event loop and debug a race condition on purpose |
| 4 | TypeScript | You can type an API boundary and narrow a union exhaustively |
| 5 | React | You can defend every render, with no effect races or leaks |
| 6 | React in a real codebase | You know what TanStack Query, React 19 actions and Testing Library each replace |
| 7 | The backend, in concepts | You can defend an endpoint design, write the JOIN it needs, and explain its login — in either stack |
| 8 | The backend, in Node | You can design the API a frontend team would have to consume |
| 9 | C# and ASP.NET Core | You can discuss DI lifetimes, the pipeline and EF Core without bluffing |
| 10 | Backend systems, either stack | You can design a CRUD system on a whiteboard, including what not to build yet |
| 11 | Shipping and being interviewed | You can take a broken system you didn't write and make progress |

Going .NET-first? Do "The backend, in concepts" (it is stack-neutral), then jump
straight to "C# and ASP.NET Core" — the app's "next step" will keep pointing at the
Node stage; ignore it and pick from the Path page. The how-to guide inside the app
explains the choice.

## Repository layout

```
app/          the Vite + React 19 + TypeScript application
content/
  roadmap.json    the curriculum — stages, modules, steps
  questions/      34 interview drill decks (5,215 questions)
  modules/        189 long-form guides
upskilling/   the junior → senior journal (case studies, chapters, plan, templates)
scripts/
  build-content.mjs    indexes the repo into the app's content, validates it
  check-questions.mjs  the question-bank quality gate
01-86/        the JavaScript track (86 includes a real SQL database via node:sqlite)
react/        the React track (60 projects)
typescript/   the TypeScript track (52 projects)
csharp/       the C# / .NET track (36 projects)
```

The repo is the source of truth. `scripts/build-content.mjs` discovers every
project, bundles the decks and guides, and **fails the build** if the roadmap
points at a project, deck, guide, document anchor or tag pool that does not exist,
if a module id repeats, or if the question bank fails its quality gate.

### The quality gate

The first version of the bank had a tell: in 91% of questions the correct choice
was the longest one, so you could score ~90% by always picking the long option.
`scripts/check-questions.mjs` now fails any deck where that holds for more than
40% of questions, any question whose correct choice is over twice the median wrong
one, decks with under 60% "why interviewers ask this" notes, empty difficulty
levels, and copy-pasted stems across decks. It runs inside `npm run content`.

## Commands

```bash
npm run dev        # the app, with content regenerated first
npm run build      # production build into app/dist
npm run content    # regenerate and validate the content index
npm test           # every project suite + the app's own unit and jsdom smoke tests
npm run lint       # ESLint (typescript-eslint + react-hooks)
npm run typecheck  # the TypeScript track and the app
node scripts/check-questions.mjs [deck-id ...]   # the quality gate, on its own
```

CI runs all of those on every push and pull request (`.github/workflows/ci.yml`).

## Working without the app

Every project folder still stands alone, exactly as before — `LEARN.md` for
beginners, `README.md` for the refactor rationale, `PRACTICE.md` for graded
exercises, plus a per-track `HANDBOOK.md` and `QUIZ.md`. New to all of this?
Read [START-HERE.md](START-HERE.md).

Do the JS track first — the React and TypeScript tracks deliberately build on
its lessons, and literally import some of its code.

| Track | Projects | Focus |
|-------|----------|-------|
| **JavaScript** (this page, below) | 01–86 | Fundamentals, refactoring, state, architecture, async, servers, a real database |
| **[React](react/)** | react/01–60 | Components, hooks, effects, performance, patterns, accessibility |
| **[TypeScript](typescript/)** | typescript/01–52 | Types that make wrong programs fail to compile |
| **[C# / .NET](csharp/)** | csharp/01–36 | The same lessons in C#, then fullstack web dev with ASP.NET Core |

## The JavaScript track (86 projects)

Every folder contains:

- `original.js` (or `original.html`) — a **working** first version, written the way a beginner
  actually writes it. It is not broken; it is just hard to change.
- `refactored/` — the same program, cleaned up, usually with tests.
- `README.md` — a line-by-line explanation of *what* changed and *why it matters*.

**The comparison is the lesson.** Read the original first, form your own opinion of what's
wrong with it, then read the refactor and the README.

## How to run things

- Node projects: `node 01-fizzbuzz/original.js`, `node 01-fizzbuzz/refactored/cli.js`
- Tests (Node 24): `node --test "01-fizzbuzz/**/*.test.js"` or `npm test` for everything
- HTML projects: double-click the `.html` file, or open it in a browser

## The curriculum

### Warm-ups: functions, naming, tests
| # | Project | Lesson |
|---|---------|--------|
| 01 | [FizzBuzz](01-fizzbuzz/) | Separate *computing* from *printing*; set up the test workflow |
| 02 | [Count characters](02-count-characters/) | Pure functions, `Map` vs object, edge cases (unicode, `__proto__`) |
| 03 | [ROT13](03-rot13/) | One clean reusable function; magic numbers |
| 04 | [Caesar cipher solver](04-caesar-solver/) | Generalizing *when you need it* (rule of three) |
| 05 | [Text → hex/binary](05-text-to-hex/) | Input validation, small composable functions |
| 06 | [Rock paper scissors](06-rock-paper-scissors/) | Game rules as data, separate from I/O |

### Core problem solving: data structures & algorithms
| # | Project | Lesson |
|---|---------|--------|
| 07 | [Towers of Hanoi](07-towers-of-hanoi/) | Recursion with clean base cases; return data, don't print |
| 08 | [Largest prime factor](08-largest-prime-factor/) | Early returns, performance awareness |
| 09 | [Best stock trade](09-best-stock-trade/) | Naming intermediate values makes an algorithm readable |
| 10 | [RPN calculator](10-rpn-calculator/) | Data-driven dispatch: adding an operator = one line |
| 11 | [Password generator](11-password-generator/) | Options objects vs boolean-flag soup |
| 12 | [Markov sentence generator](12-markov-chain/) | Separate the *build* phase from the *generate* phase |
| 13 | [Cipher suite](13-cipher-suite/) | Interfaces: every cipher has the same shape, plug-in architecture |

### State, UI, and separation of concerns
| # | Project | Lesson |
|---|---------|--------|
| 14 | [To-do list](14-todo-app/) | State lives in data, not in the DOM; render as a function of state |
| 15 | [Simon](15-simon/) | async/await instead of callback pyramids |
| 16 | [Connect Four](16-connect-four/) | Game state / win logic / rendering as separate modules |
| 17 | [Snake](17-snake/) | Game loop; `nextState = step(state)` instead of mutating globals |
| 18 | [Yahtzee scoring](18-yahtzee/) | Scoring rules as pure functions; test-driven development |

### Visual / canvas: math meets code organization
| # | Project | Lesson |
|---|---------|--------|
| 19 | [HSV color](19-hsv-color/) | Conversion functions with round-trip tests |
| 20 | [Complementary colors](20-complementary-colors/) | Reusing #19 instead of rewriting it |
| 21 | [Sierpinski triangle](21-sierpinski/) | Recursion on canvas; config instead of magic numbers |
| 22 | [Ulam spiral](22-ulam-spiral/) | Generators; separating "where" math from "draw" code |
| 23 | [ASCII digital clock](23-ascii-clock/) | Rendering pipeline: data → string → screen |
| 24 | [Image → ASCII art](24-image-to-ascii/) | Processing pipeline with tunable parameters |

### Functions, closures & data (fundamentals, round two)
| # | Project | Lesson |
|---|---------|--------|
| 25 | [Deep equality](25-deep-equal/) | Value vs reference; why JSON comparison lies both ways |
| 26 | [Array utilities](26-array-utils/) | The `.sort()` traps, no-mutation contracts, `keyOf` functions |
| 27 | [Memoize](27-memoize/) | Closures as private state; higher-order functions |
| 28 | [Debounce & throttle](28-debounce-throttle/) | Closures + timers; testing time with mock timers |
| 29 | [Bank account](29-bank-account/) | Encapsulation (`#private` and closures); the `this` trap |

### Robust code: errors, validation, real-world data
| # | Project | Lesson |
|---|---------|--------|
| 30 | [Custom errors](30-custom-errors/) | Throw, don't return sentinels; catch only at the boundary |
| 31 | [Validator](31-validator/) | Composable rule functions; collect ALL errors |
| 32 | [Money & cart](32-money-cart/) | Floating point vs integer cents; `Intl.NumberFormat` |
| 33 | [Date utilities](33-date-utils/) | Date mutation, DST-safe day math, zero-indexed months |
| 34 | [CSV parser](34-csv-parser/) | Why `split()` can't parse; the one-boolean state machine |
| 35 | [Template engine](35-template-engine/) | Regex replace done right; escape-by-default (XSS) |
| 36 | [Log analyzer](36-log-analyzer/) | Regex named groups; parse then analyze |

### Patterns: structures & state
| # | Project | Lesson |
|---|---------|--------|
| 37 | [Tree utilities](37-tree-utils/) | Recursion on nested data; nested loops hardcode depth |
| 38 | [Event emitter](38-event-emitter/) | Pub/sub; unsubscribe handles; listener isolation |
| 39 | [Undo/redo](39-undo-redo/) | Past/present/future — shapes that enforce their invariant |
| 40 | [State machine](40-state-machine/) | Make impossible states unrepresentable; transition tables |
| 41 | [LRU cache](41-lru-cache/) | Map insertion order; one structure beats two + a sync rule |

### Async mastery
| # | Project | Lesson |
|---|---------|--------|
| 42 | [Promise pool](42-promise-pool/) | Concurrency limits; how single-threaded async interleaves |
| 43 | [Retry & timeout](43-retry-timeout/) | Backoff, error classification, `Promise.race` deadlines |
| 44 | [Paginated API](44-paginated-api/) | Async generators; lazy streams that stop fetching early |

### Meta & capstones
| # | Project | Lesson |
|---|---------|--------|
| 45 | [Mini test framework](45-mini-test-framework/) | How test runners work — built in 60 lines, reusing #25 |
| 46 | [Stopwatch](46-stopwatch/) | Timer drift; derive time from the clock, never count ticks |
| 47 | [Quiz app](47-quiz-app/) | Content as data, flow as state |
| 48 | [Memory match](48-memory-match/) | Async races from user input; phase machines close them |
| 49 | [Expression parser](49-expression-parser/) | Tokenize → parse → evaluate; why never `eval` |

### Async, network & Node fundamentals
| # | Project | Lesson |
|---|---------|--------|
| 50 | [CLI weather app](50-weather-cli/) | Secrets in env vars; `res.ok`; typed failures; injectable fetch |
| 51 | [Web scraper](51-web-scraper/) | Politeness delays; retry via #43; parse pure, fetch thin |
| 52 | [Link checker](52-link-checker/) | Crawl queues that grow; visited sets; allSettled thinking |
| 53 | [Pomodoro timer](53-pomodoro/) | A countdown is a future timestamp; Notifications API done politely |
| 54 | [Search as you type](54-search-as-you-type/) | THE out-of-order response race; debounce (#28) + latest-wins tickets |
| 55 | [File-based JSON database](55-json-db/) | Atomic writes (tmp+rename); serialized read-modify-write; a real API |

### Building reusable things: libraries & patterns
| # | Project | Lesson |
|---|---------|--------|
| 56 | [Async event emitter](56-async-emitter/) | Subscription lifecycles via AbortSignal; `waitFor`; leak smoke-alarms |
| 57 | [Promise from scratch](57-my-promise/) | Settle-once state machine + microtasks; thenable adoption; chaining |
| 58 | [Test runner v2](58-test-runner-v2/) | Nested hooks; awaited tests (the false-green bug); .only/.skip |
| 59 | [Reactive state store](59-state-store/) | Mini Redux: one dispatch door, reducer brain, middleware onion |
| 60 | [Client-side router](60-router/) | URL as state; routes as data; a pure matcher with `:params` |
| 61 | [Virtual DOM renderer](61-virtual-dom/) | h() → diff → patch; why keys exist; the DOM as a plugin |

### Real applications: CRUD, persistence, structure
| # | Project | Lesson |
|---|---------|--------|
| 62 | [Markdown previewer](62-markdown-previewer/) | Write the parser yourself; escape-by-default kills XSS structurally |
| 63 | [Expense tracker + charts](63-expense-tracker/) | Stored data is input; integer cents persisted; hand-drawn canvas charts |
| 64 | [Kanban board](64-kanban/) | Drag & drop without the DOM-as-database trap; pure `moveCard` index math |
| 65 | [REST API from scratch](65-rest-api/) | A micro-Express: route table (via #60!), middleware onion, one error boundary; routes→service→repo |
| 66 | [Auth system](66-auth/) | scrypt + salts; HMAC tokens with expiry; constant-time compares; auth as middleware |
| 67 | [WebSocket chat](67-websocket-chat/) | RFC 6455 by hand: framing fixes "TCP is a byte stream"; reconnect with backoff |
| 68 | [Collaborative todos](68-collab-todo/) | The capstone of 65+67: event logs, optimistic UI, convergence, sync conflicts |

### Parsing, interpreters & "hard fun"
| # | Project | Lesson |
|---|---------|--------|
| 69 | [JSON parser](69-json-parser/) | Tokenizer + recursive descent; input stays data; errors get line/column |
| 70 | [Pratt calculator](70-pratt-calculator/) | Precedence as a table; associativity as a number; fixes 49's ladder |
| 71 | [Tiny language](71-tiny-lang/) | Lexer → parser → interpreter; scoping from an environment chain |
| 72 | [Regex engine](72-regex-engine/) | Backtracking: quantifiers as choice points, the call stack as undo log |

### Capstone: performance & polish
| # | Project | Lesson |
|---|---------|--------|
| 73 | [Infinite-scroll gallery](73-infinite-gallery/) | IntersectionObserver over polling; rAF over throttling; virtualized windows |

### Extended set: algorithms meet engineering (74–85)
| # | Project | Lesson |
|---|---------|--------|
| 74 | [Priority queue](74-priority-queue/) | Re-sorting an array every push vs a binary heap |
| 75 | [Trie autocomplete](75-trie-autocomplete/) | Scanning every word vs a prefix tree |
| 76 | [Rate limiter](76-rate-limiter/) | Boundary-burst counter bug vs sliding window & token bucket (injected clocks) |
| 77 | [Text diff](77-diff-text/) | "Everything changed" vs an LCS-based line diff |
| 78 | [Mini spreadsheet](78-spreadsheet-mini/) | eval-and-pray vs parsed formulas + dependency (topo) order |
| 79 | [Virtual list](79-virtual-list/) | 10,000 DOM nodes vs windowed rendering math |
| 80 | [Drag-drop list](80-drag-drop-list/) | DOM-mutating drag vs state-driven reorder |
| 81 | [Undo tree](81-undo-tree/) | Redo history destroyed vs a branching history tree |
| 82 | [Canvas bar chart](82-canvas-bar-chart/) | Magic-number drawing vs pure layout + thin draw |
| 83 | [Event-sourcing bank](83-event-sourcing-bank/) | Mutable balance vs an append-only event log + projections |
| 84 | [Worker pool](84-worker-pool/) | CPU work freezing the event loop vs worker_threads |
| 85 | [Streaming log parser](85-streaming-log-parser/) | readFileSync memory spikes vs streams + readline |
| 86 | [SQLite orders](86-sqlite-orders/) | Real SQL with `node:sqlite`, zero installs: constraints, transactions, N+1 vs JOIN, keyset pagination, parameterised queries |

## Beyond the project folders

- Every project folder also has **`PRACTICE.md`** — graded exercises with
  worked solutions (try before peeking).
- **[content/modules/](content/modules/)** — 22 written guides on the topics no
  project covers: HTTP, SQL, REST design, auth, EF Core, Docker, CI/CD,
  caching, observability, debugging, and the interview playbook.
- **[content/questions/](content/questions/)** — 450 interview questions in 17
  decks, each with an explanation and a note on why it gets asked.
- **[HANDBOOK.md](HANDBOOK.md)** and **[QUIZ.md](QUIZ.md)** — the offline
  JavaScript reference and a 50-question quiz bank (each track has its own
  pair inside its folder).

## The one big idea

Almost every refactor in this repo is the same move applied in a different costume:

> **Split the part that *decides* from the part that *does*.**

Decisions (game rules, scoring, conversions, parsing) become pure functions — same input,
same output, no side effects. Doing (printing, DOM updates, canvas, timers) becomes a thin
layer around them. Pure functions are trivially testable, and the thin I/O layer is too
simple to hide bugs.
