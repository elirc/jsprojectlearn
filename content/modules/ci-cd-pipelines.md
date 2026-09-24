# CI/CD pipelines

A pipeline is a program that runs on every push and decides whether your change
is allowed to become real. Understanding it is the difference between "the build
is red and I don't know why" and being able to fix it.

## The terms, kept straight

- **Continuous Integration** — everyone merges small changes to main frequently,
  and every change is automatically built and tested. The goal is that main is
  always in a working state.
- **Continuous Delivery** — every passing build is *releasable*. Shipping is a
  button press.
- **Continuous Deployment** — every passing build *is* released, automatically,
  with no human step.

Plenty of good teams do delivery and gate deployment. Nobody serious skips
integration.

## What belongs in the pipeline

Everything that must be true before a merge:

```
1. Restore dependencies    (npm ci / dotnet restore)
2. Lint                    (eslint / dotnet format --verify-no-changes)
3. Type check              (tsc --noEmit)
4. Build
5. Unit tests
6. Integration tests       (against a containerised database)
7. Security audit          (npm audit / dotnet list package --vulnerable)
8. Secret scan
9. Build the container image
```

Two principles:

- **Anything not in the pipeline will eventually be skipped.** A check that
  relies on people remembering is not a check.
- **Fail fast.** Order steps cheapest-first so a formatting error does not wait
  eight minutes behind an integration suite.

## A pipeline you can read

```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request:

# Least privilege: the GITHUB_TOKEN can read the repo and nothing else
permissions:
  contents: read

# A new push to the same branch or PR cancels the run it supersedes
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:18
        env: { POSTGRES_PASSWORD: test }
        options: >-
          --health-cmd pg_isready --health-interval 5s --health-retries 5
        ports: ['5432:5432']

    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: npm

      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
        env:
          DATABASE_URL: postgres://postgres:test@localhost:5432/postgres
```

Three things to notice:

**`npm ci`, not `npm install`.** It installs strictly from the lockfile and
fails if `package.json` disagrees, so a surprise dependency upgrade becomes a
build failure rather than a silent event. This is the main defence against "I
changed nothing and the build broke."

**A real database as a service container.** Integration tests against the actual
engine catch what an in-memory fake hides.

**Caching.** Dependency caching turns a three-minute install into fifteen
seconds. A slow pipeline is one people learn to bypass.

## Pinning

Pin your actions and base images to a version, not to a floating tag:

```yaml
- uses: actions/checkout@v5        # a tag that moves within v5
- uses: actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8  # v5.0.0
```

The SHA must be the **full 40 characters**; GitHub rejects an abbreviated one.
The trailing `# v5.0.0` comment is not decoration: Dependabot reads it to know
which release the SHA is, and bumps both together when a new one ships.

A floating tag means a third party can change what runs in your pipeline —
which has been used as a real supply-chain attack vector.

## The deploy half

```
build image -> push to registry -> deploy to staging -> smoke test
            -> (approval?) -> deploy to production -> smoke test -> monitor
```

**Build once, promote the same artefact.** Tag the image with the commit SHA and
deploy *that exact image* to staging, then to production. Rebuilding per
environment means the thing you tested is not the thing you shipped.

**Smoke test after every deploy.** Hit the health endpoint and one real user
journey. This catches the configuration and connectivity failures that no
pre-deploy test can find, because they only exist in the target environment.

## Deployment strategies

**Rolling** — replace instances a few at a time. Default in most orchestrators.
Old and new run simultaneously, so both must work against the same database
schema and API contracts. This is why you never rename a column and deploy the
code in one release.

**Blue/green** — run the new version alongside the old, switch traffic, switch
back instantly if it fails. Rollback is a traffic change, not a redeploy. Costs
double capacity during the switch.

**Canary** — send 5% of traffic to the new version, watch the error rate, ramp
up. The best risk/cost ratio, and it needs good metrics to be meaningful.

All three require **backwards-compatible database changes**, which is the
constraint people forget.

## Migrations in the pipeline

Schema changes are deployments. Options:

- **A dedicated pipeline step** before the app rollout. Clearest, and a failure
  stops the deploy before any new code runs.
- **An init container / job** that runs once. Same idea, orchestrator-native.
- **At application startup.** Convenient, and it races: three replicas starting
  together all try to migrate. If you do this, use the framework's locking.

Whichever you choose, migrations must be **backwards compatible** with the code
currently running, because during a rolling deploy both versions are live. The
expand/contract pattern (add nullable, backfill, dual-write, migrate reads,
tighten) is how you achieve that across several releases.

## Branch protection

Make the pipeline mean something:

- Require pull requests to main
- Require status checks to pass
- Require at least one approval
- Disallow force-push to main

Without these, CI is advisory.

## Diagnosing a red pipeline

1. **Read the failing step's log from the top.** The first error is the real
   one; everything after is fallout.
2. **Did it fail on main too, or only on your branch?** That splits "my change"
   from "the environment".
3. **Reproduce locally with the same commands.** If `npm ci && npm test` passes
   locally and fails in CI, the difference is environmental — node version,
   timezone, locale, missing env var, or a test depending on order.
4. **"Nothing changed"** — check for a floating dependency version, a moved
   action tag, or a base image that updated.

## Flaky tests

A test that fails randomly is worse than no test: people re-run until green,
then stop trusting the suite entirely.

Usual causes: shared state between tests, order dependence, real timing, real
network, timezone assumptions.

Treat a flake as a bug with a ticket. Quarantine it if you must, but quarantine
with an owner and a date, not indefinitely.

## Keeping it fast

Target under ten minutes for the pull-request pipeline. Beyond that people
context-switch and stop paying attention.

- Cache dependencies
- Run independent jobs in parallel
- Only run the expensive suite on merge, not on every push
- In a monorepo, only build what changed

## What you should be able to say

- What runs in your pipeline, and why each step is there
- The difference between delivery and deployment
- Why `npm ci` rather than `npm install`
- How a rolling deploy constrains database changes
- What happens when a deploy goes wrong (roll back first, diagnose second)
