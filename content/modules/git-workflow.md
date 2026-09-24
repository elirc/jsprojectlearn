# Git as it is actually used on a team

Everyone claims to know Git. Interviewers test it with two questions: "what does
rebase do that merge doesn't?" and "you committed to the wrong branch — now
what?" This guide covers both, plus the daily workflow.

## The model, in one paragraph

A commit is a snapshot of the whole tree plus a pointer to its parent(s). A
**branch is just a movable pointer to a commit**. `HEAD` is a pointer to the
branch you are on. Almost every confusing Git situation becomes obvious once you
believe that — creating a branch is free because it writes 41 bytes, and
"losing" commits usually means a pointer moved, not that data was deleted.

## The daily loop

```bash
git switch main && git pull
git switch -c feat/order-filters

# work, commit in small pieces
git add -p                       # stage selectively — review as you go
git commit -m "Add status filter to orders query"

git push -u origin feat/order-filters
# open a pull request
```

`git switch` and `git restore` are the modern split of what `git checkout` used
to do. `checkout` still works; the newer commands are clearer about intent.

## Merge vs rebase

**Merge** creates a commit with two parents, preserving exactly what happened:

```
main     A---B---C-------M
                  \     /
feature            D---E
```

**Rebase** replays your commits on top of the target, creating new commits with
new hashes:

```
main     A---B---C---D'---E'
```

Rebase gives linear, readable history and a clean bisect. It rewrites commits,
which leads to the one rule:

> **Never rebase a branch other people have pulled.** Their history and yours
> diverge, and resolving it means someone force-pushes over someone's work.

A workflow that works well: rebase your *own* feature branch onto main to stay
current, then merge the branch into main (or squash-merge). You get a linear
feature history and a clear merge point.

After rebasing a branch you have already pushed, use `git push
--force-with-lease`, never plain `--force`: it refuses to overwrite the remote
if someone else has pushed to it since you last fetched.

**Squash-merge** turns the whole branch into one commit on main. History is
tidy and every commit on main is a reviewed unit, but the branch's individual
commits are gone from main, so `git bisect` can only narrow a bug down to "this
PR", not to the commit inside it. Small PRs make that a fair trade.

## Undoing things

| Situation | Command |
|-----------|---------|
| Wrong message, not pushed | `git commit --amend` |
| Staged something by mistake | `git restore --staged <file>` |
| Discard local changes to a file | `git restore <file>` |
| Undo last commit, keep changes staged | `git reset --soft HEAD~1` |
| Undo last commit, keep changes unstaged | `git reset HEAD~1` |
| Undo last commit, **destroy** changes | `git reset --hard HEAD~1` |
| Undo a **pushed** commit | `git revert <sha>` |
| Recover something you think you lost | `git reflog` |

`--hard` is the only Git command that routinely destroys uncommitted work, and
it is the one people reach for while panicking. Commit or stash first.

`revert` creates a *new* commit that undoes an old one. It is the only safe way
to undo something already on a shared branch, because it adds history rather
than rewriting it.

### "I committed to main by accident"

Not pushed:

```bash
git branch feat/my-work      # bookmark the commit
git reset --hard origin/main # move main back
git switch feat/my-work      # your commit is safe here
```

The commit never moved — you just pointed a new branch at it and moved `main`
back. This is the question that reveals whether someone understands branches as
pointers.

Already pushed to main: `git revert` it, then cherry-pick onto a proper branch.

### "Someone force-pushed over my commits"

Usually recoverable. `git reflog` records everywhere HEAD has been locally; if
you have the old SHA you can `git branch rescue <sha>`. Git does not delete
objects immediately.

The real fix is preventative: protect `main`, require pull requests, disallow
force-push.

## Commit messages

```
Add status filter to orders endpoint

The orders list was returning every order regardless of status, so the
admin UI filtered client-side and paginated wrongly. Filtering in the
query also lets the (customer_id, status) index do the work.

Closes #482
```

- **Imperative summary under ~72 characters.** "Add", not "Added" or "Adding" —
  it completes the sentence "this commit will…".
- **The body explains why**, not how. The diff already shows how. Six months
  later `git log` is the only record of the reasoning.
- Small, atomic commits make `git bisect` useful. A bisect that lands on a
  2,000-line commit tells you almost nothing.

## Pull requests

What makes one easy to review:

- **Small and about one thing.** Review quality falls off a cliff with size — a
  1,000-line PR gets "LGTM".
- **A description that says what and why**, with anything the reviewer needs to
  know to evaluate it.
- **No unrelated formatting churn.** If you reformat a file, do it in its own
  commit so the real change is visible.
- **Refactor and behaviour change separated.** Ideally different commits, often
  different PRs.
- **Green CI before you ask for review.** Do not spend someone else's attention
  on a build failure.

Reviewing well matters too: distinguish "this is wrong" from "I would have done
it differently", and say which you mean.

## Merge conflicts

A conflict is Git saying "you both changed the same lines; you decide". It is
not an error.

```
<<<<<<< HEAD
const limit = 20;
=======
const limit = Number(query.limit) || 50;
>>>>>>> feat/pagination
```

Resolve by producing the code you actually want — often neither side verbatim.
Then `git add` and continue. `git merge --abort` or `git rebase --abort` backs
out entirely if you have made a mess.

The best conflict strategy is prevention: short-lived branches, merged often.

## Branching strategies

**Trunk-based** — short-lived branches, merged to main within a day or two,
main always releasable, incomplete work behind feature flags. This is what most
modern teams do and what continuous delivery requires.

**Git Flow** — long-lived develop/release/hotfix branches. Designed for
versioned software with scheduled releases. For a continuously deployed web app
it is usually more ceremony than it is worth.

Whichever: **protect main**, require review, run CI on every PR.

## .gitignore, and the thing it does not do

Ignore build output, `node_modules`, `bin`, `obj`, `.env`, editor directories.

It does **not** untrack something already committed — you need
`git rm --cached <file>`. And if a secret was committed, ignoring it now changes
nothing: it is still in history on every clone. **Rotate the credential.** That
is the only real remediation.

## Commands worth knowing exist

```bash
git log --oneline --graph --all      # see the actual shape of history
git add -p                           # stage hunks, review your own diff
git stash / git stash pop            # shelve work to switch context
git cherry-pick <sha>                # take one commit somewhere else
git bisect start / good / bad        # binary search for the breaking commit
git blame -L 40,60 <file>            # who changed these lines, and in which commit
git worktree add ../hotfix main      # a second checkout, no stashing needed
```

`git blame` is for finding the commit and its message — the *why*. Used as an
actual accusation it is a culture problem, not a Git one.
