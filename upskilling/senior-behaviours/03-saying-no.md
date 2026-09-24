# Saying no

**A senior's "no" protects a commitment, comes with a reason and an
alternative, and is written down so it does not have to be said twice. It is
aimed at the request, rarely at the problem behind it.**

Every yes spends time you already promised to something else. A yes you
cannot keep costs more than a no: the requester plans around it, and finds
out late. Saying no well is how you keep the promises you did make.

## No to the request, yes to the problem

Most requests are a solution to a real problem. Separate the two. You can
decline the solution and still own the problem: "I won't add a scroll-resume
feature to guides, but I agree that people lose their place, and here is what
I would do instead."

If you cannot find a problem behind the request, say that too, politely, and
ask for one. "Who is asking for this, and what happens to them without it?"
is a legitimate answer to a feature request.

## Not now, not here, not ever

These are different answers and should sound different.

- **Not now**: right idea, wrong time. Say what would have to be true to do
  it, and when you will look again.
- **Not here**: right idea, wrong place. Name the place (another project,
  another tool, a later stage).
- **Not ever**: conflicts with a stated constraint or with what the product
  is for. Name the constraint.

Mixing them up causes trouble. A "not now" delivered as "not ever" loses a
good idea. A "not ever" delivered as "not now" means the request comes back
every quarter.

## Use shared ground

A no grounded in a constraint everyone already agreed to is not a matter of
your taste. DevPath has two you can point at. The hard constraints the repo
owner set for this work: keep the stack, drills stay multiple-choice, no
LeetCode or DSA content. And the product's own statement of scope,
`notOnThisPath` in [roadmap.json](../../content/roadmap.json) (line 5), which
the app shows on the Path page ([Path.tsx](../../app/src/routes/Path.tsx),
line 81). Pointing at those turns "I don't want to" into "we agreed not to".
Only the second is written in the repo. The first lives in the owner's
instructions and in commit messages, and a constraint you cannot link to is
weaker shared ground than one you can.

When the shared ground doesn't exist yet, writing it is often the most useful
no you can give, because it answers the next ten requests.

## Saying no upward, and the cost of a yes you can't keep

Saying no to your lead or a stakeholder follows the same shape, with one
addition: offer the trade. "I can do this if X moves to next week. Which do
you want?" makes the cost visible and gives the decision to the person who
owns the priority.

## What this looks like in DevPath

Two worked refusals from this iteration.

**The EF Core project: not now, with an alternative.** The roadmap review
recommended adding one EF Core + SQLite project to the .NET track
(`csharp/37-ef-core-orders`), and gave good reasons: EF Core is the most asked
.NET data-access topic, and the `m-dotnet-data` module had a guide and no EF
Core build. It was not built. The machine the work was done on has no .NET
SDK (`which dotnet` finds nothing, checked 2026-09-24), so nobody could have
run the project, its tests or its one NuGet restore before shipping it. A C#
project nobody has compiled is a promise to learners that might be false.

The no came with an alternative that could be verified:
`js/86-sqlite-orders`, which uses Node's built-in `node:sqlite` with zero
installs, placed on the path in
[roadmap.json](../../content/roadmap.json) (line 759) and covering the same
interview topics (parameters, transactions, N+1). Its
[README](../../86-sqlite-orders/README.md) links forward to the
[ORM and EF Core guide](../../content/modules/orm-and-ef-core.md). The
condition for "later" is plain: someone with a .NET SDK who can run it.

**The cut UX features: several kinds of no.** The UX review cut a set of
proposed features, each with a one-line reason:

| Feature | Kind of no | Reason given |
|---|---|---|
| Scroll-resume for guides | Not ever (premise false) | Guides are 4–8 minute reads; the 30–60 minute figures were step estimates |
| Weekly accuracy chart | Not now | Needs two weeks of data; a learner sees an empty state for a month |
| Flag-a-question feedback form | Not here | A feature for content maintainers, not learners |
| Weekly hours budget | Not now | Needs one meaning for "minutes" (see [chapter 02](02-scoping-work.md)) |

Each reason is about the user or the data, never about effort alone. That
makes them hard to argue with and easy to revisit when the reason stops
being true.

## Common failure modes

- You say no to the problem when you meant no to the solution, and the
  requester concludes you don't care.
- "Not now" with no condition for "later". It is a no that pretends to be a
  maybe, and everyone can tell.
- The reason is your preference, not a shared constraint or a user cost.
- You say yes to avoid the conversation, then deliver late or badly. That
  costs more trust than the no would have.
- The no lives in a chat thread. The same request returns in a month, and you
  argue it from scratch.

## Exercise

Write a decline memo for a plausible request that conflicts with DevPath's
constraints. Pick one: "add free-text answers to drills", "move the app to
Next.js", "add Tailwind", or "bring back a LeetCode track".

1. Classify it as not now, not here or not ever, and name the shared ground
   (a hard constraint, `notOnThisPath`, or a user cost with a number).
2. Separate the problem from the request. Offer one alternative that serves
   the problem inside the constraints.
3. Keep it to one page. Save it as `decisions/NNNN-decline-<topic>.md` with
   status Rejected. It goes through a PR like any other decision.
4. Ask a peer to argue you out of it in the PR. Solo: after 48 hours, write
   the best counter-argument you can as a PR comment, then answer it.

Done when the memo is merged (in the sense defined in the
[folder README](../README.md)), classifies the no, names the shared ground,
offers an alternative, and the PR shows at least one counter-argument and
your answer. If the counter-argument won, change the status and say so: that
is a good outcome. If the no touches where the product boundary is written
down, link LT-14 in [loose-threads.md](../loose-threads.md).

Write in your journal: which was hardest to state, the reason or the
alternative, and why?
