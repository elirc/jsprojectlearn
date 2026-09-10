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
    const flags = lang === 'sql' ? '' : '';
    rules.unshift({ kind: 'kw', re: `\\b(?:${keywords.join('|')})\\b${flags}` });
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

function highlightMarkup(code: string): string {
  return escapeHtml(code)
    .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="tok-comment">$1</span>')
    .replace(
      /(&lt;\/?)([a-zA-Z][\w-]*)/g,
      (_, open: string, tag: string) => `${open}<span class="tok-kw">${tag}</span>`,
    )
    .replace(
      /([a-zA-Z-]+)=(&quot;|")((?:[^"&]|&(?!quot;))*)(&quot;|")/g,
      (_, attr: string, q1: string, val: string, q2: string) =>
        `<span class="tok-fn">${attr}</span>=<span class="tok-str">${q1}${val}${q2}</span>`,
    );
}
