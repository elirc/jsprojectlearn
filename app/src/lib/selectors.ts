import type { ProgressState } from './progress.ts';
import type { Module, Roadmap, Stage, Step } from './types.ts';
import { stepKey } from './types.ts';

export interface Completion {
  done: number;
  total: number;
  ratio: number;
}

const ratio = (done: number, total: number): number => (total === 0 ? 0 : done / total);

export function moduleCompletion(mod: Module, progress: ProgressState): Completion {
  const done = mod.steps.filter((step) => progress.steps[stepKey(mod.id, step)]).length;
  return { done, total: mod.steps.length, ratio: ratio(done, mod.steps.length) };
}

export function stageCompletion(stage: Stage, progress: ProgressState): Completion {
  let done = 0;
  let total = 0;
  for (const mod of stage.modules) {
    const c = moduleCompletion(mod, progress);
    done += c.done;
    total += c.total;
  }
  return { done, total, ratio: ratio(done, total) };
}

export function overallCompletion(roadmap: Roadmap, progress: ProgressState): Completion {
  let done = 0;
  let total = 0;
  for (const stage of roadmap.stages) {
    const c = stageCompletion(stage, progress);
    done += c.done;
    total += c.total;
  }
  return { done, total, ratio: ratio(done, total) };
}

export interface NextStep {
  stage: Stage;
  module: Module;
  step: Step;
  /** Position in the module, for "step i of n" — never part of the key. */
  index: number;
  key: string;
}

/** Every step in roadmap order, with its key. */
export function allSteps(roadmap: Roadmap): NextStep[] {
  const out: NextStep[] = [];
  for (const stage of roadmap.stages) {
    for (const mod of stage.modules) {
      mod.steps.forEach((step, index) => {
        out.push({ stage, module: mod, step, index, key: stepKey(mod.id, step) });
      });
    }
  }
  return out;
}

/** The first incomplete step in roadmap order — the app's single "do this now". */
export function nextStep(roadmap: Roadmap, progress: ProgressState): NextStep | undefined {
  return allSteps(roadmap).find((s) => !progress.steps[s.key]);
}

/** The step a key names on the current roadmap, if it still exists. */
export function stepByKey(roadmap: Roadmap, key: string | undefined): NextStep | undefined {
  if (!key) return undefined;
  return allSteps(roadmap).find((s) => s.key === key);
}

export type StepTarget =
  | { kind: 'build'; project: string }
  | { kind: 'guide'; guide: string }
  | { kind: 'read'; doc: string; anchor?: string };

/**
 * Every step that points at a page, for a page opened without `?step=`.
 * Read steps match exactly: HANDBOOK.md#closures is not HANDBOOK.md. Drill
 * steps are never matched by target — a deck is drilled from many steps.
 */
export function stepsForTarget(roadmap: Roadmap, target: StepTarget): NextStep[] {
  return allSteps(roadmap).filter(({ step }) => {
    if (step.kind !== target.kind) return false;
    if (step.kind === 'build' && target.kind === 'build') return step.project === target.project;
    if (step.kind === 'guide' && target.kind === 'guide') return step.guide === target.guide;
    if (step.kind === 'read' && target.kind === 'read') {
      return step.doc === target.doc && (step.anchor ?? '') === (target.anchor ?? '');
    }
    return false;
  });
}

/** The first incomplete step after `key` in roadmap order ("Next →"). */
export function followingStep(roadmap: Roadmap, progress: ProgressState, key: string): NextStep | undefined {
  const steps = allSteps(roadmap);
  const at = steps.findIndex((s) => s.key === key);
  return steps.slice(at + 1).find((s) => !progress.steps[s.key] && s.key !== key);
}

/** Minutes of reading/building left, ignoring drills (which are open-ended). */
export function remainingMinutes(roadmap: Roadmap, progress: ProgressState): number {
  let minutes = 0;
  for (const { step, key } of allSteps(roadmap)) {
    if (progress.steps[key]) continue;
    minutes += step.kind === 'drill' ? step.count * 0.75 : step.minutes;
  }
  return Math.round(minutes);
}

/**
 * Where a step should link to, as a router path (use it with <Link to>).
 * With a key, the destination learns which path step it was opened for via
 * `?step=`. Keys contain '#', '/' and ':', so the value is always encoded; a
 * read step's anchor goes after the query so the doc still scrolls to it.
 */
export function stepHref(step: Step, key?: string): string {
  const stepParam = key ? `step=${encodeURIComponent(key)}` : '';
  const query = (...parts: string[]) => {
    const kept = parts.filter(Boolean);
    return kept.length ? `?${kept.join('&')}` : '';
  };
  switch (step.kind) {
    case 'build':
      return `/project/${step.project}${query(stepParam)}`;
    case 'guide':
      return `/guide/${step.guide}${query(stepParam)}`;
    case 'drill':
      return (
        `/drill/${step.deck}` +
        query(
          // The final mixed drill is the mock interview.
          step.deck === 'mixed' ? 'mode=mock' : '',
          `count=${step.count}`,
          step.tags?.length ? `tags=${encodeURIComponent(step.tags.join(','))}` : '',
          stepParam,
        )
      );
    case 'read':
      return `/doc/${step.doc}${query(stepParam)}${step.anchor ?? ''}`;
  }
}

export const STEP_GLYPH: Record<Step['kind'], string> = {
  read: '\u{1F4D6}',
  guide: '\u{1F9ED}',
  build: '\u{1F528}',
  drill: '⚡',
};

export const STEP_LABEL: Record<Step['kind'], string> = {
  read: 'Read',
  guide: 'Guide',
  build: 'Build',
  drill: 'Drill',
};
