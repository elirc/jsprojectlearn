# npm, lockfiles, bundlers and the build step

Every frontend job assumes you know why there is a build step. "What does a
bundler do?" is a standard warm-up question and a surprising number of
candidates cannot answer it.

## Why a build step exists at all

Browsers run HTML, CSS and JavaScript. They do not run TypeScript, JSX, Sass, or
a bare `import lodash from 'lodash'` that needs resolving inside
`node_modules`. Something has to turn what you write into what a browser can
load — efficiently.

The build does four separate jobs, and it helps to keep them separate in your
head:

| Job | Tool | What it does |
|-----|------|--------------|
| **Transpile** | esbuild, SWC, Babel, tsc | New/other syntax → JavaScript a browser understands |
| **Bundle** | Vite (Rollup), webpack, esbuild | Follow the import graph, produce a few files instead of hundreds |
| **Minify** | esbuild, terser | Shorter names, no whitespace, dead code removed |
| **Optimise assets** | The bundler | Hash filenames, inline small images, extract CSS |

## Module resolution

`import { z } from 'zod'` is not a URL. The bundler resolves it by walking up
looking in `node_modules`, then reading that package's `package.json` to find
which file to use (`exports`, `module`, `main`).

Browsers cannot do this — which, historically, is the whole reason bundlers
exist. Native ES modules and import maps have narrowed the gap, but resolution,
transpilation and optimisation still need a build for anything non-trivial.

## Tree shaking

Removing exports nobody imports.

It requires **static** ESM imports — the bundler must be able to see the graph
without running the code. `require()` is dynamic, so it cannot be shaken.
Side-effectful modules also block it, which is what `"sideEffects": false` in
package.json declares.

Practical consequence: `import { debounce } from 'lodash-es'` shakes;
`import _ from 'lodash'` pulls the whole library.

## Code splitting

One giant bundle means the user downloads the admin panel to see the login page.

```js
const Settings = lazy(() => import('./routes/Settings'));
```

A dynamic `import()` becomes a split point: the bundler emits a separate chunk
fetched on demand. Route-level splitting is the usual first cut.

Watch for a **waterfall** — lazy-loading a component that then fetches its own
data serialises two round trips. Prefetch the chunk on hover, or start the data
request in parallel.

## Content hashing and caching

```
dist/assets/index-a3f9c2b1.js
dist/assets/index-7d4e8f11.css
```

The hash is derived from the contents. Change the file, change the name. That
lets you serve assets with `Cache-Control: max-age=31536000, immutable` while
the HTML that references them stays short-cached.

This is also the cause of a specific deploy bug: a user's browser holds old HTML
referencing chunks the new deploy deleted, and they get a blank page with a
"failed to load chunk" error. Keep old assets around for a grace period, and
handle a chunk load failure by reloading.

## Source maps

A map from the minified bundle back to your original source, so devtools shows
you real filenames and line numbers.

Ship them for development. For production, the common compromise is to generate
them and upload to your error tracker but not serve them publicly — you get
readable stack traces without publishing your source.

## Dev server and HMR

`npm run dev` does not bundle the same way as `npm run build`. Vite serves your
source as native ES modules and transforms files on demand, which is why startup
is instant regardless of project size.

**Hot Module Replacement** swaps a changed module in place without a full
reload, preserving component state. Very occasionally HMR state gets stale and
weird — a hard refresh is the fix, and knowing that saves an hour of debugging a
bug that does not exist.

## Environment variables in a frontend build

They are **inlined at build time**, not read at runtime:

```js
const url = import.meta.env.VITE_API_URL;   // becomes a string literal in the output
```

Two consequences:

1. Changing the value requires a rebuild. You cannot configure a built SPA with
   an environment variable at deploy time without extra machinery (a runtime
   config file the app fetches, or placeholder substitution at container start).
2. **Anything you inline is public.** It ships in the bundle. A secret in
   `VITE_STRIPE_SECRET_KEY` is a published secret. Vite requires the `VITE_`
   prefix specifically to make that opt-in explicit.

## package.json, the parts that matter

```json
{
  "type": "module",
  "scripts": { "dev": "vite", "build": "tsc -b && vite build" },
  "dependencies": { "react": "^19.1.1" },
  "devDependencies": { "vite": "^7.1.5" }
}
```

- `"type": "module"` — `.js` files are ESM
- `dependencies` ship; `devDependencies` do not
- `peerDependencies` — "I need this, but the host app should provide it", so
  there is only one copy of React

## Lockfiles

`package.json` declares ranges; the lockfile records the exact resolved version
of every package in the tree, including transitive ones.

**Commit it.** Use `npm ci` in CI — it installs strictly from the lockfile and
errors if package.json disagrees, so a surprise dependency upgrade is a build
failure rather than a silent event. "I changed nothing and the build broke" is
almost always a floating version somewhere.

## Monorepos and workspaces

```json
{ "workspaces": ["app", "packages/*"] }
```

One install, one lockfile, and packages can depend on each other by name without
publishing. Good when several deployables share code. The cost is more complex
builds and CI that should ideally only rebuild what changed — which is where
tools like Turborepo and Nx come in.

## Which tool, in 2026

- **Vite** — the default for new frontend apps. Fast, sensible, minimal config.
- **esbuild / SWC** — the fast transpilers underneath most modern tooling.
- **webpack** — still everywhere in existing codebases. Worth being able to read
  a config.
- **Rollup** — what Vite uses for production builds; good for libraries.
- **Next.js / Remix / Astro** — frameworks that own the build entirely.

## What you should be able to answer

- What does a bundler do, and why can the browser not just do it?
- What is tree shaking and what breaks it?
- Why do production filenames have hashes in them?
- Where do environment variables in a frontend app come from, and what must
  never go in one?
- What is the difference between `npm install` and `npm ci`?
