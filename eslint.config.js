// Lints the app and the build scripts this repo owns. The 233 project folders
// are teaching material with their own deliberate "before" code, so they are
// out of scope here.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

const hooks = reactHooks.configs.flat.recommended;

// The React Compiler rules in the recommended set start as warnings: they flag
// real smells but were not written against this codebase. rules-of-hooks and
// exhaustive-deps are the ones that catch outright bugs, so those fail.
const compilerRulesAsWarnings = Object.fromEntries(
  Object.keys(hooks.rules)
    .filter((rule) => rule !== 'react-hooks/rules-of-hooks' && rule !== 'react-hooks/exhaustive-deps')
    .map((rule) => [rule, 'warn']),
);

export default tseslint.config(
  {
    ignores: ['app/dist/**', 'app/public/**', 'node_modules/**', 'app/node_modules/**'],
  },
  {
    files: ['app/**/*.{ts,tsx,mjs,js}', 'scripts/build-content.mjs', 'scripts/build-content.test.mjs', 'scripts/gen-legacy-step-keys.mjs', 'eslint.config.js'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // TypeScript already knows every global; for the .mjs scripts Node's
      // globals (process, console, URL) are all this would flag.
      'no-undef': 'off',
    },
  },
  {
    files: ['app/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...hooks.rules,
      ...compilerRulesAsWarnings,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
);
