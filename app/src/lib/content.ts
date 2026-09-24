import type { Content, ContentIndex, Deck, Project } from './types.ts';

/**
 * Everything the app knows is generated into public/content/ by
 * scripts/build-content.mjs and fetched once on boot. Vite serves public/ at
 * the app base in dev and copies it into dist/ on build, so BASE_URL is the
 * one thing that has to be respected here.
 */
const BASE = import.meta.env?.BASE_URL ?? '/';

async function json<T>(name: string): Promise<T> {
  const res = await fetch(`${BASE}content/${name}.json`);
  if (!res.ok) {
    throw new Error(
      `Could not load ${name}.json (${res.status}). Run \`npm run content\` from the repo root.`,
    );
  }
  return (await res.json()) as T;
}

let cached: Promise<ContentIndex> | undefined;

export function loadContent(): Promise<ContentIndex> {
  cached ??= (async () => {
    const [roadmap, projects, decks, guides, stats, search] = await Promise.all([
      json<Content['roadmap']>('roadmap'),
      json<Content['projects']>('projects'),
      json<Content['decks']>('decks'),
      json<Content['guides']>('guides'),
      json<Content['stats']>('stats'),
      json<Content['search']>('search'),
    ]);
    return indexContent({ roadmap, projects, decks, guides, stats, search });
  })().catch((error: unknown) => {
    // Never cache a failure, or the Retry button could not work.
    cached = undefined;
    throw error;
  });
  return cached;
}

/** Raw markdown / source files copied alongside the index. */
export async function loadDoc(repoPath: string): Promise<string> {
  const res = await fetch(`${BASE}docs/${repoPath}`);
  if (!res.ok) throw new Error(`${repoPath} not found (${res.status})`);
  // A static host with an SPA fallback answers a missing file with index.html
  // and a 200. Rendering that as a document would be worse than a 404.
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('text/html') && !/\.html?$/i.test(repoPath)) {
    throw new Error(`${repoPath} not found (the server sent a web page instead)`);
  }
  return await res.text();
}

/** Derive the question list and the mixed deck once, not per screen. */
export function indexContent(content: Content): ContentIndex {
  const questions = content.decks.flatMap((d) => d.questions);
  return {
    ...content,
    questions,
    mixed: {
      id: 'mixed',
      topic: 'Mixed',
      title: 'Mixed — every topic',
      blurb:
        'Every question in the app, shuffled across all topics. This is the one that tells you whether you are ready.',
      questions,
    },
  };
}

/** A deck by id; `mixed` is every deck. Undefined for an unknown id. */
export function deckById(content: ContentIndex, id: string): Deck | undefined {
  if (id === 'mixed') return content.mixed;
  return content.decks.find((d) => d.id === id);
}

export const TRACK_LABEL: Record<string, string> = {
  js: 'JavaScript',
  ts: 'TypeScript',
  react: 'React',
  csharp: 'C# / .NET',
};

export const HANDBOOKS = [
  { doc: 'HANDBOOK.md', label: 'JavaScript', nav: 'JS handbook' },
  { doc: 'typescript/HANDBOOK.md', label: 'TypeScript', nav: 'TS handbook' },
  { doc: 'react/HANDBOOK.md', label: 'React', nav: 'React handbook' },
  { doc: 'csharp/HANDBOOK.md', label: 'C# / .NET', nav: 'C# handbook' },
] as const;

export interface RunCommand {
  label: string;
  /** A shell command, or for `open` a path to open in a browser. */
  cmd: string;
  kind: 'shell' | 'open';
}

/**
 * How to run a project, derived from the files it actually has rather than
 * guessed from the track: 22 JS projects are HTML pages, every TS original is
 * .ts, and four TS originals use enums or parameter properties that plain type
 * stripping rejects — so TS runs with --experimental-transform-types.
 * Paths are repo-relative; commands assume the repo root as the working dir.
 */
/**
 * Node 24 resolves a bare directory passed to --test as a module, not a
 * pattern, so the tests hint is a quoted glob (quotes matter on Windows).
 */
function testExt(project: Project): string {
  const test = project.sources.find((s) => /\.test\.(m?[jt]sx?)$/.test(s.path));
  return test?.path.match(/\.test\.(m?[jt]sx?)$/)?.[1] ?? 'js';
}

export function runCommands(project: Project): RunCommand[] {
  const files = new Set(project.sources.map((s) => s.path));
  const dir = project.dir;
  const out: RunCommand[] = [];

  if (files.has('original.js')) {
    out.push({ label: 'Run the original', cmd: `node ${dir}/original.js`, kind: 'shell' });
  } else if (files.has('original.ts')) {
    out.push({ label: 'Type-check the track', cmd: 'npx tsc -p typescript', kind: 'shell' });
    out.push({
      label: 'Run the original',
      cmd: `node --experimental-transform-types ${dir}/original.ts`,
      kind: 'shell',
    });
  } else if (files.has('original.html')) {
    out.push({ label: 'Open in a browser', cmd: `${dir}/original.html`, kind: 'open' });
  }

  if (project.track === 'csharp') {
    out.push({ label: 'Run the refactor', cmd: `dotnet run --project ${dir}/refactored`, kind: 'shell' });
  }

  if (project.hasTests) {
    out.push(
      project.track === 'csharp'
        ? { label: 'Run the tests', cmd: `dotnet run --project ${dir}/refactored -- test`, kind: 'shell' }
        : { label: 'Run the tests', cmd: `node --test "${dir}/**/*.test.${testExt(project)}"`, kind: 'shell' },
    );
  }
  return out;
}
