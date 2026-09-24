/**
 * A ~100-line syntax highlighter.
 *
 * Deliberately not highlight.js: the whole app ships four languages, and a
 * single pass over a combined regex is both smaller and easier to read than a
 * general-purpose grammar engine. It is approximate by design — good enough to
 * read code by, and it never crashes on input it doesn't understand.
 */

type Rule = { kind: string; re: string };

const COMMON: Rule[] = [
  { kind: 'comment', re: String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/` },
  { kind: 'str', re: String.raw`"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\`(?:\\.|[^\\\`])*\`` },
  { kind: 'num', re: String.raw`\b0[xX][0-9a-fA-F]+\b|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?[fmdLn]?\b` },
];

const KEYWORDS: Record<string, string[]> = {
  js: 'const let var function return if else for while do break continue new class extends super this typeof instanceof in of try catch finally throw switch case default async await yield delete void import export from as static get set null undefined true false'.split(' '),
  ts: 'const let var function return if else for while do break continue new class extends implements super this typeof instanceof in of try catch finally throw switch case default async await yield delete void import export from as satisfies keyof infer readonly type interface enum namespace declare abstract public private protected static get set null undefined true false never unknown any string number boolean object symbol bigint'.split(' '),
  cs: 'using namespace class struct record interface enum public private protected internal static readonly const virtual override abstract sealed partial new return if else for foreach in while do break continue switch case default try catch finally throw async await var this base null true false is as typeof nameof where get set init required global'.split(' '),
  sql: 'select from where join inner left right outer full on group by having order limit offset insert into values update set delete create table alter drop index primary key foreign references unique not null distinct as and or in exists between case when then else end union all count sum avg min max begin commit rollback transaction with returning'.split(' '),
  json: ['true', 'false', 'null'],
  html: [],
  css: [],
};

const ALIAS: Record<string, string> = {
  javascript: 'js',
  jsx: 'js',
  mjs: 'js',
  cjs: 'js',
  node: 'js',
  typescript: 'ts',
  tsx: 'ts',
  csharp: 'cs',
  'c#': 'cs',
  postgres: 'sql',
  psql: 'sql',
  bash: 'sh',
  shell: 'sh',
  console: 'sh',
  text: 'txt',
  http: 'txt',
  yaml: 'txt',
  yml: 'txt',
  dockerfile: 'sh',
};

const escapeHtml = (s: string): string =>
  s.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));

export function normaliseLang(raw = ''): string {
  const lang = raw.toLowerCase().trim();
  return ALIAS[lang] ?? lang;
}

export function highlight(code: string, rawLang = ''): string {
  const lang = normaliseLang(rawLang);

  if (lang === 'sh' || lang === 'txt' || lang === '') return escapeHtml(code);

  if (lang === 'html') return highlightMarkup(code);
  if (lang === 'css') return highlightCss(code);

  const keywords = KEYWORDS[lang] ?? KEYWORDS.js ?? [];
  const rules: Rule[] = [...COMMON];
  if (lang === 'sql') {
    // SQL uses -- for comments and single quotes for strings only.
    rules[0] = { kind: 'comment', re: String.raw`--[^\n]*|\/\*[\s\S]*?\*\/` };
  }
  if (lang === 'cs' || lang === 'ts' || lang === 'js') {
    rules.push({ kind: 'type', re: String.raw`\b[A-Z][A-Za-z0-9_]*\b` });
  }
  if (keywords.length) {
    rules.unshift({ kind: 'kw', re: `\\b(?:${keywords.join('|')})\\b` });
  }
  rules.push({ kind: 'fn', re: String.raw`\b[a-zA-Z_$][\w$]*(?=\s*\()` });

  const combined = new RegExp(
    rules.map((r, i) => `(?<g${i}>${r.re})`).join('|'),
    lang === 'sql' ? 'gi' : 'g',
  );

  let out = '';
  let last = 0;
  for (const match of code.matchAll(combined)) {
    const index = match.index ?? 0;
    out += escapeHtml(code.slice(last, index));
    const groups = match.groups ?? {};
    const hit = rules.findIndex((_, i) => groups[`g${i}`] !== undefined);
    const kind = rules[hit]?.kind ?? 'txt';
    out += `<span class="tok-${kind}">${escapeHtml(match[0])}</span>`;
    last = index + match[0].length;
  }
  out += escapeHtml(code.slice(last));
  return out;
}

/**
 * HTML gets its own single pass over the RAW source: comments, tag names and
 * attribute/value pairs. Matching against already-escaped (or already
 * highlighted) text is how the old version ended up wrapping its own
 * `class="tok-kw"` attributes in spans.
 */
const MARKUP = /(?<comment><!--[\s\S]*?-->)|(?<open><\/?)(?<tag>[a-zA-Z][\w-]*)|(?<attr>[a-zA-Z_:][\w:.-]*)=(?<value>"[^"]*"|'[^']*')/g;

function highlightMarkup(code: string): string {
  let out = '';
  let last = 0;
  for (const match of code.matchAll(MARKUP)) {
    const index = match.index ?? 0;
    const g = match.groups ?? {};
    out += escapeHtml(code.slice(last, index));
    if (g['comment'] !== undefined) {
      out += `<span class="tok-comment">${escapeHtml(g['comment'])}</span>`;
    } else if (g['tag'] !== undefined) {
      out += `${escapeHtml(g['open'] ?? '')}<span class="tok-kw">${escapeHtml(g['tag'])}</span>`;
    } else {
      out +=
        `<span class="tok-fn">${escapeHtml(g['attr'] ?? '')}</span>=` +
        `<span class="tok-str">${escapeHtml(g['value'] ?? '')}</span>`;
    }
    last = index + match[0].length;
  }
  return out + escapeHtml(code.slice(last));
}

/**
 * CSS: comments, at-rules, selectors (text before a `{`), property names (a
 * word followed by `:` and a value that ends in `;` or `}` — which is what
 * tells `color: red;` apart from `a:hover {`), strings, colours and numbers
 * with units. Selectors are "type", properties "fn", values "num".
 */
const CSS_RULES: Rule[] = [
  { kind: 'comment', re: String.raw`\/\*[\s\S]*?\*\/` },
  { kind: 'str', re: String.raw`"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'` },
  { kind: 'kw', re: String.raw`@[a-zA-Z-]+|!important` },
  { kind: 'type', re: String.raw`[^{};\s(@\/][^{};\/]*?(?=\s*\{)` },
  { kind: 'fn', re: String.raw`-{0,2}[a-zA-Z][\w-]*(?=\s*:[^{};]*[;}])` },
  {
    kind: 'num',
    re: String.raw`#[0-9a-fA-F]{3,8}\b|-?\b\d*\.?\d+(?:px|r?em|%|vh|vw|vmin|vmax|ch|fr|ms|s|deg)?`,
  },
];
const CSS = new RegExp(CSS_RULES.map((r, i) => `(?<g${i}>${r.re})`).join('|'), 'g');

function highlightCss(code: string): string {
  let out = '';
  let last = 0;
  for (const match of code.matchAll(CSS)) {
    const index = match.index ?? 0;
    const groups = match.groups ?? {};
    const hit = CSS_RULES.findIndex((_, i) => groups[`g${i}`] !== undefined);
    out += escapeHtml(code.slice(last, index));
    out += `<span class="tok-${CSS_RULES[hit]?.kind ?? 'txt'}">${escapeHtml(match[0])}</span>`;
    last = index + match[0].length;
  }
  return out + escapeHtml(code.slice(last));
}
