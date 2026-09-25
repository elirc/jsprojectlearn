# Supply-chain security for npm and NuGet projects

A typical React plus Node app installs well over a thousand packages, and most
of the code you ship was written by strangers. Attackers know it: in September
2025 a phished maintainer account pushed malicious versions of `chalk`, `debug`
and other packages with billions of weekly downloads, and a self-spreading worm
(Shai-Hulud) followed within days. Interviewers now ask "how do you keep your
dependencies safe?", and "we run `npm audit`" is only the first line of a good
answer.

## How the attacks actually work

| Attack | What happens | Main defence |
|---|---|---|
| Compromised maintainer | A real package publishes a malicious version | Lockfiles, delayed adoption, no install scripts |
| Typosquatting | `expresss` or `reqeusts` installs something else | Review new dependencies; copy names from docs |
| Dependency confusion | A public package with your private package's name wins resolution | Scoped packages and registry mapping |
| Malicious install script | `postinstall` runs on every developer machine and CI runner | `--ignore-scripts`, approved build scripts |
| Compromised CI action or build step | A tag you reference is repointed to hostile code | Pin actions to commit SHAs |
| Hijacked third-party browser script | A CDN script you include starts serving malware | Self-host, or Subresource Integrity |
| Known vulnerability | An honest bug with a CVE in a package you use | Audit, patch on a schedule |

Most of these are not about vulnerable code at all. They are about *which code
gets installed and run*, which is why lockfiles and install scripts matter as
much as vulnerability scanning.

## Lockfiles and reproducible installs

`package.json` ranges such as `^4.21.0` allow any compatible newer version. The
lockfile (`package-lock.json`, `pnpm-lock.yaml`) records the exact version and
an integrity hash for every package in the tree. Commit it, and in CI install
from it and nothing else:

```sh
npm ci                     # exact lockfile versions; fails if package.json disagrees
npm audit signatures       # verifies registry signatures and provenance attestations
```

`npm install` in CI can resolve newer versions than anyone reviewed; `npm ci`
cannot. Treat lockfile changes as code in review: a pull request that "only
bumps one package" but rewrites 400 lines of lockfile, or changes a `resolved`
URL to an unfamiliar registry, deserves a closer look. In .NET, enable
`RestorePackagesWithLockFile` to get a `packages.lock.json`, and restore with
`--locked-mode` in CI.

## Install scripts: code that runs before your code

Any package can declare `preinstall`, `install` or `postinstall` scripts, and
npm runs them with your user's permissions, including access to SSH keys, cloud
credentials and `.env` files on a developer laptop. Most packages do not need
them. Options, from most to least disruptive:

```ini
# .npmrc: never run dependency lifecycle scripts
ignore-scripts=true
```

- pnpm 10 no longer runs dependency build scripts by default; you allowlist the
  few that need them (native modules such as `argon2` or `sharp`).
- Recent npm 11 releases warn about install scripts you have not approved.
- At minimum, run `npm ci --ignore-scripts` in CI jobs that do not need native
  builds, and never run installs in a job that holds deployment secrets.

## Don't take a release on day one

Malicious versions are usually spotted and removed within hours or days. A
short delay before adopting new releases avoids most of them at almost no
cost:

- Renovate's `minimumReleaseAge` and Dependabot's `cooldown` setting wait a
  set number of days before proposing an update.
- pnpm's `minimumReleaseAge` setting refuses to resolve versions younger than
  the configured age.

Security fixes are the exception: when an advisory affects you, update
deliberately and quickly, and read the changelog.

## Vulnerability scanning, with judgement

`npm audit`, `dotnet list package --vulnerable` (and NuGet's built-in audit on
restore) and Dependabot alerts compare your dependency tree with advisory
databases. The skill is triage, not zero warnings:

1. **Is it reachable?** A regular-expression denial of service in a build-time
   tool's dependency is not the same as one in your request parser.
2. **Is there a fixed version?** If so, update. If the fix is in a transitive
   dependency, use `overrides` (npm) or a direct reference (NuGet) until the
   parent updates.
3. **If not fixable**, record the decision and the reason, and set a review date.

Run the scan in CI and fail the build on high-severity, reachable issues in
production dependencies (`npm audit --omit=dev --audit-level=high`) rather than
on every advisory, or people learn to ignore it.

## Harden the pipeline itself

Your CI runner holds the keys to production, so it is the most valuable target
in the chain.

```yaml
permissions:
  contents: read            # least privilege for GITHUB_TOKEN by default

steps:
  - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2, pinned by SHA
  - run: npm ci --ignore-scripts
```

- **Pin third-party actions to a full commit SHA.** Tags can be moved; in March
  2025 the tags of a popular action were repointed to code that dumped secrets
  into build logs.
- **Scope secrets** to the jobs and environments that need them, and never
  expose them to workflows triggered by pull requests from forks.
- **Publish with provenance.** npm's trusted publishing lets GitHub Actions
  publish via OIDC with no long-lived npm token, and attaches a signed record of
  which repository and workflow built the package.

The wider pipeline story is in [CI/CD pipelines](ci-cd-pipelines.md), and
secret handling in [Environments, configuration and secrets](env-config-secrets.md).

## Private packages and dependency confusion

If your company publishes internal packages, an attacker can publish a public
package with the same name and a higher version number, and a misconfigured
resolver may prefer it. Use a **scope** you own on the public registry
(`@acme/billing-client`) and map that scope to your private registry in
`.npmrc`. In .NET, **package source mapping** in `nuget.config` pins each
package-name pattern to one feed.

## Scripts in the browser

A `<script src="https://cdn.example.com/widget.js">` runs with full access to
your pages. When a popular polyfill CDN changed hands in 2024 and began serving
malware, every site that included it was affected overnight. Prefer bundling
dependencies yourself. When you must load from a third party, pin the version
and add Subresource Integrity, so the browser refuses a changed file:

```html
<script src="https://cdn.jsdelivr.net/npm/dayjs@1.11.13/dayjs.min.js"
        integrity="sha384-..." crossorigin="anonymous"></script>
```

A Content Security Policy then limits which origins can serve scripts at all;
see [XSS in depth](xss-in-depth.md).

## Choosing a dependency in the first place

Every dependency is a trust decision you make on behalf of your users. Before
adding one, spend two minutes on:

| Check | Why |
|---|---|
| Do you need it? Ten lines of your own code, or the platform (`fetch`, `structuredClone`, `node:test`), may do | Nothing to compromise |
| Maintenance: recent releases, more than one maintainer, issues answered | Abandoned packages do not get security fixes |
| Size of its own dependency tree | You inherit all of them |
| Install scripts | Code that runs on every machine |
| Name and publisher match the official docs | Typosquats look almost right |

An SBOM (software bill of materials, from `npm sbom` or `dotnet CycloneDX`)
lists everything you ship, so the next time a big advisory lands you can answer
"are we affected?" in minutes. The Node side of package management is covered
in [npm, lockfiles, bundlers and the build step](package-managers-and-builds.md).

## What you should be able to answer

- What is the difference between `npm install` and `npm ci`, and why does it
  matter for security?
- Why are install scripts dangerous, and how would you limit them?
- How would you triage twenty `npm audit` findings on a real project?
- What is dependency confusion, and how do scopes or source mapping prevent it?
- Why pin GitHub Actions to a commit SHA rather than a tag?
- What would you check before adding a new npm package?
