# TypeScript on Node 24

Running TypeScript on the server used to mean choosing between `ts-node`,
Babel and a `tsc` watch process, then fighting ESM. Node 24 runs `.ts` files
itself, which changes the answer to "how do you run TypeScript in production?"
and adds new rules about what TypeScript you can write. Interviewers ask about
it because the old answers are now wrong.

## Node runs `.ts` files, but does not check them

Since Node 23.6 (and 22.18 on the LTS line), type stripping is on by default.
On Node 24:

```sh
node src/server.ts
```

That works with no flag and no dependency. Node replaces each type annotation
with whitespace, so line and column numbers are unchanged and no source map is
needed, then runs the result as JavaScript. It **does not type-check**:

```ts
const port: number = 'not a number';   // deliberate type error: tsc reports TS2322
console.log('ran', port);   // Node prints "ran not a number" without complaint
```

So `tsc --noEmit` stays in your CI and editor; Node just skips the build step
for running. `process.features.typescript` reports `'strip'`. Node also reads
no `tsconfig.json` at all, so `paths`, `target` and every other compiler option
are ignored when Node runs your code. And it refuses to strip `.ts` files inside
`node_modules`, so packages must still publish JavaScript.

## Erasable syntax only

Stripping works only for syntax that can be deleted without changing
behaviour. TypeScript features that *generate* code are rejected:

| Syntax | Under type stripping |
|---|---|
| Annotations, `interface`, `type`, generics, `as`, `satisfies` | Fine, erased |
| `import type` / `export type` | Fine, erased |
| `enum` | `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` |
| Parameter properties (`constructor(private url: string)`) | Rejected |
| `namespace` with runtime code | Rejected |
| `import x = require('x')` | Rejected |
| Legacy decorators (`experimentalDecorators`) | Not supported |

`node --experimental-transform-types` transforms enums and friends, but it
is experimental and prints a warning. The better answer is to write erasable
TypeScript and let the compiler enforce it with `erasableSyntaxOnly` (TS 5.8),
which reports TS1294 on each offending line. Replace enums with a const object
and a derived union:

```ts
export const Role = { Admin: 'admin', Member: 'member' } as const;
export type Role = (typeof Role)[keyof typeof Role];   // 'admin' | 'member'

class ApiClient {
  readonly baseUrl: string;               // instead of a parameter property
  constructor(baseUrl: string) { this.baseUrl = baseUrl; }
}
```

## Imports: extensions, and `import type`

Node's ESM loader does not guess file extensions, so relative imports must name
the file that exists on disk:

```ts
import { greet } from './lib/greet.ts';          // works
import type { Name } from './lib/greet.ts';      // type-only, erased
// import { greet } from './lib/greet';          // ERR_MODULE_NOT_FOUND at runtime
```

Two more traps. Importing a *type* without `type` (`import { Name, greet }`)
fails at runtime with "does not provide an export named 'Name'", because Node
cannot know that `Name` was only a type. `verbatimModuleSyntax` makes the
compiler catch that for you. And the compiler needs permission to see `.ts` in an
import:

- **`allowImportingTsExtensions`** permits `.ts` imports but only with `noEmit`
  (or `emitDeclarationOnly`), because the emitted JavaScript would point at
  files that do not exist.
- **`rewriteRelativeImportExtensions`** (TS 5.7) permits them *and* rewrites
  `./greet.ts` to `./greet.js` when `tsc` emits. That lets the same source run
  directly under Node in development and compile to `dist/` for production.

A tsconfig for a Node 24 service written this way:

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "target": "es2024",
    "lib": ["es2024"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "rewriteRelativeImportExtensions": true,
    "rootDir": "src",
    "outDir": "dist",
    "sourceMap": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

[tsconfig-explained.md](tsconfig-explained.md) covers each option in detail.

## Three ways to run it

| Tool | What it does | Use it for |
|---|---|---|
| `node file.ts` | Strips types, runs. No config, no deps. | Scripts, dev servers, tests, and production if you accept its limits |
| `tsx` | esbuild-based loader. Handles enums, parameter properties, extensionless imports, tsconfig `paths`. | Dev when your code is not erasable-only; `tsx watch` |
| `tsc` → `node dist/` | Full compile to JavaScript | Libraries, and production builds that must not depend on runtime stripping |

None of the three type-check at run time; the check is always a separate `tsc
--noEmit`. For production, many teams still compile: the output is plain
JavaScript that starts slightly faster, source maps are explicit and nothing
depends on a feature of the runtime. Running `node src/server.ts` in production
is legitimate on Node 24; just decide it on purpose. `ts-node` is largely
legacy now.

```json
{
  "scripts": {
    "dev": "node --watch --env-file=.env src/server.ts",
    "typecheck": "tsc --noEmit",
    "build": "tsc",
    "start": "node dist/server.js",
    "test": "node --test"
  }
}
```

## ESM, CommonJS, and `module: nodenext`

`"type": "module"` in package.json makes `.js` and `.ts` files ESM; without
it they are CommonJS. `.mts`/`.cts` (emitting `.mjs`/`.cjs`) force one or
the other per file. With `module: nodenext`, TypeScript applies the same
per-file rule Node does, which is why it is the right setting for Node code
and `bundler` is the wrong one (see
[node-runtime-and-npm.md](node-runtime-and-npm.md) for the module systems
themselves).

The historical pain was that CommonJS could not `require()` an ES module.
Since Node 22.12 (and in Node 24) it can, unflagged, as long as the ES module
has no top-level `await`. That includes type-stripped `.ts` modules:

```js
// legacy.cjs
const { greet } = require('./src/lib/greet.ts');   // works on Node 24
```

In practice: start new services as ESM, and stop treating dual ESM/CJS
publishing as mandatory for application code.

## Path aliases: `paths` versus `imports`

`compilerOptions.paths` tells the *type-checker* that `@/lib/greet` means
`src/lib/greet`. It **does not rewrite the emitted JavaScript**, and Node
ignores tsconfig entirely, so the import crashes at runtime unless a bundler,
`tsx` or a post-build rewriter handles it. That surprises almost everyone once.

The Node-native answer is **subpath imports**: the `imports` field in
package.json, whose keys must start with `#`. Node resolves it, and TypeScript
understands it under `nodenext` and `bundler`:

```json
{
  "type": "module",
  "imports": {
    "#lib/*": {
      "development": "./src/lib/*.ts",
      "default": "./dist/lib/*.js"
    }
  }
}
```

```ts
import { greet } from '#lib/greet';
```

`node --conditions=development src/main.ts` resolves to the TypeScript source,
plain `node dist/main.js` to the build, and `tsc` maps the `dist` target back
to `src` when checking. If you only ever run source files, the mapping can be
a single `"#lib/*": "./src/lib/*.ts"`.

## `@types/node` versioning

Node's own API types come from `@types/node`, whose major version tracks
Node's. A bare `npm i -D @types/node` installs the newest (currently 26.x),
which will happily type APIs your Node 24 does not have. Pin it:

```sh
npm i -D @types/node@24
```

Then list it in `"types": ["node"]`, and leave `dom` out of `lib` so browser
globals such as `window` are errors in server code. Renovate or Dependabot
should bump `@types/node` in step with your Node runtime, not ahead of it.

## Tests with `node:test`

The built-in runner works on `.ts` files with no setup. `node --test` finds
`*.test.ts` files by default (as well as `.js`, `.mjs` and `.cjs`):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greet } from '../src/lib/greet.ts';

test('greets by name', () => {
  assert.equal(greet('ada'), 'hi ada');
});
```

The same rules apply: erasable syntax, explicit `.ts` extensions, no type
checking. For large suites with mocking needs, Vitest remains the richer
option; for a service's unit tests, `node --test` is enough and one fewer
dependency.

## What you should be able to answer

- What does Node 24 do when you run `node server.ts`, and what does it not do?
- Why does `enum` crash under type stripping, and what do you write instead?
- Why must relative imports include `.ts`, and what do
  `allowImportingTsExtensions` and `rewriteRelativeImportExtensions` each do?
- Your `paths` alias type-checks but crashes at runtime. Why, and what is the
  Node-native fix?
- Can CommonJS code `require()` an ES module on Node 24? What is the exception?
- Would you run `.ts` directly in production or compile first, and why?
