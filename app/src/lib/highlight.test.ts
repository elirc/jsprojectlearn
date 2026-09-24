/**
 * Highlighter invariant: the output is the escaped input with well-formed
 * token spans around parts of it — nothing more, nothing less.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { highlight } from './highlight.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const escapeHtml = (s: string): string =>
  s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));

/** Strip well-formed token spans; what remains must be exactly the escaped input. */
function assertWellFormed(input: string, lang: string, where: string): void {
  const out = highlight(input, lang);
  assert.ok(!out.includes('<span <'), `${where}: a span inside a tag`);
  const stripped = out.replace(/<span class="tok-[a-z]+">|<\/span>/g, '');
  assert.equal(stripped, escapeHtml(input), `${where}: highlighter changed the text`);
  const opens = out.match(/<span class="tok-[a-z]+">/g)?.length ?? 0;
  const closes = out.match(/<\/span>/g)?.length ?? 0;
  assert.equal(opens, closes, `${where}: unbalanced spans`);
}

/** Every fenced block of `lang` in the real docs. */
function fences(lang: string): { code: string; where: string }[] {
  const files = ['HANDBOOK.md', 'typescript/HANDBOOK.md', 'react/HANDBOOK.md', 'csharp/HANDBOOK.md'];
  const guides = path.join(ROOT, 'content', 'modules');
  if (existsSync(guides)) files.push(...readdirSync(guides).filter((f) => f.endsWith('.md')).map((f) => `content/modules/${f}`));
  const out: { code: string; where: string }[] = [];
  const re = new RegExp('```' + lang + '\\s*\\n([\\s\\S]*?)```', 'g');
  for (const file of files) {
    const md = readFileSync(path.join(ROOT, file), 'utf8');
    for (const m of md.matchAll(re)) out.push({ code: m[1] ?? '', where: file });
  }
  return out;
}

/** Every question with code in `lang` across the real decks. */
function questionCode(lang: string): { code: string; where: string }[] {
  const dir = path.join(ROOT, 'content', 'questions');
  const out: { code: string; where: string }[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    let deck: { questions: { id: string; code?: string; lang?: string }[] };
    try {
      deck = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
    } catch {
      continue; // invalid JSON is the content build's job to report, not this test's
    }
    for (const q of deck.questions) {
      if (q.code && (q.lang ?? '').toLowerCase() === lang) out.push({ code: q.code, where: q.id });
    }
  }
  return out;
}

test('html highlighting does not wrap its own attributes in spans (regression)', () => {
  const input = `<div class="box" id='x'><!-- note --> a & b</div>`;
  assertWellFormed(input, 'html', 'fixture');
  const out = highlight(input, 'html');
  assert.ok(out.includes('<span class="tok-fn">id</span>=<span class="tok-str">\'x\'</span>'), out);
  assert.ok(out.includes('<span class="tok-comment">&lt;!-- note --&gt;</span>'), out);
});

test('html output is well-formed for every real html fence and question', () => {
  for (const { code, where } of [...fences('html'), ...questionCode('html')]) {
    assertWellFormed(code, 'html', where);
  }
});

test('every language stays well-formed on the real code in the docs and decks', () => {
  for (const lang of ['js', 'ts', 'cs', 'sql', 'css', 'json']) {
    for (const { code, where } of [...fences(lang), ...questionCode(lang)]) {
      assertWellFormed(code, lang, `${lang} ${where}`);
    }
  }
});

test('css gets its own rules: selectors, properties, values, comments, at-rules', () => {
  const css = '/* grid */\n@media (min-width: 40em) {\n  .card:hover > p { color: #fff; margin: 0 1.5rem !important; }\n}';
  assertWellFormed(css, 'css', 'css fixture');
  const out = highlight(css, 'css');
  assert.ok(out.includes('<span class="tok-comment">/* grid */</span>'), out);
  assert.ok(out.includes('<span class="tok-kw">@media</span>'), out);
  assert.ok(out.includes('<span class="tok-type">.card:hover &gt; p</span>'), 'selector');
  assert.ok(out.includes('<span class="tok-fn">color</span>'), 'property');
  assert.ok(out.includes('<span class="tok-num">#fff</span>'), 'colour');
  assert.ok(out.includes('<span class="tok-num">1.5rem</span>'), 'number with unit');
  assert.ok(out.includes('<span class="tok-kw">!important</span>'), out);
  // JS keywords must not leak into CSS.
  assert.ok(!/tok-kw">(?:const|return)/.test(highlight('.return { const: 1; }', 'css')));
});

test('keywords inside strings and comments are not marked', () => {
  const out = highlight('const s = "if else"; // return', 'js');
  assert.ok(out.includes('<span class="tok-str">"if else"</span>'), out);
  assert.ok(out.includes('<span class="tok-comment">// return</span>'), out);
});

test('SQL comments use -- and unknown languages fall back to JS rules', () => {
  assert.ok(highlight('select 1 -- note', 'sql').includes('<span class="tok-comment">-- note</span>'));
  assert.ok(highlight('const x = 1', 'klingon').includes('tok-kw'));
});
