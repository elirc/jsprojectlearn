/** Inline code rendering, run commands, and CSS guarantees jsdom can't check. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommands } from './content.ts';
import { inlineCode } from './format.ts';
import type { Project } from './types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('inlineCode escapes HTML first, then renders backtick spans as <code>', () => {
  assert.equal(inlineCode('What does `<div>` do & why?'), 'What does <code>&lt;div&gt;</code> do &amp; why?');
  assert.equal(inlineCode('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(inlineCode('a `b` c `d`'), 'a <code>b</code> c <code>d</code>');
});

test('inlineCode handles ```fences``` and leaves an unmatched backtick alone', () => {
  assert.equal(inlineCode('```let x = 1;``` then'), '<code>let x = 1;</code> then');
  assert.equal(inlineCode('a ` alone'), 'a ` alone');
  assert.equal(inlineCode('no **markdown** here'), 'no **markdown** here');
});

const project = (patch: Partial<Project>): Project => ({
  id: 'js/01-x',
  track: 'js',
  number: 1,
  slug: 'x',
  name: '01-x',
  dir: '01-x',
  title: 'X',
  blurb: '',
  docs: [],
  sources: [],
  hasTests: false,
  ...patch,
});

const cmds = (p: Project) => runCommands(p).map((c) => c.cmd);

test('runCommands is derived from the files a project really has', () => {
  assert.deepEqual(cmds(project({ sources: [{ path: 'original.js', bytes: 1 }] })), ['node 01-x/original.js']);
  assert.deepEqual(
    cmds(project({ dir: '02-page', sources: [{ path: 'original.html', bytes: 1 }] })),
    ['02-page/original.html'],
  );
  assert.equal(runCommands(project({ sources: [{ path: 'original.html', bytes: 1 }] }))[0]?.label, 'Open in a browser');

  const ts = cmds(project({ track: 'ts', dir: 'typescript/07-enums', sources: [{ path: 'original.ts', bytes: 1 }] }));
  assert.ok(ts.includes('node --experimental-transform-types typescript/07-enums/original.ts'), ts.join());
  assert.ok(!ts.some((c) => c.includes('strip-types') || c.endsWith('.js')), 'no strip-types or .js for TS');

  const cs = cmds(project({ track: 'csharp', dir: 'csharp/01-x', sources: [{ path: 'original.cs', bytes: 1 }], hasTests: true }));
  assert.ok(cs.includes('dotnet run --project csharp/01-x/refactored'));
  assert.ok(cs.includes('dotnet run --project csharp/01-x/refactored -- test'));
});

test('the test command appears only when the project has tests', () => {
  const src = [{ path: 'original.js', bytes: 1 }];
  assert.ok(!cmds(project({ sources: src })).some((c) => c.startsWith('node --test')));
  assert.ok(cmds(project({ sources: src, hasTests: true })).includes('node --test "01-x/**/*.test.js"'));
  const mjs = [...src, { path: 'refactored/app.test.mjs', bytes: 1 }];
  assert.ok(cmds(project({ sources: mjs, hasTests: true })).includes('node --test "01-x/**/*.test.mjs"'));
});

// ------------------------------------------------------------------- CSS

const css = readFileSync(path.join(HERE, '..', 'styles', 'app.css'), 'utf8');

test('the ≤860px layout does not hide the sidebar foot (Settings + theme)', () => {
  const mobile = css.slice(css.indexOf('@media (max-width: 860px)'));
  const hidden = [...mobile.matchAll(/([^{}]+)\{\s*display:\s*none;?\s*\}/g)].map((m) => m[1] ?? '');
  assert.ok(hidden.length > 0);
  assert.ok(!hidden.some((selectors) => selectors.includes('.sidebar-foot')), hidden.join(' | '));
});

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) =>
    v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return ((x ?? 0) + 0.05) / ((y ?? 0) + 0.05);
};
const token = (block: string, name: string) => new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(block)?.[1] ?? '';

test('--ink-faint passes WCAG AA (4.5:1) on every surface in both themes; --line-strong passes 3:1', () => {
  const dark = css.slice(css.indexOf(':root {'), css.indexOf("[data-theme='light']"));
  const light = css.slice(css.indexOf(":root[data-theme='light']"));
  for (const [name, block] of [['dark', dark], ['light', light]] as const) {
    for (const surface of ['bg', 'bg-raised', 'bg-inset', 'panel']) {
      const ratio = contrast(token(block, 'ink-faint'), token(block, surface));
      assert.ok(ratio >= 4.5, `${name} --ink-faint on --${surface} is ${ratio.toFixed(2)}`);
      const line = contrast(token(block, 'line-strong'), token(block, surface));
      assert.ok(line >= 3, `${name} --line-strong on --${surface} is ${line.toFixed(2)}`);
    }
  }
});
