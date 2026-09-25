# ES modules in depth

Every file you write in a modern JavaScript or TypeScript project is a module,
yet most developers learn modules by copying `import` lines until the build
passes. Interviewers ask about ESM versus CommonJS, live bindings, circular
imports and code splitting because they are behind a whole family of confusing
bugs: `undefined` imports, bundles twice the size they should be, and "cannot
use import statement outside a module".

## ESM versus CommonJS

Node grew up with **CommonJS** (`require`, `module.exports`). The language
itself standardised **ES modules** (`import`, `export`) in 2015, and browsers,
Deno, Bun, bundlers and Node all support them. In 2026, write ESM for new code;
you will still read CommonJS in older packages and config files.

| | CommonJS | ES modules |
|--|----------|------------|
| Syntax | `require()`, `module.exports` | `import`, `export` |
| Resolved | At runtime, when `require` runs | Before any code runs (static) |
| Loading | Synchronous | Asynchronous-capable (allows top-level `await`) |
| Imports are | A copy of `module.exports` at that moment | **Live bindings** to the exporter's variables |
| `this` at top level | `module.exports` | `undefined` |
| Strict mode | Opt-in | Always |
| File paths | Extension optional | Extension required in Node and browsers |
| `__dirname` | Available | Use `import.meta.dirname` |

## Static structure, and why it enables tree-shaking

`import` and `export` may only appear at the top level of a module, with string
literal specifiers. That restriction is the point: a tool can read the whole
dependency graph and see exactly which names each file uses *without running
anything*.

Bundlers use that to **tree-shake**: to drop exports nobody imports. Import one
function from a large utility library written in ESM and only that function
(plus what it needs) ends up in your bundle. With CommonJS,
`require(someVariable)` and `module.exports[name] = ...` can be anything at
runtime, so bundlers must keep the lot.

Tree-shaking has limits. A module whose top level does something (registers a
polyfill, patches a global, imports CSS) cannot be dropped safely, so bundlers
keep it unless the package declares `"sideEffects": false` in its
`package.json`. And `import * as utils` followed by `utils[name]` defeats the
analysis. See [package managers and builds](package-managers-and-builds.md) for
where this sits in the build.

## Live bindings

An ESM import is not a copy. It is a read-only view of the exporting module's
variable:

```js
// counter.mjs
export let count = 0;
export function increment() { count += 1; }

// live.mjs
import { count, increment } from './counter.mjs';
console.log(count); // 0
increment();
console.log(count); // 1
count = 5;          // TypeError: Assignment to constant variable.
```

The CommonJS equivalent (`module.exports = { count, increment }`, then
destructuring the `require`) prints `0` after the increment, because the
importer copied the number at `require` time. Only the exporting module can
reassign an export; importers can still mutate the *contents* of an exported
object, which is one reason shared mutable module state is a smell.

## Evaluation order and circular imports

Loading a module graph happens in phases: parse every file, link all the
imports to exports, then **evaluate** depth-first, dependencies before
dependants, each module once. Two consequences surprise people.

First, imports are hoisted. However far down the file an `import` is written,
the dependency runs first.

Second, cycles. If `a.mjs` imports `b.mjs` and `b.mjs` imports `a.mjs`, one of
them must run before the other has finished:

```js
// a.mjs
console.log('a: start');
import { b } from './b.mjs';
console.log('a: body, b =', b);
export const a = 'A';

// b.mjs
import { a } from './a.mjs';
console.log('b: body');
try { console.log(a); } catch (e) { console.log('b: ' + e.name); }
export const b = 'B';
```

Running `node a.mjs` prints:

```text
b: body
b: ReferenceError
a: start
a: body, b = B
```

`b` evaluates first, while `a`'s `const` is still in its temporal dead zone, so
reading it throws. (With CommonJS you would get a half-built `exports` object
and a silent `undefined` instead.) A *function* in `b` that reads `a` later,
after both modules have finished, works fine; that is the live binding doing
its job. The fix for a real cycle is nearly always to move the shared piece
into a third module that both import.

## Dynamic `import()` and code splitting

`import('./path.js')` is an expression you can use anywhere. It returns a
promise of the module namespace object and loads the module on demand:

```js
button.addEventListener('click', async () => {
  const { exportToPdf } = await import('./pdf-export.js');
  exportToPdf(report);
});
```

Bundlers treat each dynamic import as a **split point** and put that module and
its unique dependencies in a separate chunk, fetched only when the line runs.
`React.lazy(() => import('./AdminPage'))` is the same mechanism. Split on
routes and rarely used heavy features (charts, editors, PDF generation); do not
split tiny modules, because each chunk is another request.

## Top-level `await`

In an ES module you can `await` outside any function:

```js
const config = await loadConfig();
export const db = await connect(config.databaseUrl);
```

Any module importing this one waits until the promise settles before it
evaluates. That is convenient for start-up work and dangerous for anything
slow: a top-level `await fetch(...)` in a shared module delays every module
that depends on it. CommonJS has no top-level `await`, which matters for
`require(esm)` below.

## `import.meta`

`import.meta` holds facts about the current module:

| Property | Gives you | Where |
|----------|-----------|-------|
| `import.meta.url` | This file's URL (`file:///...` in Node) | Everywhere |
| `import.meta.resolve(spec)` | The URL `spec` would resolve to, without loading it | Node 20+, browsers |
| `import.meta.dirname` / `filename` | The `__dirname` / `__filename` replacements | Node 20.11+ |
| `import.meta.env` | Build-time environment variables | Vite (not a standard) |

`new URL('./data.csv', import.meta.url)` is the portable way to point at a file
next to the current module; it works in Node and in bundled browser code.

## Import attributes: JSON and friends

You cannot import JSON as a bare module in Node or the browser. You must say
what type you expect, so that a server returning JavaScript where you expected
JSON cannot run code in your page:

```js
import config from './config.json' with { type: 'json' };
const translations = await import('./en.json', { with: { type: 'json' } });
```

Leave out `with { type: 'json' }` in Node 24 and the import fails with
`ERR_IMPORT_ATTRIBUTE_MISSING`. The older `assert { type: 'json' }` spelling
was replaced by `with` and has been removed; update it where you find it.

## `package.json`: `"type"` and `"exports"`

Node decides whether a `.js` file is ESM or CommonJS from the nearest
`package.json`:

```json
{
  "name": "@acme/money",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./format": "./dist/format.js"
  }
}
```

- `"type": "module"` makes `.js` mean ESM. Without it, `.js` is CommonJS. The
  extensions `.mjs` and `.cjs` always win regardless.
- `"exports"` defines the package's public entry points. Anything not listed
  cannot be imported, so `@acme/money/dist/internal.js` fails even though the
  file exists. Conditions such as `import`, `require` and `types` pick a file
  per consumer, and order matters: the first match wins.

TypeScript follows the same rules with `"module": "nodenext"`; see
[TypeScript with Node](typescript-with-node.md) and
[tsconfig explained](tsconfig-explained.md).

## Interop, and `require(esm)` in Node 22+

ESM can import CommonJS: `import pkg from './legacy.cjs'` gives you
`module.exports` as the default export, and Node also detects most named
exports. The other direction used to be impossible, which is why so many
packages shipped two builds.

Since Node 22.12 (and in Node 24 without any flag), `require()` can load an ES
module synchronously, returning its namespace object (`mod.default` for a
default export). The one exception is a module graph that uses top-level
`await`: that cannot be loaded synchronously, and `require` throws
`ERR_REQUIRE_ASYNC_MODULE`. For library authors this makes ESM-only packages
practical; for you it means one less reason to be stuck on CommonJS.

## Bundlers and import maps

Browsers run ESM natively (`<script type="module">`), so why bundle? Because
real apps import from `node_modules` with bare specifiers (`'react'`) that
browsers cannot resolve, use TypeScript and JSX, and would otherwise fetch
hundreds of small files in a waterfall. Vite, esbuild, Rollup and webpack
resolve, transform, tree-shake, split and minify. Vite serves native ESM in
development and bundles for production.

An **import map** is the browser's own answer to bare specifiers:

```html
<script type="importmap">
  { "imports": { "lodash-es": "/vendor/lodash-es/lodash.js" } }
</script>
```

It is handy for small sites and prototypes without a build step. It does not
tree-shake or bundle, so production apps still use a bundler.

## What you should be able to answer

- What is a live binding, and what does an ESM importer see after the exporter reassigns a variable, compared with CommonJS?
- Why can bundlers tree-shake ESM but not most CommonJS, and what does `"sideEffects": false` tell them?
- In what order do modules in a circular import evaluate, and why might one side see a `ReferenceError` or `undefined`?
- How does dynamic `import()` enable code splitting, and what would you split in a CRUD app?
- What do `"type"` and `"exports"` in `package.json` control?
- Can you `require()` an ES module in Node 24, and when does it still fail?
