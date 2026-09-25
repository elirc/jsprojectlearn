# Declaration files and migrating JavaScript to TypeScript

Very few jobs hand you a greenfield TypeScript codebase. You inherit a
JavaScript app, a library with no types, or a half-migrated repo with `any`
everywhere. Interviewers ask how you would type an untyped dependency and how
you would migrate 200 files without stopping feature work, because both are
everyday problems with well-known answers.

## What a `.d.ts` file is

A declaration file contains types and no runtime code. It describes JavaScript
that exists somewhere else. The compiler reads it; nothing executes it.

```ts
// vendor/legacy-slugify.d.ts, next to vendor/legacy-slugify.js
export interface SlugifyOptions {
  separator?: string;
  lower?: boolean;
}
export default function slugify(input: string, options?: SlugifyOptions): string;
```

Put `foo.d.ts` beside `foo.js` and TypeScript pairs them: `import slugify from
'./vendor/legacy-slugify.js'` is now fully typed, and `slugify(42)` or a
misspelt `{ sep: '_' }` becomes a compile error (see
[ts/38](../../typescript/38-declaring-modules/)).

A declaration is trusted, not checked. If you write that a function returns
`string` and it returns `null`, you have written a cast in a separate file. So
declare only what you use, and copy constraints from the library's docs.

Where declarations come from:

| Source | How you get it |
|---|---|
| Bundled with the package | `"types"` in its package.json; nothing to install. Most modern packages. |
| DefinitelyTyped | `npm i -D @types/lodash`. Community-maintained, versioned to match the library's major/minor. |
| Your own | A `.d.ts` in your repo, e.g. `src/types/`. |
| Generated | `tsc --declaration` from TypeScript source, or from JSDoc-annotated JS with `allowJs`. |

Check the npm page first: a "TS" badge means bundled types, and a "DT" badge
means use `@types`. Keep `@types/*` in `devDependencies`, and match
`@types/node` to your Node major.

## `declare module` for untyped packages

When a package ships no types and has none on DefinitelyTyped, declare it
yourself in any `.d.ts` that `include` picks up:

```ts
// src/types/tiny-csv.d.ts
declare module 'tiny-csv' {
  export interface ParseOptions { delimiter?: string; header?: boolean }
  export function parse(text: string, options?: ParseOptions): string[][];
}

// The escape hatch: everything imported from it is any
declare module 'some-untyped-lib';
```

The shorthand form silences "could not find a declaration file" in one line,
but everything imported from it is `any`, so it is a debt marker rather than a
solution. The error you are silencing is TS7016, which only appears under
`noImplicitAny`, and that is why a strict project surfaces missing types
immediately.

The same syntax declares non-code imports for bundlers:

```ts
declare module '*.svg' {
  const url: string;
  export default url;
}
```

## Module augmentation and `declare global`

**Augmentation** adds to types a library already declares. The canonical
example is putting an authenticated user on Express's `Request`:

```ts
// src/types/express.d.ts
import 'express';

declare module 'express-serve-static-core' {
  interface Request {
    user?: { id: string; role: 'admin' | 'member' };
  }
}
```

Two rules make this work. The file must be a *module* (it has an `import` or
`export`), otherwise `declare module` *replaces* the library's declaration
instead of merging with it. And you can only merge into interfaces and
namespaces, never type aliases, which is one reason libraries expose extension
points as interfaces. You augment `express-serve-static-core` rather than
`express` because that is where `Request` is actually declared.

**Global augmentation** adds to the global scope from inside a module:

```ts
// src/types/globals.d.ts
export {};

declare global {
  interface Window {
    __APP_CONFIG__: { apiUrl: string };
  }
  var __BUILD_ID__: string;   // var, not let/const, to create a global
}
```

Use it sparingly: every global is invisible coupling. Vite's `ImportMetaEnv`
interface for typing `import.meta.env` is the same mechanism.

## Types in package.json

If you publish a package, consumers find your types through package.json.

```json
{
  "name": "@acme/contracts",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./schemas": {
      "types": "./dist/schemas.d.ts",
      "import": "./dist/schemas.js"
    }
  },
  "types": "./dist/index.d.ts"
}
```

- **`exports` with a `"types"` condition** is what modern resolution
  (`nodenext`, `bundler`) reads. Conditions match in order, so `"types"` goes
  first. Anything not listed in `exports` cannot be imported at all.
- **Top-level `"types"`** is the fallback for older `node10` resolution.
- **`typesVersions`** maps paths per TypeScript version, and was also used to
  fake subpath exports for `node10`. You meet it in older packages; new
  packages rarely need it.
- A dual ESM/CommonJS package needs separate declaration files per format
  (`index.d.ts` and `index.d.cts`). Getting this wrong is common enough that
  [Are the Types Wrong?](https://arethetypeswrong.github.io/) exists to check it.

## JSDoc types and `checkJs`

You can type-check JavaScript without renaming it. `allowJs` lets `.js` files
into the program; `checkJs` (or `// @ts-check` per file) type-checks them,
using JSDoc for annotations:

```js
// @ts-check

/** @typedef {{ id: string, total: number }} Order */

/**
 * @param {Order[]} orders
 * @returns {number}
 */
export function sum(orders) {
  return orders.reduce((n, o) => n + o.total, 0);
}

sum([{ id: 'a', total: '12' }]);   // error: Type 'string' is not assignable to type 'number'
```

This is not a toy. Some well-known projects (Svelte among them) ship JSDoc-typed
JavaScript to avoid a build step, with `.d.ts` generated from it. For a
migration it is the zero-risk first move: you get errors in the editor before
anyone renames a file.

## A migration strategy that survives contact with a real team

The goal is that every commit ships and the codebase gets stricter over time,
never a six-week branch.

1. **Add `tsconfig.json` with `allowJs: true`, `checkJs: false`, `strict: false`.**
   Wire `tsc --noEmit` into CI. Nothing breaks; the build now knows the files.
2. **Loosen, then tighten.** Turn on `strict` early in the config but let
   legacy code opt out, rather than waiting until the end to flip it and
   facing 3,000 errors at once.
3. **Convert leaf modules first.** Utilities with no internal imports, then the
   modules that use them. Types flow upward, so each conversion improves its
   callers. Type the API boundary early (see
   [typescript-runtime-validation.md](typescript-runtime-validation.md)); it
   is where the worst `any` enters.
4. **Per-folder strictness.** A strict `tsconfig.json` in `src/new/` that
   extends the root, or project references for bigger splits, lets converted
   areas stay strict while legacy ones catch up.
5. **Ratchet.** Measure, and fail CI if the number goes up.

`@ts-expect-error` versus `@ts-ignore` is a standard question:

```ts
// @ts-expect-error: legacy value, removed in the pricing rewrite
const n: number = 'x';

// @ts-ignore
const m: number = 5;          // silently accepted forever

// @ts-expect-error
const ok: number = 5;         // error: Unused '@ts-expect-error' directive
```

`@ts-ignore` suppresses whatever might be on the next line, now or in future.
`@ts-expect-error` fails when there is *no* error, so when someone fixes the
underlying problem the comment is flagged for removal. Always use
`@ts-expect-error`, with a reason. typescript-eslint's `ban-ts-comment` rule
can enforce that.

**Counting `any`** is how you ratchet. Options, cheapest first: a grep for
`: any` and `as any`; typescript-eslint's `no-explicit-any` and the
`no-unsafe-*` rules, which also catch implicit `any` flowing from untyped
imports; and the `type-coverage` package, which reports the percentage of
identifiers whose type is not `any` and can fail CI below a threshold.
[ts/01](../../typescript/01-any-epidemic/) shows how one `any` spreads.

## Typing an untyped library, end to end

1. Check for bundled types, then `@types/<name>`. Check the version matches.
2. If neither exists, create `src/types/<name>.d.ts` with `declare module
   '<name>'` and declare **only the functions you call**, with types taken from
   the docs and verified against the source.
3. Wrap the library in one module of your own that exposes a narrow, fully
   typed API, and have the rest of the app import that. If the declarations
   turn out to be wrong, there is one place to fix.
4. If the library returns data from the outside world, validate it at the
   wrapper instead of trusting a declared return type.
5. When your declarations have stabilised, consider contributing them to
   DefinitelyTyped.

## What you should be able to answer

- What is a `.d.ts` file, and what happens if its declarations are wrong?
- A package has no types. What do you check, and what do you write if nothing
  exists?
- How do you add a `user` property to Express's `Request` type, and why must
  the file contain an `import`?
- Why prefer `@ts-expect-error` over `@ts-ignore`?
- How would you migrate a 200-file JavaScript app to TypeScript without a
  feature freeze?
- How does a published package tell TypeScript where its types are?
