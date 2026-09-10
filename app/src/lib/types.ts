/** Shapes emitted by scripts/build-content.mjs. Keep in sync with that file. */

export type TrackId = 'js' | 'ts' | 'react' | 'csharp';

export interface Track {
  id: TrackId;
  label: string;
  dir: string;
  color: string;
}

export interface SourceFile {
  path: string;
  bytes: number;
}

export interface Project {
  id: string;
  track: TrackId;
  number: number;
  slug: string;
  name: string;
  /** Repo-relative directory, e.g. "react/03-key-prop". */
  dir: string;
  title: string;
  blurb: string;
  docs: string[];
  sources: SourceFile[];
  hasTests: boolean;
}

export interface Guide {
  id: string;
  title: string;
  blurb: string;
  words: number;
  headings: string[];
}

/** Rough seniority the question is pitched at. */
export type QuestionLevel = 1 | 2 | 3;

export interface Question {
  id: string;
  q: string;
  code?: string;
  lang?: string;
  choices: string[];
  answer: number;
  why: string;
  tags?: string[];
  level: QuestionLevel;
  /** Why an interviewer asks this — shown after you answer. */
  asked?: string;
  /** Injected by the content build. */
  deck: string;
  topic: string;
}

export interface Deck {
  id: string;
  topic: string;
  title: string;
  blurb: string;
  questions: Question[];
}

export type Step =
  | { kind: 'read'; doc: string; anchor?: string; title: string; minutes: number }
  | { kind: 'guide'; guide: string; title: string; minutes: number }
  | { kind: 'build'; project: string; title: string; minutes: number }
  | { kind: 'drill'; deck: string; count: number; title: string };

export interface Module {
  id: string;
  title: string;
  why: string;
  interviewFocus?: string[];
  steps: Step[];
}

export interface Stage {
  id: string;
  level: number;
  title: string;
  tagline: string;
  goal: string;
  outcome: string;
  hours: number;
  modules: Module[];
}

export interface Roadmap {
  title: string;
  subtitle: string;
  targetRole: string;
  notOnThisPath: string;
  stages: Stage[];
}

export interface Stats {
  generatedAt: string;
  projects: number;
  decks: number;
  questions: number;
  guides: number;
  stages: number;
  modules: number;
  hours: number;
  tracks: Track[];
}

export interface SearchRow {
  kind: 'project' | 'deck' | 'module';
  id: string;
  title: string;
  sub: string;
  text: string;
}

export interface Content {
  roadmap: Roadmap;
  projects: Project[];
  decks: Deck[];
  guides: Guide[];
  stats: Stats;
  search: SearchRow[];
}

/** A stable id for one step, used as the progress key. */
export function stepKey(stageId: string, moduleId: string, index: number): string {
  return `${stageId}/${moduleId}/${index}`;
}
