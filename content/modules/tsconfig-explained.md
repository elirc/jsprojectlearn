# tsconfig, option by option

Most TypeScript projects start from a tsconfig someone copied, and most teams
cannot say what half of it does. In an interview, being able to explain why
`strict` is on, what `moduleResolution: bundler` changes and why the build
needs `skipLibCheck` shows you understand the compiler rather than just
tolerate it.

## What `tsc --init` gives you in TypeScript 5.9

TypeScript 5.9 rewrote `tsc --init` to produce a short, opinionated file
instead of a wall of comments. Stripped of comments it is:

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "target": "esnext",
    "types": [],
    "sourceMap": true,
    "declaration": true,
    "declarationMap": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "strict": true,
    "jsx": "react-jsx",
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "noUncheckedSideEffectImports": true,
    "moduleDetection": "force",
    "skipLibCheck": true
  }
}
```

That is a reasonable modern baseline: strict, the two extra-strict index and
optional flags, explicit module syntax, and library-style outputs. The empty
`types` array stops every `@types/*` package in `node_modules` being loaded as
globals; for a Node project you set `"types": ["node"]` and install
`@types/node`. The rest of this guide explains each choice.

## The `strict` family

`"strict": true` is shorthand for a set of flags, and new flags join the set
in later releases (so upgrading TypeScript can surface new errors: that is
intended).

| Flag | What it catches |
|---|---|
| `strictNullChecks` | `null`/`undefined` are separate types; you must narrow before use. The single most valuable flag. |
| `noImplicitAny` | Parameters and variables whose type cannot be inferred are an error, not a silent `any`. |
| `strictFunctionTypes` | Function parameters are checked contravariantly, so unsafe callback assignments fail. |
| `useUnknownInCatchVariables` | `catch (err)` gives `err: unknown` rather than `any`. |
| `strictPropertyInitialization` | Class fields must be assigned in the constructor or marked `!`/optional. |
| `strictBindCallApply` | `fn.call`, `.apply`, `.bind` are checked against `fn`'s signature. |
| `noImplicitThis` | `this` with an implicit `any` type is an error. |
| `alwaysStrict` | Emits `"use strict"` and parses in strict mode. |
| `strictBuiltinIteratorReturn` (5.6) | Built-in iterators return `undefined`, not `any`, when done. |

Two in action:

```ts
function findUser(id: string): { name: string } | undefined { return undefined; }
// @ts-expect-error: strictNullChecks, the result is possibly 'undefined'
findUser('1').name;

type Handler = (e: MouseEvent | KeyboardEvent) => void;
const onMouse = (e: MouseEvent) => console.log(e.clientX);
// @ts-expect-error: strictFunctionTypes, it would be handed KeyboardEvents too
const h: Handler = onMouse;
```

Method-syntax declarations (`handle(e: Event): void` inside an interface) are
still checked bivariantly, which is a known hole kept for compatibility. The
catch-variable flag is covered in [typescript-error-handling.md](typescript-error-handling.md).

## Stricter than strict

These are not in `strict`, but the first two are now in the `--init` template
and worth turning on in any new project.

```ts
// noUncheckedIndexedAccess: indexing may miss
const scores: number[] = [];
const first = scores[0];        // number | undefined
// @ts-expect-error: first is possibly 'undefined'
first.toFixed(2);
for (const s of scores) s.toFixed(2);   // iteration is still fine

// exactOptionalPropertyTypes: "missing" and "present but undefined" differ
type Options = { timeout?: number };
// @ts-expect-error: undefined is not assignable unless declared
const o: Options = { timeout: undefined };

// noImplicitOverride: overriding must be explicit
class Base { save() {} }
class Child extends Base { override save() {} }
```

| Flag | Why you want it |
|---|---|
| `noUncheckedIndexedAccess` | `arr[i]` and `record[key]` include `undefined`. Catches real off-by-one and missing-key bugs. |
| `exactOptionalPropertyTypes` | `{ a?: T }` means "may be absent", not "may be `undefined`". Matters for `PATCH` bodies and `'a' in obj` checks. Noisy to retrofit. |
| `noImplicitOverride` | Renaming a base method cannot leave an orphaned "override" behind. |
| `noFallthroughCasesInSwitch` | A non-empty `case` without `break`/`return` is an error. |
| `noImplicitReturns` | Every code path in a function with a return type must return. |
| `noUnusedLocals` / `noUnusedParameters` | Usually better left to the linter, so they do not block a build mid-refactor. |

Practice switching these on one at a time in
[ts/39](../../typescript/39-strictness-flags/).

## `target` and `lib`

**`target`** decides which syntax `tsc` down-levels. With `es2022`, class
fields and top-level `await` are emitted as-is; with `es2017`, optional
chaining is rewritten. Node 24 and evergreen browsers handle `es2023`+ fine,
and if a bundler or Node's type stripping does the emitting, `target` barely
matters.

**`lib`** decides which *type declarations* exist: `es2022` gives you
`Array.prototype.at`, `dom` gives you `document`. It defaults from `target`
(plus `dom`). `target` does not polyfill anything: setting `lib: ["es2024"]`
lets you call `Object.groupBy`, and if the runtime lacks it you crash. For a
Node project, drop `dom` so that `window` is a compile error.

## `module` and `moduleResolution`

`module` says what import/export syntax to emit and which module rules to
apply; `moduleResolution` says how `'./x'` or `'zod'` is found on disk. Pick
the pair that matches whatever actually *runs* your code:

| Setting | Use when | Behaviour |
|---|---|---|
| `module: nodenext` (resolution follows) | Code runs in Node, compiled by `tsc` or type-stripped | Real Node rules: ESM vs CJS per file from `package.json` `"type"`, relative ESM imports need extensions, `exports` honoured. |
| `module: node20` (5.9) | Same, pinned to Node 20+ behaviour | A stable alternative to the moving `nodenext`. |
| `module: esnext` + `moduleResolution: bundler` | Vite, webpack, esbuild consume the output | Extensionless imports allowed, `exports` honoured, no CJS/ESM per-file split. |
| `module: preserve` (5.4) | A bundler or runtime handles everything | Emits imports exactly as written, allows `import x = require()`; implies `bundler` resolution. |
| `moduleResolution: node10` | Legacy only | Pre-`exports` Node resolution. Deprecated from TypeScript 6. |

The classic mistake is using `bundler` for a Node server: it compiles, then
Node refuses `import './db'` with no extension at runtime.
[typescript-with-node.md](typescript-with-node.md) covers the Node side and
[package-managers-and-builds.md](package-managers-and-builds.md) the bundler side.

## Emit-shaping flags

| Flag | What it does |
|---|---|
| `verbatimModuleSyntax` | Imports without `type` are kept; `import type` is dropped. So you must write `import type { User }` for type-only imports. It makes per-file transpilers (esbuild, SWC, Node) safe and implies `isolatedModules`. |
| `isolatedModules` | Errors on anything a file-at-a-time transpiler cannot compile correctly, such as re-exporting a type without `export type`. |
| `erasableSyntaxOnly` (5.8) | Errors on TypeScript syntax with runtime behaviour: `enum`, `namespace` with values, parameter properties, `import x = require()`. Turn on when Node's type stripping runs your code. |
| `esModuleInterop` | Lets `import express from 'express'` work against CommonJS `module.exports =`. Implied by `nodenext`/`preserve`; always on in practice. |
| `skipLibCheck` | Skips type-checking `.d.ts` files. Much faster builds and avoids conflicts between two libraries' declarations. Your own code is still checked. |
| `noEmit` | Type-check only. Used when Vite, esbuild or Node does the transpiling. |
| `declaration` / `declarationMap` | Emit `.d.ts` files (and maps from them back to source) for a library's consumers. |
| `sourceMap` | Emit `.js.map` so stack traces and debuggers show TypeScript lines. |
| `outDir` / `rootDir` | Where emitted JS goes, and which folder's structure it mirrors. |

## Which files: `include`, `exclude`, `files`

```json
{
  "include": ["src", "test"],
  "exclude": ["src/**/*.fixture.ts"],
  "compilerOptions": { "rootDir": ".", "outDir": "dist" }
}
```

- **`include`** takes globs; the default is everything under the config's folder.
- **`exclude`** only filters what `include` matched. It does **not** stop a file
  being compiled if an included file imports it. The same goes for
  `node_modules`: it is excluded by default but still resolved when imported.
- **`files`** is an explicit list, rarely used outside tiny builds.

Run `tsc --listFilesOnly` when you are unsure what is in the program, and
`tsc --showConfig` to see the fully resolved config, including implied options.

## `extends` and shared bases

`extends` merges another config under yours (your options win; `include`,
`exclude` and `files` are replaced, not merged, and paths resolve relative to
the file that declares them).

```json
{
  "extends": "@tsconfig/node24/tsconfig.json",
  "compilerOptions": { "outDir": "dist", "noUncheckedIndexedAccess": true },
  "include": ["src"]
}
```

The `@tsconfig/bases` project publishes maintained presets per runtime
(`@tsconfig/node24`, `@tsconfig/strictest`, `@tsconfig/vite-react`), so you
do not hand-maintain `target` and `lib` for each Node release. In a monorepo,
a root `tsconfig.base.json` that every package extends does the same job.

## Project references and `composite`

In a monorepo, one giant program is slow and lets any file import any other.
Project references split it:

```json
{
  "files": [],
  "references": [{ "path": "./packages/contracts" }, { "path": "./apps/api" }]
}
```

Each referenced project sets `"composite": true`, which forces `declaration`
on and requires every file to be matched by `include`. `tsc --build` (`tsc -b`)
then builds projects in dependency order, reuses `.tsbuildinfo` to skip
unchanged ones, and `apps/api` sees `contracts` through its `.d.ts` output
instead of re-checking its source. The payoff is incremental CI builds and
enforced boundaries; the cost is more config. Small repos rarely need it.

## What you should be able to answer

- What does `strict: true` switch on, and which of those flags matters most?
- What does `noUncheckedIndexedAccess` change, and why is it not in `strict`?
- When do you choose `moduleResolution: bundler` over `nodenext`, and what
  breaks if you pick wrong?
- What is the difference between `target` and `lib`, and does either polyfill?
- Why do `verbatimModuleSyntax`, `isolatedModules` and `erasableSyntaxOnly`
  exist, and what do they have to do with esbuild or Node running `.ts` files?
- Why does `exclude` not stop a file from being type-checked?
