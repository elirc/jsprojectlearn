# A debugging playbook for problems you did not cause

The defining mid-level skill: being handed an unfamiliar broken system and
making progress. Not fixing it instantly — making progress, visibly, with a
method. Interviewers ask scenario questions specifically to see whether you have
one.

## The method

1. **Reproduce it.** If you cannot, your goal changes to *making it
   reproducible* — that is the work, not a prerequisite to it.
2. **Read the actual error.** All of it. The bottom of a stack trace is usually
   the interesting part, and half of all bugs are solved by reading the message
   people skipped past.
3. **Establish what is true.** Not what should be true. Print it, log it,
   inspect it.
4. **Form one falsifiable hypothesis.** "The token is expired by the time it
   reaches the service" — something you can prove wrong.
5. **Test it with the cheapest possible check.**
6. **Halve the search space.** Binary search the code path, the commit history,
   the data, the environment.
7. **Fix the cause, not the symptom.** Then ask what class of bug this was and
   whether it exists elsewhere.

The discipline that matters most: **change one thing at a time.** Changing three
things and seeing it work teaches you nothing and often leaves two of them
wrong.

## Narrowing questions

When something fails for some cases and not others, the answer is in the
difference. Work through:

- **Who?** One user, one tenant, one role, everyone?
- **When?** Since a deploy? A certain time of day? First request after idle?
- **Where?** One environment, one region, one instance, one browser?
- **What data?** Empty values, very large values, unicode, nulls, a specific
  record?
- **How often?** Always, or intermittently — intermittent almost always means
  timing, concurrency, or caching.

"It started at 14:20" plus a deploy at 14:18 is the whole investigation.

## Works locally, breaks in production

The most common shape. The cause is almost always something that *only exists
in that environment*:

| Category | Examples |
|----------|----------|
| **Config** | Missing env var, wrong connection string, wrong feature flag |
| **Data** | 5 million rows instead of 50; real unicode; nulls you never had locally |
| **Concurrency** | Multiple instances, real parallel requests, races |
| **Network** | Firewalls, DNS, TLS, proxy timeouts, CORS on a real origin |
| **Identity** | Different secrets, expired certificate, clock skew |
| **Build** | Minification, tree shaking, `NODE_ENV=production` behaviour |

So the first question is never "what is wrong with the code" — it is **"what is
different about that environment?"**

## Intermittent bugs

"Sometimes my changes don't save." Suspect, in order:

- **A race.** A missing `await`, two concurrent requests, a fetch response
  arriving out of order, a lost update with no version check.
- **Caching.** Stale data at one of five layers.
- **Load-dependent behaviour.** A timeout that only fires under pressure, pool
  exhaustion.
- **Time.** Timezones, daylight saving, month boundaries, token expiry.

Intermittent means timing. Add logging around the suspect path with timestamps
and a correlation id, ship it, and wait — instrumenting is faster than guessing.

## Performance problems

1. **Measure first.** Which endpoint, which page, how slow, at which percentile.
2. **Split client from server.** The network waterfall answers this in ten
   seconds: slow first byte is the server, everything-after-that is the client.
3. **On the server**, the usual suspects in order: a missing index, an N+1, a
   serial chain of calls that could be parallel, an unbounded query.
4. **On the client**: bundle size, long tasks, unnecessary re-renders, images.
5. **Fix the biggest thing, measure again.** Then stop.

Never optimise by guessing. Most guesses are wrong, and every unnecessary
optimisation is complexity you pay for forever.

## Memory growth

Steady growth until the process is killed and restarted:

- An unbounded cache — a memory leak with a friendly name
- Listeners, timers or subscriptions never removed
- Accumulating references on a long-lived object (a growing array on a
  singleton)
- Closures capturing more than you think

Take two heap snapshots under load and compare what grew. In the browser, the
usual answer is detached DOM nodes still referenced by a live listener — which
is exactly what a React effect cleanup prevents.

## The tools, and using them properly

**A debugger beats `console.log`.** Breakpoints, conditional breakpoints ("stop
when `id === 4471`"), stepping through, inspecting the whole scope. Learn to
attach to a running Node process (`node --inspect`) and to use your IDE's
debugger for .NET — it is a genuine multiplier.

That said, logging is better for anything timing-sensitive, since a breakpoint
changes the timing you are investigating.

**`git bisect`** for "this worked last month". Binary search over commits gets
you to the culprit in a handful of steps.

**Devtools Network tab** with "disable cache" for anything involving stale
content.

**Log the SQL your ORM generates.** Most database performance surprises are
visible in one glance at the query log.

## Reading someone else's codebase

You will be doing this in week one of the job:

1. **Follow one request end to end.** Route → controller → service → repository
   → database, and back. That single path teaches you the conventions.
2. **Read the tests.** They are the executable documentation of intent.
3. **Read the config and the deployment files.** They tell you what the system
   actually depends on.
4. **`git log` on the file you are changing.** Recent commit messages explain
   why the code looks strange.
5. **Change something small and watch what breaks.** The blast radius is the
   architecture diagram.

## When you are stuck

- **Explain it out loud**, to a colleague or a rubber duck. Articulating the
  problem finds the false assumption more often than anything else.
- **Question the assumption you have not checked.** Usually "the config is
  right", "the data is what I expect", or "that library does what I think".
- **Go back to the last known-good state** and move forward in small steps.
- **Take a break.** Genuinely effective and consistently under-used.
- **Ask for help with a specific question.** "I expect X, I see Y, I have ruled
  out Z" gets a useful answer. "It's broken" does not.

Asking after 45 minutes of genuine effort is good judgement, not weakness.
Interviewers often probe for this — someone who will burn two days rather than
ask is a risk.

## When it is on fire

**Restore service first, diagnose second.** Roll back to a known-good version.
It stops the damage and buys time to investigate properly.

Fast, safe rollback is worth engineering for precisely because it converts a
crisis into an inconvenience.

Afterwards, write it up: what happened, the timeline, why, and what change
prevents this *class* of problem. Blameless — the useful output is the systemic
fix, not the name of whoever pushed the button.

## The answers to have ready

**"How do you approach a bug you can't reproduce?"**

> Narrow the conditions first — which users, since when, what data. Then add
> instrumentation to the suspect path and ship it, rather than guessing at
> fixes. Making it reproducible is the actual task.

**"Tell me about a difficult bug you fixed."**

Structure it: the symptom, why the obvious explanation was wrong, how you
narrowed it, what it actually was, and what you changed so it could not happen
again. The last part is the one that makes it a good answer.
