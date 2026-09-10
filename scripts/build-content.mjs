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
import { readFile, writeFile, mkdir, readdir, stat, rm, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu;

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

async function copyDocs(projects) {
  await rm(DOCS, { recursive: true, force: true });
  await mkdir(DOCS, { recursive: true });

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
  for (const rel of ['HANDBOOK.md', 'QUIZ.md', 'README.md', 'START-HERE.md']) {
    for (const base of ['.', 'react', 'typescript', 'csharp']) {
      const src = path.join(ROOT, base, rel);
      if (!existsSync(src)) continue;
      const dest = path.join(DOCS, base === '.' ? rel : `${base}/${rel}`);
      await mkdir(path.dirname(dest), { recursive: true });
      await cp(src, dest);
    }
  }

  // Standalone guides authored for the app live in content/modules/.
  const modulesDir = path.join(ROOT, 'content', 'modules');
  if (existsSync(modulesDir)) {
    await cp(modulesDir, path.join(DOCS, 'guides'), { recursive: true });
  }
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

function validateRoadmap(roadmap, projects, decks, guides) {
  const projectIds = new Set(projects.map((p) => p.id));
  // "mixed" is synthesised at runtime from every deck, so it has no file.
  const deckIds = new Set([...decks.map((d) => d.id), 'mixed']);
  const problems = [];

  for (const stage of roadmap.stages) {
    for (const mod of stage.modules) {
      for (const step of mod.steps) {
        if (step.kind === 'build' && !projectIds.has(step.project)) {
          problems.push(`${stage.id}/${mod.id}: unknown project "${step.project}"`);
        }
        if (step.kind === 'drill' && !deckIds.has(step.deck)) {
          problems.push(`${stage.id}/${mod.id}: unknown deck "${step.deck}"`);
        }
        if (step.kind === 'guide' && !guides.has(step.guide)) {
          problems.push(`${stage.id}/${mod.id}: missing guide content/modules/${step.guide}.md`);
        }
      }
    }
  }
  if (problems.length) {
    throw new Error(
      `Roadmap references content that does not exist:\n  - ${problems.join('\n  - ')}`,
    );
  }
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
      headings: [...md.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim()),
    });
  }
  return guides;
}

async function main() {
  const projects = await discoverProjects();
  const decks = await loadQuestions();
  const guides = await loadGuides();
  const roadmap = JSON.parse(await readFile(path.join(ROOT, 'content', 'roadmap.json'), 'utf8'));

  validateRoadmap(roadmap, projects, decks, new Set(guides.map((g) => g.id)));
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

main().catch((error) => {
  console.error(`\ncontent build failed: ${error.message}\n`);
  process.exit(1);
});
