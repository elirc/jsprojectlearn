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
  /** H2 sections, with the heading id the renderer produces. */
  headings: { id: string; text: string }[];
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
  | {
      kind: 'drill';
      deck: string;
      count: number;
      title: string;
      /** Narrow the deck to questions carrying any of these tags. */
      tags?: string[];
    };

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
  kind: 'project' | 'deck' | 'module' | 'page' | 'stage' | 'guide' | 'heading';
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

/** Content plus what every screen derives from it, computed once on load. */
export interface ContentIndex extends Content {
  /** Every question in every deck. */
  questions: Question[];
  /** The synthetic all-decks deck behind /drill/mixed. */
  mixed: Deck;
}

/**
 * What a step points at. A tagged drill is a different step from the same
 * deck untagged, so its tags are part of the target (in authored order).
 */
export function stepTarget(step: Step): string {
  switch (step.kind) {
    case 'build':
      return step.project;
    case 'guide':
      return step.guide;
    case 'drill':
      return step.tags?.length ? `${step.deck}|${step.tags.join(',')}` : step.deck;
    case 'read':
      // The anchor already carries its '#'.
      return `${step.doc}${step.anchor ?? ''}`;
  }
}

/**
 * The progress key for one step: `module/kind:target`, e.g.
 * `m-values/build:js/01-fizzbuzz`. Derived from what the step points at, not
 * its position, so inserting a step never moves anyone's ticks. Module ids are
 * globally unique and kind:target is unique within a module (build-content
 * fails the build otherwise).
 */
export function stepKey(moduleId: string, step: Step): string {
  return `${moduleId}/${step.kind}:${stepTarget(step)}`;
}
