#!/usr/bin/env node
/**
 * Content pipeline.
 *
 * The repo is the source of truth: project folders hold the code and the
 * markdown, `content/roadmap.json` holds the curriculum, `content/questions/`
 * holds the interview drill decks. Nothing in the app is hand-maintained.
 *
 * This script:
 *   1. discovers every project folder across the four tracks,
 *   2. copies their markdown + source files into app/public/docs/,
 *   3. merges the roadmap with the discovered projects (failing loudly on a
 *      roadmap step that points at a project that does not exist),
 *   4. bundles the question decks and checks every id is unique,
 *   5. writes a flat search index.
 *
 * Run: `npm run content` (also runs automatically before dev and build).
 */
import { readFile, writeFile, mkdir, readdir, stat, rm, cp, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stepTarget } from '../app/src/lib/types.ts';
import { headingIds, tableOfContents } from '../app/src/lib/markdown.ts';
import { checkQuestions } from './check-questions.mjs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'app', 'public', 'content');
const DOCS = path.join(ROOT, 'app', 'public', 'docs');

/** Directories that hold projects, and how to label what comes out of them. */
const TRACKS = [
  { id: 'js', label: 'JavaScript', dir: '.', color: '#f0c419' },
  { id: 'ts', label: 'TypeScript', dir: 'typescript', color: '#3b82f6' },
  { id: 'react', label: 'React', dir: 'react', color: '#22d3ee' },
  { id: 'csharp', label: 'C# / .NET', dir: 'csharp', color: '#a78bfa' },
];

/** File types worth shipping to the browser as readable source. */
const SOURCE_EXT = new Set([
  '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.cs', '.html', '.css',
  '.json', '.sql', '.csproj', '.yml', '.yaml', '.sh', '.http',
]);
const MAX_FILE_BYTES = 250000;
const PROJECT_DIR = /^(\d{2})-(.+)$/;

const titleCase = (slug) =>
  slug.replace(/-/g, ' ').replace(/\b([a-z])/g, (_, c) => c.toUpperCase());

// U+FE0F (the emoji variation selector) is matched on its own: inside the
// class it would combine with the preceding range's character.
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F}/gu;

/** Prefer the document's own H1 over a title guessed from the folder name. */
function headingOf(markdown, fallback) {
  const m = markdown.match(/^#\s+(.+)$/m);
  if (!m) return fallback;
  const cleaned = m[1]
    .replace(EMOJI, '')
    .replace(/^(Learning Guide|Practice)\s*:\s*/i, '')
    .trim();
  return cleaned || fallback;
}

/** First non-heading, non-blockquote paragraph — used as the card blurb. */
function blurbOf(markdown) {
  const body = markdown.replace(/^#.*$/m, '');
  for (const block of body.split(/\n{2,}/)) {
    const line = block.trim();
    if (!line) continue;
    if (/^[#>|\-*`]/.test(line)) continue;
    return line.replace(/[*_`[\]]/g, '').replace(/\s+/g, ' ').slice(0, 240);
  }
  return '';
}

async function listDirs(dir) {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

async function walkFiles(dir, base = dir, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'bin' || entry.name === 'obj') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkFiles(full, base, acc);
    else acc.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return acc;
}

async function discoverProjects() {
  const projects = [];
  for (const track of TRACKS) {
    const trackDir = path.join(ROOT, track.dir);
    for (const name of await listDirs(trackDir)) {
      const match = PROJECT_DIR.exec(name);
      if (!match) continue;
      const dir = path.join(trackDir, name);
      const relDir = path.relative(ROOT, dir).split(path.sep).join('/');
      const files = await walkFiles(dir);

      const readmePath = path.join(dir, 'README.md');
      const readme = existsSync(readmePath) ? await readFile(readmePath, 'utf8') : '';

      const docs = files.filter((f) => f.endsWith('.md'));
      const sources = [];
      for (const f of files) {
        if (f.endsWith('.md')) continue;
        if (!SOURCE_EXT.has(path.extname(f))) continue;
        const size = (await stat(path.join(dir, f))).size;
        if (size > MAX_FILE_BYTES) continue;
        sources.push({ path: f, bytes: size });
      }

      projects.push({
        id: `${track.id}/${name}`,
        track: track.id,
        number: Number(match[1]),
        slug: match[2],
        name,
        dir: relDir,
        title: headingOf(readme, titleCase(match[2])),
        blurb: blurbOf(readme),
        docs,
        sources: sources.sort((a, b) => a.path.localeCompare(b.path)),
        hasTests: files.some((f) => /\.test\.(js|ts|tsx)$/.test(f) || /Tests?\.cs$/.test(f)),
      });
    }
  }
  return projects;
}

/**
 * Docs are copied into a private staging folder and swapped in at the end,
 * so a dev server (or a second content build running at the same time) sees
 * the old tree or the new one — never a half-deleted one.
 */
async function copyDocs(projects) {
  const staging = `${DOCS}.staging-${process.pid}`;
  await rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  await mkdir(staging, { recursive: true });
  try {
    await copyDocsInto(staging, projects);
    await swapIn(staging, DOCS);
  } finally {
    await rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

async function swapIn(staging, target) {
  const old = `${target}.old-${process.pid}`;
  for (let attempt = 0; ; attempt++) {
    try {
      if (existsSync(target)) await rename(target, old);
      await rename(staging, target);
      break;
    } catch (error) {
      // Windows refuses renames while another process has a file open, and a
      // concurrent build may have just recreated the target. Retry briefly.
      if (attempt >= 20) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  await rm(old, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function copyDocsInto(DOCS, projects) {

  for (const project of projects) {
    const from = path.join(ROOT, project.dir);
    const to = path.join(DOCS, project.dir);
    const wanted = new Set([...project.docs, ...project.sources.map((s) => s.path)]);
    for (const rel of wanted) {
      const dest = path.join(to, rel);
      await mkdir(path.dirname(dest), { recursive: true });
      await cp(path.join(from, rel), dest);
    }
  }

  // Track-level references the app links to directly.
  for (const [rel, src] of trackReferences()) {
    const dest = path.join(DOCS, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await cp(src, dest);
  }

  // Standalone guides authored for the app live in content/modules/.
  const modulesDir = path.join(ROOT, 'content', 'modules');
  if (existsSync(modulesDir)) {
    await cp(modulesDir, path.join(DOCS, 'guides'), { recursive: true });
  }
}

/** Track-level reference docs: [path in the docs tree, source file]. */
function trackReferences() {
  const refs = [];
  for (const rel of ['HANDBOOK.md', 'QUIZ.md', 'README.md', 'START-HERE.md']) {
    for (const base of ['.', 'react', 'typescript', 'csharp']) {
      const src = path.join(ROOT, base, rel);
      if (existsSync(src)) refs.push([base === '.' ? rel : `${base}/${rel}`, src]);
    }
  }
  return refs;
}

/**
 * Every markdown file copyDocs ships, keyed by its path in the docs tree
 * (the same path a `read` step's `doc` and the /doc/ route use).
 */
async function markdownDocs(projects) {
  const docs = new Map();
  for (const project of projects) {
    for (const rel of project.docs) docs.set(`${project.dir}/${rel}`, path.join(ROOT, project.dir, rel));
  }
  for (const [rel, src] of trackReferences()) docs.set(rel, src);
  const modulesDir = path.join(ROOT, 'content', 'modules');
  if (existsSync(modulesDir)) {
    for (const rel of await walkFiles(modulesDir)) {
      if (rel.endsWith('.md')) docs.set(`guides/${rel}`, path.join(modulesDir, rel));
    }
  }
  return docs;
}

/** The markdown behind every `read` step that points at a shipped doc. */
async function readStepDocs(roadmap, projects) {
  const sources = await markdownDocs(projects);
  const out = new Map();
  for (const stage of roadmap.stages) {
    for (const mod of stage.modules) {
      for (const step of mod.steps) {
        if (step.kind !== 'read' || out.has(step.doc) || !sources.has(step.doc)) continue;
        out.set(step.doc, await readFile(sources.get(step.doc), 'utf8'));
      }
    }
  }
  return out;
}

async function loadQuestions() {
  const dir = path.join(ROOT, 'content', 'questions');
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const decks = [];
  const seen = new Map();

  for (const file of files) {
    const deck = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
    for (const q of deck.questions) {
      if (seen.has(q.id)) {
        throw new Error(`Duplicate question id "${q.id}" in ${file} and ${seen.get(q.id)}`);
      }
      seen.set(q.id, file);
      if (!Array.isArray(q.choices) || q.choices.length < 2) {
        throw new Error(`Question ${q.id} needs at least two choices`);
      }
      if (typeof q.answer !== 'number' || q.answer < 0 || q.answer >= q.choices.length) {
        throw new Error(`Question ${q.id} has an out-of-range answer index`);
      }
      if (!q.why) throw new Error(`Question ${q.id} has no explanation`);
      q.deck = deck.id;
      q.topic = deck.topic;
    }
    decks.push(deck);
  }
  return decks;
}

/**
 * Fails the build on a roadmap the app could not follow. Returns warnings
 * (things that work but are thin) for the caller to print.
 *
 * Step keys are `module/kind:target` (app/src/lib/types.ts), so a module id
 * used twice, or two steps in one module pointing at the same thing, would
 * make two steps share one tick.
 *
 * `docs` maps a docs-tree path to its markdown for every `read` step whose
 * doc is shipped; a `read` step outside it, or whose anchor is not a heading
 * id the app's renderer produces (the shared slugger in markdown.ts), fails.
 */
export function validateRoadmap(roadmap, projects, decks, guides, docs = new Map()) {
  const projectIds = new Set(projects.map((p) => p.id));
  // "mixed" is synthesised at runtime from every deck, so it has no file.
  const deckIds = new Set([...decks.map((d) => d.id), 'mixed']);
  const allQuestions = decks.flatMap((d) => d.questions);
  const problems = [];
  const warnings = [];
  const moduleHome = new Map();
  const idsOf = new Map();
  const anchorsOf = (doc) => {
    if (!idsOf.has(doc)) idsOf.set(doc, headingIds(docs.get(doc)));
    return idsOf.get(doc);
  };

  for (const stage of roadmap.stages) {
    for (const mod of stage.modules) {
      if (moduleHome.has(mod.id)) {
        problems.push(`module id "${mod.id}" is used in both ${moduleHome.get(mod.id)} and ${stage.id}`);
      } else {
        moduleHome.set(mod.id, stage.id);
      }
      const targets = new Set();
      for (const step of mod.steps) {
        const where = `${stage.id}/${mod.id}`;
        const key = `${step.kind}:${stepTarget(step)}`;
        if (targets.has(key)) problems.push(`${where}: two steps are both "${key}"`);
        targets.add(key);

        if (step.kind === 'build' && !projectIds.has(step.project)) {
          problems.push(`${where}: unknown project "${step.project}"`);
        }
        if (step.kind === 'guide' && !guides.has(step.guide)) {
          problems.push(`${where}: missing guide content/modules/${step.guide}.md`);
        }
        if (step.kind === 'read') {
          if (!docs.has(step.doc)) {
            problems.push(`${where}: read step points at "${step.doc}", which is not a shipped doc`);
          } else if (step.anchor && !(step.anchor.startsWith('#') && anchorsOf(step.doc).has(step.anchor.slice(1)))) {
            problems.push(`${where}: "${step.doc}${step.anchor}" is not a heading in that doc`);
          }
        }
        if (step.kind === 'drill') {
          if (!deckIds.has(step.deck)) {
            problems.push(`${where}: unknown deck "${step.deck}"`);
            continue;
          }
          if (!step.tags?.length) continue;
          const pool =
            step.deck === 'mixed' ? allQuestions : (decks.find((d) => d.id === step.deck)?.questions ?? []);
          for (const tag of step.tags) {
            if (!pool.some((q) => q.tags?.includes(tag))) {
              problems.push(`${where}: no question in "${step.deck}" carries the tag "${tag}"`);
            }
          }
          const matching = pool.filter((q) => q.tags?.some((t) => step.tags.includes(t))).length;
          if (matching < step.count) {
            problems.push(
              `${where}: drill asks for ${step.count} questions but only ${matching} in "${step.deck}" carry ${step.tags.join('/')}`,
            );
          } else if (matching < step.count * 1.8) {
            warnings.push(
              `${where}: only ${matching} questions for a ${step.count}-question tagged drill — every session will look the same`,
            );
          }
        }
      }
    }
  }
  if (problems.length) {
    throw new Error(`Roadmap problems:\n  - ${problems.join('\n  - ')}`);
  }
  return warnings;
}

function buildSearchIndex(projects, decks, roadmap) {
  const rows = [];
  for (const p of projects) {
    rows.push({
      kind: 'project',
      id: p.id,
      title: p.title,
      sub: `${p.track} · ${p.name}`,
      text: p.blurb,
    });
  }
  for (const d of decks) {
    rows.push({
      kind: 'deck',
      id: d.id,
      title: d.title,
      sub: `${d.questions.length} questions`,
      text: d.blurb ?? '',
    });
  }
  for (const stage of roadmap.stages) {
    for (const mod of stage.modules) {
      rows.push({
        kind: 'module',
        id: `${stage.id}/${mod.id}`,
        title: mod.title,
        sub: stage.title,
        text: [mod.why, ...(mod.interviewFocus ?? [])].join(' '),
      });
    }
  }
  return rows;
}

/** Authored long-form guides: content/modules/<id>.md, with their own metadata. */
async function loadGuides() {
  const dir = path.join(ROOT, 'content', 'modules');
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort();
  const guides = [];
  for (const file of files) {
    const md = await readFile(path.join(dir, file), 'utf8');
    const id = file.replace(/\.md$/, '');
    guides.push({
      id,
      title: headingOf(md, titleCase(id)),
      blurb: blurbOf(md),
      words: md.split(/\s+/).length,
      // H2 sections with the id the app's renderer gives them (one shared,
      // deduping slugger), so a search hit always lands on its heading.
      headings: tableOfContents(md),
    });
  }
  return guides;
}

async function main() {
  const projects = await discoverProjects();
  const decks = await loadQuestions();

  // The quality gate: no deck may ship with the "longest choice is correct" tell,
  // a wrong-shaped question, or a copy-pasted stem from another deck.
  const quality = await checkQuestions({ log: () => {} });
  for (const warning of quality.warns) console.warn(`content: warning: ${warning}`);
  if (quality.fails.length) {
    const list = quality.fails.map((f) => `  - ${f}`).join('\n');
    throw new Error(
      `question bank failed the quality gate (${quality.fails.length} problems):\n${list}\n` +
        '  Run node scripts/check-questions.mjs for the full report.',
    );
  }

  const guides = await loadGuides();
  const roadmap = JSON.parse(await readFile(path.join(ROOT, 'content', 'roadmap.json'), 'utf8'));

  const guideIds = new Set(guides.map((g) => g.id));
  const docs = await readStepDocs(roadmap, projects);
  for (const warning of validateRoadmap(roadmap, projects, decks, guideIds, docs)) {
    console.warn(`content: warning: ${warning}`);
  }
  await copyDocs(projects);
  await mkdir(OUT, { recursive: true });

  const questionCount = decks.reduce((n, d) => n + d.questions.length, 0);
  const stats = {
    generatedAt: new Date().toISOString(),
    projects: projects.length,
    decks: decks.length,
    questions: questionCount,
    guides: guides.length,
    stages: roadmap.stages.length,
    modules: roadmap.stages.reduce((n, s) => n + s.modules.length, 0),
    hours: roadmap.stages.reduce((n, s) => n + (s.hours ?? 0), 0),
    tracks: TRACKS,
  };

  await writeFile(path.join(OUT, 'projects.json'), JSON.stringify(projects));
  await writeFile(path.join(OUT, 'decks.json'), JSON.stringify(decks));
  await writeFile(path.join(OUT, 'guides.json'), JSON.stringify(guides));
  await writeFile(path.join(OUT, 'roadmap.json'), JSON.stringify(roadmap));
  await writeFile(
    path.join(OUT, 'search.json'),
    JSON.stringify(buildSearchIndex(projects, decks, roadmap)),
  );
  await writeFile(path.join(OUT, 'stats.json'), JSON.stringify(stats, null, 2));

  console.log(
    `content: ${stats.projects} projects · ${stats.modules} modules in ${stats.stages} stages · ` +
      `${stats.questions} questions in ${stats.decks} decks`,
  );
}

// The tests import validateRoadmap from here; only a direct run builds.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`\ncontent build failed: ${error.message}\n`);
    process.exit(1);
  });
}
