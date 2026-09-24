#!/usr/bin/env node
/**
 * Question-bank quality gate.
 *
 * The first bank shipped with a tell: in 91% of questions the correct choice
 * was the longest one, so a learner could score ~90% by always picking the
 * long option. These checks make that class of defect a build failure rather
 * than something a reviewer has to notice.
 *
 * Usage:
 *   node scripts/check-questions.mjs              # every deck
 *   node scripts/check-questions.mjs js-async ... # only these deck ids
 *   node scripts/check-questions.mjs --warn-only  # report, never exit non-zero
 *
 * Thresholds come from the adversarial review of the bank and are justified
 * there; the short version is that four random-length choices leave the
 * correct one strictly longest 25% of the time, so 40% is a real tell, not
 * sampling noise, even on a 20-question deck.
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'content', 'questions');

const LANGS = new Set(['js', 'ts', 'tsx', 'jsx', 'cs', 'sql', 'html', 'css', 'json', 'sh', 'yaml', 'txt', 'http']);
const STOP = new Set(
  'a an the of to in on for and or is are be do does what which how why when this that it its with as by from at into your you can not no'.split(' '),
);
const PHRASES = [/\bdifference between\b/g, /\bwhat is\b/g, /\bwhat does\b/g, /\blog\b/g];

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const pct = (n, d) => (d === 0 ? 0 : Math.round((n / d) * 100));

function tokens(text) {
  let t = text.toLowerCase().replace(/`/g, '');
  for (const p of PHRASES) t = t.replace(p, ' ');
  return new Set(
    t
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !STOP.has(w)),
  );
}

const overlap = (a, b) => {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / Math.min(a.size, b.size);
};
const jaccard = (a, b) => {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / (a.size + b.size - n);
};

export async function checkQuestions({ only = [], warnOnly = false, log = console.log } = {}) {
  const files = (await readdir(DIR)).filter((f) => f.endsWith('.json')).sort();
  const decks = [];
  for (const file of files) {
    const deck = JSON.parse(await readFile(path.join(DIR, file), 'utf8'));
    deck.file = file;
    decks.push(deck);
  }

  const fails = [];
  const warns = [];
  const fail = (m) => fails.push(m);
  const warn = (m) => warns.push(m);

  const prefixOwner = new Map();
  const selected = decks.filter((d) => only.length === 0 || only.includes(d.id));

  for (const deck of selected) {
    const qs = deck.questions;
    const tag = `[${deck.id}]`;
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(deck.id)) fail(`${tag} deck id is not kebab-case`);
    if (!deck.topic || !deck.title || !deck.blurb) fail(`${tag} deck needs topic, title, blurb`);
    if (qs.length < 20) warn(`${tag} only ${qs.length} questions (roadmap drills need ≥ 1.8× the draw)`);

    let strictlyLongest = 0;
    let ratioSum = 0;
    let withAsked = 0;
    const levels = { 1: 0, 2: 0, 3: 0 };
    const answerIndex = {};
    const tagCounts = new Map();
    let prefix;

    for (const q of qs) {
      const id = `${tag} ${q.id}`;

      // ---- identity
      const m = /^([a-z0-9]+)-(\d{3})$/.exec(q.id ?? '');
      if (!m) fail(`${id}: id must match ^[a-z0-9]+-\\d{3}$`);
      else {
        prefix ??= m[1];
        if (m[1] !== prefix) fail(`${id}: id prefix "${m[1]}" differs from deck prefix "${prefix}"`);
      }

      // ---- shape
      if (!q.q || typeof q.q !== 'string') fail(`${id}: missing stem`);
      if (!Array.isArray(q.choices) || q.choices.length !== 4) {
        fail(`${id}: needs exactly 4 choices`);
        continue;
      }
      const trimmed = q.choices.map((c) => String(c).trim());
      if (new Set(trimmed.map((c) => c.toLowerCase())).size !== 4) fail(`${id}: duplicate choices`);
      if (typeof q.answer !== 'number' || q.answer < 0 || q.answer > 3) {
        fail(`${id}: answer index out of range`);
        continue;
      }
      if (!q.why || q.why.length < 40) fail(`${id}: why is missing or too short`);
      if (![1, 2, 3].includes(q.level)) fail(`${id}: level must be 1, 2 or 3`);
      else levels[q.level]++;
      if (q.code && !LANGS.has(q.lang)) fail(`${id}: code needs a lang from ${[...LANGS].join('|')}`);
      if (q.code && q.code.split('\n').length > 10) warn(`${id}: code is ${q.code.split('\n').length} lines (keep ≤ 8)`);
      for (const field of ['why', 'asked', 'q']) {
        if (typeof q[field] === 'string' && q[field].includes('```')) {
          fail(`${id}: ${field} contains a code fence — put code in the \`code\` field`);
        }
      }
      if (q.why && q.why.length > 600) warn(`${id}: why is ${q.why.length} chars (keep ≤ 600)`);
      for (const c of trimmed) {
        if (/^(all|none|both) of the (above|these)/i.test(c) || /^both /i.test(c)) {
          fail(`${id}: "${c.slice(0, 30)}…" is a throwaway choice`);
        }
      }
      if (q.asked && q.asked.trim().length > 0) {
        withAsked++;
        if (q.asked.trim().length < 20) warn(`${id}: asked is shorter than 20 chars`);
        if (q.asked.trim() === q.why.trim()) warn(`${id}: asked duplicates why`);
      }
      if (q.tags) {
        if (!Array.isArray(q.tags) || q.tags.length < 1 || q.tags.length > 3) warn(`${id}: tags should be 1–3 entries`);
        for (const t of q.tags ?? []) {
          if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t)) fail(`${id}: tag "${t}" is not kebab-case`);
          tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
        }
      }
      answerIndex[q.answer] = (answerIndex[q.answer] ?? 0) + 1;

      // ---- the longest-choice tell
      const L = trimmed.map((c) => c.length);
      const correct = L[q.answer];
      const wrong = L.filter((_, i) => i !== q.answer);
      if (correct > Math.max(...wrong)) strictlyLongest++;
      const ratio = correct / median(wrong);
      ratioSum += correct / mean(wrong);
      if (ratio > 2.0) fail(`${id}: correct choice is ${ratio.toFixed(1)}× the median wrong one (fail > 2.0)`);
      else if (ratio > 1.5) warn(`${id}: correct choice is ${ratio.toFixed(1)}× the median wrong one (warn > 1.5)`);
    }

    if (prefix) {
      if (prefixOwner.has(prefix) && prefixOwner.get(prefix) !== deck.id) {
        fail(`${tag} id prefix "${prefix}" is also used by ${prefixOwner.get(prefix)}`);
      }
      prefixOwner.set(prefix, deck.id);
    }

    const n = qs.length;
    const longestPct = pct(strictlyLongest, n);
    if (longestPct > 40) fail(`${tag} correct choice is strictly longest in ${longestPct}% of questions (fail > 40%)`);
    else if (longestPct > 35) warn(`${tag} correct choice is strictly longest in ${longestPct}% (warn > 35%)`);
    const meanRatio = ratioSum / n;
    if (meanRatio > 1.3) warn(`${tag} mean correct/wrong length ratio ${meanRatio.toFixed(2)} (warn > 1.3)`);

    const askedPct = pct(withAsked, n);
    if (askedPct < 60) fail(`${tag} only ${askedPct}% of questions have \`asked\` (fail < 60%)`);
    else if (askedPct < 70) warn(`${tag} ${askedPct}% have \`asked\` (target ≥ 70%)`);

    for (const lvl of [1, 2, 3]) if (levels[lvl] === 0) fail(`${tag} no level-${lvl} questions`);
    const l1 = pct(levels[1], n), l2 = pct(levels[2], n), l3 = pct(levels[3], n);
    if (l1 < 25 || l1 > 50 || l2 < 35 || l2 > 65 || l3 < 10 || l3 > 30) {
      warn(`${tag} level split ${l1}/${l2}/${l3} is outside 25–50 / 35–65 / 10–30`);
    }
    if (levels[3] > levels[1]) warn(`${tag} more level-3 than level-1 questions`);

    for (const [i, c] of Object.entries(answerIndex)) {
      if (pct(c, n) > 60) warn(`${tag} ${pct(c, n)}% of answers sit at index ${i} (runtime shuffles, but vary it)`);
    }
    const singles = [...tagCounts.entries()].filter(([, c]) => c === 1).length;
    if (tagCounts.size && singles / tagCounts.size > 0.6) {
      warn(`${tag} ${singles}/${tagCounts.size} tags are used once — tag-filtered drills will be thin`);
    }
  }

  // ---- cross-deck duplicates (copy-paste, not concept overlap — that is a review job)
  const all = decks.flatMap((d) => d.questions.map((q) => ({ deck: d.id, q })));
  const norm = all.map(({ deck, q }) => {
    const stem = `${q.q ?? ''} ${q.code ?? ''}`;
    return {
      deck,
      id: q.id,
      stem: q.q,
      exact: stem.toLowerCase().replace(/`/g, '').replace(/[^a-z0-9]/g, ''),
      toks: tokens(stem),
      withAnswer: tokens(`${stem} ${q.choices?.[q.answer] ?? ''}`),
    };
  });
  for (let i = 0; i < norm.length; i++) {
    for (let j = i + 1; j < norm.length; j++) {
      const a = norm[i], b = norm[j];
      if (a.deck === b.deck) continue;
      if (only.length && !only.includes(a.deck) && !only.includes(b.deck)) continue;
      const pair = `${a.deck}/${a.id} ↔ ${b.deck}/${b.id}`;
      if (a.exact && a.exact === b.exact) {
        fail(`duplicate stem: ${pair}`);
        continue;
      }
      if (a.toks.size >= 5 && b.toks.size >= 5 && overlap(a.toks, b.toks) >= 0.9) {
        fail(`near-duplicate stem (overlap ≥ 0.9): ${pair}\n    "${a.stem}"\n    "${b.stem}"`);
      } else if (a.withAnswer.size >= 8 && b.withAnswer.size >= 8 && jaccard(a.withAnswer, b.withAnswer) >= 0.6) {
        warn(`possible same-fact pair (jaccard ≥ 0.6): ${pair}`);
      }
    }
  }

  const total = selected.reduce((s, d) => s + d.questions.length, 0);
  log(`checked ${selected.length} decks · ${total} questions · ${fails.length} fail · ${warns.length} warn`);
  for (const w of warns) log(`  warn  ${w}`);
  for (const f of fails) log(`  FAIL  ${f}`);
  return { fails, warns, ok: fails.length === 0 || warnOnly };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const warnOnly = args.includes('--warn-only');
  const only = args.filter((a) => !a.startsWith('--'));
  const { ok } = await checkQuestions({ only, warnOnly });
  process.exit(ok ? 0 : 1);
}
