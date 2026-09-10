import type { Content, Deck, Project, Question } from './types.ts';

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

let cached: Promise<Content> | undefined;

export function loadContent(): Promise<Content> {
  cached ??= (async () => {
    const [roadmap, projects, decks, guides, stats, search] = await Promise.all([
      json<Content['roadmap']>('roadmap'),
      json<Content['projects']>('projects'),
      json<Content['decks']>('decks'),
      json<Content['guides']>('guides'),
      json<Content['stats']>('stats'),
      json<Content['search']>('search'),
    ]);
    return { roadmap, projects, decks, guides, stats, search };
  })();
  return cached;
}

/** Raw markdown / source files copied alongside the index. */
export async function loadDoc(repoPath: string): Promise<string> {
  const res = await fetch(`${BASE}docs/${repoPath}`);
  if (!res.ok) throw new Error(`${repoPath} not found (${res.status})`);
  return await res.text();
}

export function projectById(content: Content, id: string): Project | undefined {
  return content.projects.find((p) => p.id === id);
}

export function deckById(content: Content, id: string): Deck | undefined {
  if (id === 'mixed') return mixedDeck(content);
  return content.decks.find((d) => d.id === id);
}

/** The "everything" deck used by the final mock-interview drill. */
export function mixedDeck(content: Content): Deck {
  return {
    id: 'mixed',
    topic: 'Mixed',
    title: 'Full mock — every topic',
    blurb:
      'Every question in the app, shuffled across all topics. This is the one that tells you whether you are ready.',
    questions: content.decks.flatMap((d) => d.questions),
  };
}

export function allQuestions(content: Content): Question[] {
  return content.decks.flatMap((d) => d.questions);
}

export const TRACK_LABEL: Record<string, string> = {
  js: 'JavaScript',
  ts: 'TypeScript',
  react: 'React',
  csharp: 'C# / .NET',
};
