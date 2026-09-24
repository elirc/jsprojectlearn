import { useEffect, useEffectEvent, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useProgress } from '../lib/hooks.ts';
import { setNote, setStepDone } from '../lib/progress.ts';
import {
  moduleCompletion,
  nextStep,
  stageCompletion,
  stepHref,
  STEP_GLYPH,
  STEP_LABEL,
} from '../lib/selectors.ts';
import type { Module, Stage, Step } from '../lib/types.ts';
import { stepKey } from '../lib/types.ts';
import { useContent } from '../lib/content-context.ts';
import ProgressBar from '../components/ProgressBar.tsx';

const scrollToId = (id: string) => {
  // jsdom and very old browsers have no scrollIntoView; the page still works.
  document.getElementById(id)?.scrollIntoView?.({ block: 'start' });
};

export default function Path() {
  const content = useContent();
  const { stageId } = useParams();
  const location = useLocation();
  const progress = useProgress();
  const stages = content.roadmap.stages;
  const known = !stageId || stages.some((s) => s.id === stageId);

  // The URL chooses which stage is open when you arrive; after that the
  // accordion is yours. (Deriving "open" from the URL on every render is what
  // made every other stage unopenable on /path/:stageId.)
  const [openId, setOpenId] = useState<string | undefined>(
    () => stageId ?? nextStep(content.roadmap, progress)?.stage.id ?? stages[0]?.id,
  );
  const [seenParam, setSeenParam] = useState(stageId);
  if (stageId !== seenParam) {
    setSeenParam(stageId);
    if (stageId) setOpenId(stageId);
  }

  // A deep link to level 6 should not open it off-screen; a #module hash
  // (from search) lands on the module once its stage is open.
  useEffect(() => {
    const hash = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (hash) scrollToId(hash);
    else if (stageId) scrollToId(stageId);
  }, [stageId, location.hash]);

  return (
    <div className="page stack stack-4">
      <header className="page-head">
        <div className="eyebrow">
          {content.stats.modules} modules · ~{content.stats.hours} hours
        </div>
        <h1>The path</h1>
        <p className="lede">
          The levels, in order. Each module tells you why it exists and what an interviewer will
          ask about it. Tick steps off as you finish them — everything is stored in this browser.
        </p>
      </header>

      {!known && (
        <div className="banner" role="status">
          There is no stage called “{stageId}”. Here is the whole path instead.
        </div>
      )}

      {stages.map((stage) => (
        <StageCard
          key={stage.id}
          stage={stage}
          open={openId === stage.id}
          onToggle={() => setOpenId((current) => (current === stage.id ? undefined : stage.id))}
        />
      ))}

      <section className="banner">
        <strong>What this path deliberately skips.</strong>
        <p className="mt-1 m-0">{content.roadmap.notOnThisPath}</p>
      </section>
    </div>
  );
}

function StageCard({
  stage,
  open,
  onToggle,
}: {
  stage: Stage;
  open: boolean;
  onToggle: () => void;
}) {
  const progress = useProgress();
  const completion = stageCompletion(stage, progress);
  const complete = completion.total > 0 && completion.done === completion.total;
  const bodyId = `${stage.id}-body`;

  return (
    <section className={`stage-card${complete ? ' done' : ''}`} id={stage.id}>
      {/* The heading holds a real button (headings inside buttons are
          invisible to heading navigation); CSS stretches the button over the
          whole head so the click target is unchanged. */}
      <div className="stage-head">
        <span className="level-badge" aria-hidden="true">
          <b>{complete ? '✓' : stage.level}</b>
          <span>level</span>
        </span>
        <span className="min-w-0">
          <h2>
            <button
              className="stage-toggle"
              onClick={onToggle}
              aria-expanded={open}
              aria-controls={bodyId}
            >
              <span className="sr-only">Level {stage.level}: </span>
              {stage.title}
            </button>
          </h2>
          <span className="faint">{stage.tagline}</span>
          <ProgressBar percent={Math.round(completion.ratio * 100)} good={complete} label={`${stage.title} progress`} className="stage-bar" />
        </span>
        <span className="faint ta-right">
          {completion.done}/{completion.total}
          <br />~{stage.hours}h
        </span>
      </div>

      {open && (
        <div className="stage-body" id={bodyId}>
          <div className="focus-box mt-3">
            <div className="eyebrow">Goal</div>
            <p className="stage-goal">{stage.goal}</p>
            <div className="eyebrow">You're done when</div>
            <p className="stage-goal muted m-0">{stage.outcome}</p>
          </div>

          {stage.modules.map((mod) => (
            <ModuleBlock key={mod.id} module={mod} />
          ))}
        </div>
      )}
    </section>
  );
}

function ModuleBlock({ module: mod }: { module: Module }) {
  const progress = useProgress();
  const completion = moduleCompletion(mod, progress);
  const noteKey = mod.id;
  const [noteOpen, setNoteOpen] = useState(false);
  const note = progress.notes[noteKey] ?? '';

  return (
    <div className="module" id={mod.id}>
      <div className="spread">
        <h3>{mod.title}</h3>
        <span className={`pill ${completion.ratio === 1 ? 'good' : ''}`}>
          {completion.done}/{completion.total}
        </span>
      </div>
      <p className="module-why">{mod.why}</p>

      {mod.interviewFocus && (
        <div className="focus-box">
          <div className="eyebrow">Interviewers ask</div>
          <ul>
            {mod.interviewFocus.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-2">
        {mod.steps.map((step) => {
          const key = stepKey(mod.id, step);
          return <StepRow key={key} step={step} stepId={key} done={Boolean(progress.steps[key])} />;
        })}
      </div>

      <div className="row mt-2">
        <button className="btn sm ghost" onClick={() => setNoteOpen((v) => !v)} aria-expanded={noteOpen}>
          {note ? '📝 Notes' : '+ Add a note'}
        </button>
        {note && !noteOpen && (
          <span className="faint flex-1 min-w-0">
            {note.slice(0, 90)}
            {note.length > 90 ? '…' : ''}
          </span>
        )}
      </div>
      {noteOpen && <NoteEditor noteKey={noteKey} initial={note} label={`Notes for ${mod.title}`} />}
    </div>
  );
}

/**
 * Saves on a short debounce, on blur and on unmount — saving on blur alone
 * lost anything typed before a keyboard shortcut navigated away.
 */
function NoteEditor({ noteKey, initial, label }: { noteKey: string; initial: string; label: string }) {
  const [text, setText] = useState(initial);

  useEffect(() => {
    const id = setTimeout(() => setNote(noteKey, text), 500);
    return () => clearTimeout(id);
  }, [noteKey, text]);

  const flush = useEffectEvent(() => setNote(noteKey, text));
  useEffect(() => () => flush(), []);

  return (
    <textarea
      className="mt-2"
      aria-label={label}
      placeholder="What clicked, what didn't, what to revisit…"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => setNote(noteKey, text)}
    />
  );
}

function StepRow({
  step,
  stepId,
  done,
}: {
  step: Step;
  stepId: string;
  done: boolean;
}) {
  const content = useContent();
  const meta = step.kind === 'drill' ? `${step.count} questions` : `${step.minutes} min`;
  const project =
    step.kind === 'build' ? content.projects.find((p) => p.id === step.project) : undefined;

  return (
    <div className={`step${done ? ' done' : ''}`}>
      <button
        className={`step-check${done ? ' on' : ''}`}
        role="checkbox"
        aria-checked={done}
        aria-label={step.title}
        onClick={() => setStepDone(stepId, !done)}
      >
        <span aria-hidden="true">✓</span>
      </button>
      <div className="step-title">
        <Link to={stepHref(step, stepId)}>{step.title}</Link>
        {project?.hasTests && <span className="faint ml-2">has tests</span>}
      </div>
      <div className="step-meta">
        <span className="pill">
          <span aria-hidden="true">{STEP_GLYPH[step.kind]}</span> {STEP_LABEL[step.kind]}
        </span>
        <span>{meta}</span>
      </div>
    </div>
  );
}
