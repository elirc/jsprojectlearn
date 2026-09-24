/**
 * Markdown regressions. The data-driven tests read the REAL documents from
 * the repo (not app/public, which other builds regenerate concurrently).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { headings, renderMarkdown, resolveHref, tableOfContents } from './markdown.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HANDBOOKS = ['HANDBOOK.md', 'typescript/HANDBOOK.md', 'react/HANDBOOK.md', 'csharp/HANDBOOK.md'];

function realDocs(): { name: string; md: string }[] {
  const docs = HANDBOOKS.map((name) => ({ name, md: readFileSync(path.join(ROOT, name), 'utf8') }));
  const guides = path.join(ROOT, 'content', 'modules');
  if (existsSync(guides)) {
    for (const file of readdirSync(guides).filter((f) => f.endsWith('.md'))) {
      docs.push({ name: `guides/${file}`, md: readFileSync(path.join(guides, file), 'utf8') });
    }
  }
  return docs;
}

const renderedIds = (html: string): Set<string> =>
  new Set([...html.matchAll(/<h[1-6] id="([^"]*)"/g)].map((m) => m[1] ?? ''));

test('every TOC entry of every real doc lands on a rendered heading id', () => {
  const docs = realDocs();
  assert.ok(docs.length >= 4);
  for (const { name, md } of docs) {
    const ids = renderedIds(renderMarkdown(md));
    for (const entry of tableOfContents(md)) {
      assert.ok(ids.has(entry.id), `${name}: TOC id "${entry.id}" (${entry.text}) has no heading`);
    }
    // And every heading id the lexer walk predicts is the one the renderer used.
    for (const h of headings(md)) assert.ok(ids.has(h.id), `${name}: heading id "${h.id}" not rendered`);
  }
});

test('a heading with an apostrophe or ampersand slugs the same in TOC and heading', () => {
  const md = "## 12. The repo's big ideas\n\n## `useEffect` & cleanup\n";
  const html = renderMarkdown(md);
  const toc = tableOfContents(md);
  assert.deepEqual(toc, [
    { id: '12-the-repos-big-ideas', text: "12. The repo's big ideas" },
    { id: 'useeffect-cleanup', text: 'useEffect & cleanup' },
  ]);
  for (const entry of toc) assert.ok(html.includes(`id="${entry.id}"`), html);
});

test('duplicate headings get -2, -3 in both the renderer and the TOC', () => {
  const md = '## Setup\n\n## Setup\n\n## Setup\n';
  assert.deepEqual(
    tableOfContents(md).map((e) => e.id),
    ['setup', 'setup-2', 'setup-3'],
  );
  const html = renderMarkdown(md);
  assert.ok(html.includes('id="setup-2"') && html.includes('id="setup-3"'), html);
});

test('#anchor links resolve against the route of the current document', () => {
  const html = renderMarkdown('[x](#1-what-a-type-is)', { routePath: '/doc/typescript/HANDBOOK.md' });
  assert.ok(html.includes('href="#/doc/typescript/HANDBOOK.md#1-what-a-type-is"'), html);
  assert.equal(resolveHref('#y', { routePath: '/guide/sql-fundamentals' }), '#/guide/sql-fundamentals#y');
  // Without a route there is nothing better to do than leave it.
  assert.equal(resolveHref('#y'), '#y');
});

test('the real TS and C# handbooks have no bare #anchor links left after rendering', () => {
  for (const doc of ['typescript/HANDBOOK.md', 'csharp/HANDBOOK.md']) {
    const md = readFileSync(path.join(ROOT, doc), 'utf8');
    const html = renderMarkdown(md, { routePath: `/doc/${doc}` });
    assert.ok(!/href="#[^/]/.test(html), `${doc} still has a bare #anchor`);
  }
});

test('a README link into content/modules/ opens the guide route, not a 404ing doc', () => {
  const html = renderMarkdown('[SQL](../content/modules/sql-fundamentals.md#joins)', { baseDir: '86-sqlite-orders' });
  assert.match(html, /href="#\/guide\/sql-fundamentals#joins"/);
  assert.equal(
    resolveHref('../../content/modules/http-fundamentals.md', { baseDir: 'react/03-key-prop' }),
    '#/guide/http-fundamentals',
  );
});

test('link titles and hrefs are attribute-escaped', () => {
  const html = renderMarkdown('[t](https://x.test/?a=1&b=2 "say \\"hi\\"")');
  assert.ok(html.includes('title="say &quot;hi&quot;"'), html);
  assert.ok(html.includes('href="https://x.test/?a=1&amp;b=2"'), html);
});
