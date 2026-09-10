import type { ProgressState } from './progress.ts';
import type { Module, Roadmap, Stage, Step } from './types.ts';
import { stepKey } from './types.ts';

export interface Completion {
  done: number;
  total: number;
  ratio: number;
}

const ratio = (done: number, total: number): number => (total === 0 ? 0 : done / total);

export function moduleCompletion(
  stage: Stage,
  mod: Module,
  progress: ProgressState,
): Completion {
  const done = mod.steps.filter((_, i) => progress.steps[stepKey(stage.id, mod.id, i)]).length;
  return { done, total: mod.steps.length, ratio: ratio(done, mod.steps.length) };
}

export function stageCompletion(stage: Stage, progress: ProgressState): Completion {
  let done = 0;
  let total = 0;
  for (const mod of stage.modules) {
    const c = moduleCompletion(stage, mod, progress);
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
  index: number;
  key: string;
}

/** The first incomplete step in roadmap order — the app's single "do this now". */
export function nextStep(roadmap: Roadmap, progress: ProgressState): NextStep | undefined {
  for (const stage of roadmap.stages) {
    for (const mod of stage.modules) {
      for (const [index, step] of mod.steps.entries()) {
        const key = stepKey(stage.id, mod.id, index);
        if (!progress.steps[key]) return { stage, module: mod, step, index, key };
      }
    }
  }
  return undefined;
}

/** Minutes of reading/building left, ignoring drills (which are open-ended). */
export function remainingMinutes(roadmap: Roadmap, progress: ProgressState): number {
  let minutes = 0;
  for (const stage of roadmap.stages) {
    for (const mod of stage.modules) {
      for (const [index, step] of mod.steps.entries()) {
        if (progress.steps[stepKey(stage.id, mod.id, index)]) continue;
        if (step.kind === 'drill') minutes += step.count * 0.75;
        else minutes += step.minutes;
      }
    }
  }
  return Math.round(minutes);
}

/** Where a step should link to. */
export function stepHref(step: Step): string {
  switch (step.kind) {
    case 'build':
      return `#/project/${step.project}`;
    case 'guide':
      return `#/guide/${step.guide}`;
    case 'drill':
      return `#/drill/${step.deck}?count=${step.count}`;
    case 'read':
      return `#/doc/${step.doc}${step.anchor ?? ''}`;
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
