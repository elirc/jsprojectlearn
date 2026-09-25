# Branching strategies and release flows

"How does your team get code from a branch to production?" is a standard
question, and the weak answer is a diagram of GitFlow from 2010. The strong
answer explains the trade-offs: how long branches live, how releases are
versioned and tagged, how a hotfix reaches production, and how feature flags
let you merge unfinished work safely.

[git-workflow](git-workflow.md) covers the daily commands; this guide is about
the team-level choices.

## Why branch lifetime is the variable that matters

Every strategy is really an answer to one question: how long does code live
away from the main line? Long-lived branches drift. The longer they live, the
larger the merge, the more conflicts, the later integration bugs appear, and
the harder the pull request is to review. Short-lived branches integrate
continuously, which is the literal meaning of continuous integration.

| Branch lifetime | Typical merge | Review | Integration risk |
| --- | --- | --- | --- |
| hours to 2 days | small, clean | quick and thorough | low |
| a week | some conflicts | skimmed | moderate |
| a month or more | painful, "merge day" | rubber-stamped | high |

Keep this table in mind; each strategy below is a different point on it.

## Trunk-based development

Everyone integrates into `main` (the trunk) at least daily, usually through
short-lived feature branches and pull requests. `main` is always releasable,
protected by CI, and deployed often, sometimes on every merge.

```txt
main    ──●──●──●──●──●──●──●──  (deployed continuously)
            \  /  \  /  \  /
feature      ●     ●●    ●       (hours to a couple of days)
```

What makes it work:

- **Small pull requests.** A 200-line PR is reviewed properly; a 2,000-line one
  is not.
- **Feature flags** for anything not ready for users. Code ships dark and is
  switched on later (see [feature-flags](feature-flags.md)).
- **Branch by abstraction** for big refactors: introduce an interface, move
  callers over gradually, then delete the old implementation, all on `main`.
- **Fast, trusted CI**, because a red `main` blocks everyone.

This is what most product teams deploying a web app several times a day use,
and what the DORA research associates with high-performing teams.

## GitHub flow

A lightweight version of trunk-based development: branch from `main`, open a
pull request, get review and green CI, merge, deploy. There are no release or
develop branches. It suits a single deployed web app where "the latest `main`"
is the only version that exists.

Its limit is when you must support several released versions at once, such as
a desktop app, a library or an on-premises product.

## GitFlow and release branches

GitFlow uses a long-lived `develop` branch for integration, `feature/*`
branches off it, `release/*` branches to stabilise a version, `hotfix/*`
branches off `main`, and `main` holding only released code.

```txt
main      ●───────────────●──────●     (tags: v1.0, v1.0.1)
           \             /      /
hotfix      \           /  ●───●
develop      ●──●──●──●●──●──●──●
                  \   /
release/1.0        ●─●  (stabilisation, then merged to main and develop)
```

It fits products with scheduled releases and multiple supported versions. For a
continuously deployed web app it mostly adds ceremony: two long-lived branches
to keep in sync, merges in both directions, and a delay between "merged" and
"in production". Even its author later suggested simpler flows for web apps.

A middle ground many teams use is **trunk plus release branches**: work lands
on `main`, and when you cut a release you create `release/2026.09` from `main`,
fix only critical bugs there, and cherry-pick those fixes back.

## Semantic versioning and tags

Libraries and APIs that others depend on communicate change through version
numbers. Semantic versioning is `MAJOR.MINOR.PATCH`:

| Bump | When | Example |
| --- | --- | --- |
| MAJOR | a breaking change to the public contract | removing an endpoint or field |
| MINOR | new, backward-compatible functionality | adding an optional parameter |
| PATCH | backward-compatible bug fix | fixing a calculation |

Pre-releases add a suffix: `2.0.0-rc.1` sorts before `2.0.0`. In npm, `^1.4.2`
accepts any `1.x.y` at or above 1.4.2, which is why a "minor" release that is
secretly breaking causes chaos downstream.

Mark releases with **annotated tags**, which record who tagged, when, and a
message, and can be signed:

```sh
git tag -a v1.4.0 -m "Release 1.4.0"
git push origin v1.4.0
```

Deployed web apps often skip semver and version by date or commit SHA
(`2026.09.24.3` or `a1b2c3d`), because users never choose a version. Either way,
every running build should report its version, so "which code is live?" has an
instant answer.

## Hotfixes

Production has a serious bug and `main` already contains unreleased work. What
you do depends on the flow:

- **Trunk-based with continuous deploy:** fix on `main` via a normal (fast) PR;
  it deploys like anything else. If `main` contains risky unreleased changes,
  they should already be behind flags.
- **Release branches:** branch from the release tag, fix, tag a patch release,
  deploy, then bring the fix back to `main`:

```sh
git switch -c hotfix/1.4.1 v1.4.0
# ...fix and commit...
git tag -a v1.4.1 -m "Fix VAT rounding"
git switch main
git cherry-pick <fix-sha>
```

The classic mistake is fixing only the release branch, so the bug reappears in
the next release. Fix forward on `main` too, and add a regression test.

To confirm which releases contain a fix, ask Git rather than memory:

```sh
git tag --contains <fix-sha>
```

## Release notes and changelogs

A changelog is for humans: what changed, what might break, what to do. Two
common approaches:

- **Conventional Commits** (`feat:`, `fix:`, `feat!:` for breaking) let tools
  such as semantic-release or release-please generate the version bump and the
  changelog from commit messages.
- A hand-kept `CHANGELOG.md` in the "Keep a Changelog" format, updated in each
  PR under an "Unreleased" heading.

Automation only works if the commit messages are disciplined, which is one more
reason to squash-merge with a well-written PR title.

## Environments and promotion

Branches are not environments. A common mistake is a `staging` branch and a
`production` branch that get merged into each other; they drift, and what you
tested is not what you ship. The better pattern is **build once, promote the
same artefact**:

```txt
merge to main ──> build image myapi:a1b2c3d ──> deploy to staging
                                              └─> approve ──> deploy same image to production
```

Configuration differs per environment (see [env-config-secrets](env-config-secrets.md));
the build does not. [ci-cd-pipelines](ci-cd-pipelines.md) covers the pipeline
mechanics.

## Choosing a strategy

| Situation | Sensible default |
| --- | --- |
| One web app, one production, frequent deploys | trunk-based or GitHub flow, squash merges, flags |
| Mobile app with store review | trunk plus release branches, tagged builds |
| Library consumed by others | trunk plus semver tags, maintenance branches for old majors |
| Regulated, scheduled releases | release branches with sign-off, still short feature branches |

Whatever you choose, keep feature branches short, protect `main`, and make
"what is in production?" answerable from a tag or a SHA.

## What you should be able to answer

- Why do long-lived feature branches cause problems, and what replaces them in
  trunk-based development?
- When does GitFlow make sense, and why is it often overkill for a web app?
- Walk through shipping a hotfix when `main` has unreleased changes.
- What do the three numbers in `2.4.1` promise to someone depending on you?
- Why should staging and production deploy the same built artefact rather than
  different branches?
