# Git internals and rebasing safely

Most Git panic comes from not knowing what a command actually changes. Once
you can picture commits, refs and the reflog, "I rebased and lost my work" or
"I force-pushed over a colleague" become five-minute fixes rather than
disasters. Interviewers test this with recovery scenarios, and the candidate who
reaches for `git reflog` calmly is the one who has done it before.

This guide goes one level below [git-workflow](git-workflow.md). Read that first
for the daily loop; this one is about why the commands behave as they do.

## The object model in four nouns

Git stores four kinds of object, each named by the hash of its contents:

| Object | Holds | Points to |
| --- | --- | --- |
| blob | the bytes of one file | nothing |
| tree | a directory listing: names, modes, hashes | blobs and other trees |
| commit | author, message, timestamp, one tree | its tree and parent commit(s) |
| annotated tag | a message and signature | usually a commit |

Because the name is a hash of the content, objects are **immutable**. You never
edit a commit. "Amending" or "rebasing" creates new commits with new hashes and
moves a label to them; the old commits still exist until garbage collection
removes unreachable ones, weeks later by default.

You can see this for yourself:

```sh
git cat-file -p HEAD          # the commit: tree, parent, author, message
git cat-file -p 'HEAD^{tree}' # the tree: one line per file or folder
git rev-parse HEAD~2          # the hash two commits back
```

A commit's hash covers its parent's hash, so changing anything in history
changes every descendant's hash. That is the whole reason rewriting shared
history hurts: everyone else still holds the old hashes.

## Refs, HEAD and the three trees

A **branch** is a file containing one commit hash. That is all. `main` is a
movable label; committing on `main` writes a new commit and moves the label.
A **tag** is a label that does not move. `HEAD` is a pointer to the current
branch (or, in "detached HEAD", directly to a commit).

When you work, three "trees" are in play:

- **HEAD**: the last commit on your current branch.
- **The index** (staging area): the snapshot your next commit will record.
- **The working tree**: the files on disk.

`git status` compares them: index vs HEAD is "changes to be committed", working
tree vs index is "changes not staged". Every undo command is just a choice of
which of these three to move:

| Command | Moves branch | Resets index | Resets files |
| --- | --- | --- | --- |
| `git reset --soft <c>` | yes | no | no |
| `git reset --mixed <c>` (default) | yes | yes | no |
| `git reset --hard <c>` | yes | yes | yes (uncommitted work is lost) |
| `git restore <file>` | no | no | yes, for that file |
| `git restore --staged <file>` | no | yes, for that file | no |
| `git revert <c>` | adds a new commit | n/a | n/a |

`reset` rewrites where a branch points and so changes history; `revert` adds a
commit that undoes another, so it is the safe choice on shared branches.

## The reflog: your undo history

Every time `HEAD` or a branch moves (commit, checkout, reset, rebase, merge,
pull), Git appends a line to the **reflog**. It is local, it is not pushed, and
it keeps entries for 90 days by default.

```sh
git reflog
# a1b2c3d HEAD@{0}: rebase (finish): returning to refs/heads/feature
# 9f8e7d6 HEAD@{1}: rebase (pick): Add order total
# 4c5d6e7 HEAD@{2}: commit: WIP on totals        <- before the rebase
```

To get back to any earlier state, point a branch at it:

```sh
git branch rescue HEAD@{2}      # safest: a new branch, nothing destroyed
git reset --hard HEAD@{2}       # or move the current branch back
```

This recovers almost everything: a botched rebase, a `reset --hard` to the
wrong commit, a deleted branch (`git reflog` shows the last commit it pointed
to). What it cannot recover is work that was **never committed or staged**.
The practical lesson: commit early, even as "WIP", because committed work is
very hard to lose. Staged-but-uncommitted content survives as dangling blobs
that `git fsck --lost-found` can find, though without file names.

## What rebase actually does

`git rebase main` on a feature branch:

1. finds the commits on your branch that are not on `main`;
2. checks out the tip of `main`;
3. replays each of your commits on top, one at a time, creating **new** commits
   with new hashes;
4. moves your branch label to the last new commit.

Your old commits are untouched and still in the reflog, which is why an
aborted or bad rebase is recoverable. Conflicts appear per replayed commit;
fix, `git add`, `git rebase --continue`, or `git rebase --abort` to go back to
exactly where you started.

`git pull --rebase` is fetch plus this, and avoids the noisy "Merge branch
'main' of ..." commits that plain `git pull` creates when you and the remote
have both moved. Many teams set it as the default:

```sh
git config --global pull.rebase true
```

## The golden rule, and why it exists

**Do not rebase commits that other people have based work on.** If you rebase
a shared branch and force-push, everyone else's copy still contains the old
commits. When they pull, Git sees two divergent histories with duplicate
changes, and people end up merging the old and new versions together.

Rebasing your own unpushed commits, or your own feature branch that nobody
else commits to, is fine and is how you keep history tidy before review.

## Force-pushing without hurting anyone

After rebasing a branch you have already pushed, a normal push is rejected
because the remote tip is not an ancestor of yours. Never use bare `--force`:

```sh
git push --force-with-lease
```

`--force-with-lease` only overwrites the remote branch if it still points where
your last fetch saw it. If a colleague pushed in the meantime, the push fails
instead of silently deleting their commit. Add `--force-if-includes` (Git 2.30+)
to also guard against a background `git fetch` having updated your
remote-tracking ref without you integrating it.

Protect `main` on the server (see [ci-cd-pipelines](ci-cd-pipelines.md)) so
force-pushes there are impossible whatever anyone types.

## Interactive rebase for a reviewable branch

Before opening a pull request, shape your commits so each one makes sense:

```sh
git rebase -i main
```

The editor lists your commits oldest first, with a verb on each line:

```txt
pick   3a1f2c0 Add Order entity and migration
fixup  7b2e9d1 fix typo
pick   c4d5e6f Add POST /orders endpoint
reword 9a8b7c6 tests
```

| Verb | Effect |
| --- | --- |
| `pick` | keep as is |
| `reword` | keep the change, edit the message |
| `edit` | stop here so you can amend or split the commit |
| `squash` | fold into the previous commit, combining messages |
| `fixup` | fold into the previous commit, discarding this message |
| `drop` | remove the commit |

A good workflow for review feedback is `git commit --fixup <sha>` while you
work, then `git rebase -i --autosquash main` at the end: Git pre-arranges each
fixup under its target. Reorder lines to reorder commits.

## Rebase recipes worth knowing

**Move a branch to a different base.** You branched `feature-b` off
`feature-a`, but `feature-a` was abandoned and you want `feature-b` on `main`:

```sh
git rebase --onto main feature-a feature-b
```

This takes the commits after `feature-a` up to `feature-b` and replays them on
`main`.

**Stop resolving the same conflict repeatedly.** Enable `rerere` ("reuse
recorded resolution") and Git remembers how you resolved a conflict and
reapplies it next time:

```sh
git config --global rerere.enabled true
```

**Keep a long-lived branch current.** Rebasing a branch with 40 commits onto a
busy `main` can mean 40 rounds of conflicts. Either rebase little and often, or
merge `main` into it and squash when merging the pull request.

## Merge, squash or rebase when landing a PR

| Strategy | History on `main` | Good for | Cost |
| --- | --- | --- | --- |
| Merge commit | every commit plus a merge commit | preserving exact history | noisy graph |
| Squash and merge | one commit per PR | small PRs, messy branch history | loses intermediate commits |
| Rebase and merge | each PR commit, linear | curated commits | hashes change on landing |

There is no universally right answer; consistency within a team matters more.
Squash is the most common default because it makes `git revert` of a whole
feature a single command.

## What you should be able to answer

- What is a Git commit made of, and why does rebasing change its hash?
- You ran `git reset --hard` to the wrong commit. How do you get your work back,
  and what could you not recover?
- What does `git rebase main` do step by step, and when must you not do it?
- Why use `--force-with-lease` instead of `--force`, and what does it protect?
- How do you turn five messy commits into two clean ones before review?
- When would you choose squash-and-merge over a merge commit?
