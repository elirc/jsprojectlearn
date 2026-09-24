# 07. Deleting the DSA track

Deleting working code is a decision juniors rarely get to make and seniors
make more often than they write new features. This case is about one
deletion in DevPath: 30 algorithm problems, added and removed nine days apart.
The code change was trivial. The decision was about what the product is for,
and the part that did not happen is the part worth practising.

## The decision

`git log --format="%h %ad %s" --date=short` gives the timeline:

- `6b5ff4c`, 2026-08-31, "Expand repo to 263 projects across 5 tracks with
  full learning layers". `git show --stat 6b5ff4c` reports 1,157 files
  changed. Among them was a `dsa/` track: 30 data-structures-and-algorithms
  problems, `dsa/01` to `dsa/30`.
- `2220491`, 2026-09-09, "Turn the repo into DevPath, an interactive upskilling
  app". It changed 292 files, and 211 of them are `dsa/` files being deleted
  (`git show --name-status --format= 2220491 | grep -c "dsa/"` prints 211:
  30 problems of seven files each, plus `dsa/README.md`). Counting the lines
  of `--stat` instead prints 194, because `--stat` shortens long paths and
  drops the `dsa/` prefix from some of them. Count with the command that
  lists every path.

The reason is one line in the commit body: "Removed the 30-problem dsa/ track:
this path targets CRUD interviews, not algorithm puzzles." The same commit
wrote the position down where a user would meet it: the README
("**Deliberately not here:** LeetCode and DSA grinding", `README.md:30` in
today's working tree) and `notOnThisPath` in `content/roadmap.json:5`, which
the app shows on the path page (`Path.tsx:81`). Later work added a third
statement in `content/modules/how-to-use-devpath.md:119` ("Not because
algorithms are worthless, but because they are not what CRUD interviews
test"), and the repo owner made "no LeetCode/DSA content" a hard constraint
for everyone who worked on the repo afterwards.

The alternatives were to keep `dsa/` as an optional track, to keep the files
but leave them off the roadmap, to move them to a separate repo, or to mark
them archived. Each keeps something: the work, the learners who wanted it, the
option to bring it back. Each also costs something that is easy to
underrate: a second product identity. A learner who opens a repo that says
"hireable CRUD developer" and finds 30 LeetCode-style problems has to decide
which one the repo means. Every future contributor has to decide whether a new
question about binary trees belongs.

Two things made the call cheaper than it looks. The work was nine days old,
so the sunk cost was small and the decision was made on the target role, not
on the effort already spent. And deletion in git is reversible:
`git checkout 6b5ff4c -- dsa/` brings all of it back. A reversible decision
deserves less deliberation than an irreversible one, and the author treated
it that way.

## What it hid

The deletion was clean. `git grep -n "dsa/"` over tracked files returns
nothing on 2026-09-24. What the commit did not do is draw the line it relied
on.

"Not algorithm puzzles" is a boundary, and boundaries have edges. Look at
`README.md:150`: a section headed "Core problem solving: data structures &
algorithms", listing Towers of Hanoi, largest prime factor and best stock
trade. Look at `README.md:269`: "Extended set: algorithms meet engineering
(74–85)", starting with a priority queue built as a binary heap and a trie.
Those projects survived the cut, correctly: each is framed as a refactoring
lesson ("Recursion with clean base cases; return data, don't print"), not as
interview grinding. Some are on the roadmap (`js/09-best-stock-trade`,
`js/76-rate-limiter`, `js/84-worker-pool`); others are not
(`07-towers-of-hanoi`, `74-priority-queue`, `75-trie-autocomplete`). Running
`grep -c '"js/74-' content/roadmap.json` prints 0.

So the repo holds three prose statements that say "no DSA", a README section
titled "data structures & algorithms", and a roadmap that includes some of
those projects and not others. Nothing written says what the rule is. The
closest thing to a rule is the author's judgement at the time, and that does
not survive a change of author.

The same README shows the general failure mode. Its introduction was updated
in this iteration and says "37 written guides and 1,043 interview drill
questions" (`README.md:17`). Further down, `README.md:290` still says "22
written guides" and line 293 "450 interview questions in 17" decks.
`ls content/modules | wc -l` printed 37 on 2026-09-24, and
`node scripts/check-questions.mjs` reported 1,043 in 34 decks. Scope changes
leave prose behind them, sometimes in the same file that had been edited.

## How it was found

Not by a test. The plan for this journal (2026-09-23) first proposed a stale
reference in `app/dist/docs/README.md` as the loose thread for this case. Its
review rejected it: `app/dist/` is gitignored build output from before the
removal, it exists on one machine, and `git grep "dsa/"` finds nothing
tracked. The review asked for a tracked trace instead and pointed at the
README's "Deliberately not here" line as the only place a repo reader meets
the position. Reading the rest of that README
with the question "where does this boundary actually sit?" produced the
section headings above. The lesson is the method: a claim about the repo has
to be checked against what git tracks, not what one working copy happens to
contain.

## What changed

For the deletion itself, nothing needed to. `git grep` is clean, the three
positioning statements agree, and `notOnThisPath` is still rendered by the
app. The README was edited in this iteration (`git diff 2220491 --stat --
README.md`), but the stale counts at `README.md:290` and `:293` survived the
edit. No decision record exists for the cut:
`git log --all --format=%B | grep -i dsa` finds two lines, the `6b5ff4c`
bullet that added the track and the one-line reason in `2220491`.

That one line is a good commit message. It is not a decision record. It does
not say what was considered, who lost something, how to reverse it, or where
the line sits for the projects that stayed. For a solo author in week two,
that was a reasonable economy. For the next contributor, whose first pull
request adds a "Dijkstra for route planning" project, it is not enough to
decide whether to merge.

## Exercise

This case owns [LT-14](../loose-threads.md): the product boundary lives in two
places with two wordings, and, as "What it hid" shows, a third place (the
README's own section headings) that sits awkwardly next to both. Nothing states
the rule between "algorithms that teach engineering" and "DSA grinding". Write
the decision record that should have accompanied the deletion, dated as if
written on 2026-09-09, using [the template](../templates/decision-record.md).

It must contain: the context (target role, the two commit hashes and dates,
the 211-file count and the command that produced it); the options above,
including "keep but unlisted"; the decision; the consequences, including who
lost something; how to reverse it (the `git checkout` command); and a
"Revisit when" condition. Most importantly, it must state the rule for the
projects that stayed, precisely enough that someone else could classify
`07-towers-of-hanoi`, `74-priority-queue` and a hypothetical Dijkstra project
without asking you.

Done when: the record is in `../decisions/` with status Accepted; it
classifies every project listed under `README.md:150` and `README.md:269`
against the rule, in a table; and a second person (or you after 48 hours)
has classified the Dijkstra example using only the record and got the answer
you intended. If the classification exposes a README heading that contradicts
the rule, open a separate one-line PR fixing the heading, and fix the stale
counts at `README.md:290` and `:293` in the same PR.

Chapter [02](../senior-behaviours/02-scoping-work.md) covers scoping as
choosing what not to do; chapter [03](../senior-behaviours/03-saying-no.md)
covers writing the "no" down so it does not have to be said twice.

Write in your journal: a feature or piece of work you would cut from a
project you know today, and the one sentence you would put in the commit
message.
