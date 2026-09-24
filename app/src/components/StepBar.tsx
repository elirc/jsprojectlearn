import { Link, useSearchParams } from 'react-router-dom';
import { useContent } from '../lib/content-context.ts';
import { shortDate } from '../lib/format.ts';
import { useProgress } from '../lib/hooks.ts';
import { setStepsDone } from '../lib/progress.ts';
import { followingStep, stepByKey, stepHref, stepsForTarget } from '../lib/selectors.ts';
import type { NextStep, StepTarget } from '../lib/selectors.ts';
import type { Step } from '../lib/types.ts';

const MARK_LABEL: Record<Step['kind'], string> = {
  build: '✓ Mark build done',
  guide: '✓ Mark as read',
  read: '✓ Mark as read',
  drill: '✓ Mark drill done',
};

/**
 * The path steps a page stands for. A valid `?step=` (every in-app step link
 * carries one) wins; otherwise every step pointing at this page.
 */
export function usePathSteps(target: StepTarget | undefined): NextStep[] {
  const { roadmap } = useContent();
  const [params] = useSearchParams();
  const fromUrl = stepByKey(roadmap, params.get('step') ?? undefined);
  if (fromUrl) return [fromUrl];
  return target ? stepsForTarget(roadmap, target) : [];
}

const stepMeta = (step: Step): string =>
  step.kind === 'drill' ? `${step.count} questions` : `${step.minutes} min`;

/**
 * Close the loop: mark the path step done from the page where the work
 * happened, then go straight to the next one. With several matching steps (a
 * guide two modules share) it shows the first open one and marks them all.
 *
 * `end` is the quieter version for the bottom of a document.
 */
export default function StepBar({
  steps,
  variant = 'bar',
  eyebrow = 'On the path',
}: {
  steps: NextStep[];
  variant?: 'bar' | 'end';
  eyebrow?: string;
}) {
  const { roadmap } = useContent();
  const progress = useProgress();
  if (steps.length === 0) return null;

  const keys = steps.map((s) => s.key);
  const shown = steps.find((s) => !progress.steps[s.key]) ?? (steps[0] as NextStep);
  const done = keys.every((key) => progress.steps[key]);
  const following = done ? followingStep(roadmap, progress, shown.key) : undefined;

  const nextLink = following ? (
    <>
      <span className="stepbar-next">
        Next: {following.step.title} · {stepMeta(following.step)}
      </span>
      <Link className="btn primary sm" to={stepHref(following.step, following.key)}>
        Next →
      </Link>
    </>
  ) : (
    <>
      <span className="stepbar-next">That was the last step on the path.</span>
      <Link className="btn primary sm" to="/drill/mixed?mode=mock">
        Run a full mock →
      </Link>
    </>
  );

  if (variant === 'end') {
    const at = progress.steps[shown.key];
    return (
      <section className="doc-end" aria-label="Finish this step">
        {done ? (
          <div className="row center">
            <span className="good-text">✓ Read on {at ? shortDate(at) : 'an earlier day'}</span>
            {nextLink}
          </div>
        ) : (
          <>
            <p className="muted m-0">You've reached the end.</p>
            <button className="btn primary mt-2" onClick={() => setStepsDone(keys, true)}>
              {MARK_LABEL[shown.step.kind]}
            </button>
          </>
        )}
      </section>
    );
  }

  return (
    <section className={`stepbar${done ? ' done' : ''}`} aria-label="Path step">
      <div className="min-w-0">
        <div className="eyebrow">{eyebrow}</div>
        <div className="stepbar-context">
          Level {shown.stage.level} ·{' '}
          <Link to={`/path/${shown.stage.id}#${shown.module.id}`}>{shown.module.title}</Link> · step{' '}
          {shown.index + 1} of {shown.module.steps.length}
        </div>
      </div>
      {done ? (
        <div className="row" role="status">
          <strong className="good-text">✓ Step done.</strong>
          {nextLink}
          <button className="btn sm ghost" onClick={() => setStepsDone(keys, false)}>
            Undo
          </button>
        </div>
      ) : (
        <button className="btn primary" onClick={() => setStepsDone(keys, true)}>
          {MARK_LABEL[shown.step.kind]}
        </button>
      )}
    </section>
  );
}
