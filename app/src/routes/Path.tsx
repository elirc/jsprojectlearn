import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useProgress } from '../lib/hooks.ts';
import { setNote, setStepDone } from '../lib/progress.ts';
import {
  moduleCompletion,
  stageCompletion,
  stepHref,
  STEP_GLYPH,
  STEP_LABEL,
} from '../lib/selectors.ts';
import type { Content, Module, Stage, Step } from '../lib/types.ts';
import { stepKey } from '../lib/types.ts';

export default function Path({ content }: { content: Content }) {
  const { stageId } = useParams();
  const progress = useProgress();
  const [openId, setOpenId] = useState<string | undefined>(
    stageId ?? content.roadmap.stages[0]?.id,
  );

  // Deep-linking to /path/:stageId should open that stage even on a re-render.
  const activeId = stageId ?? openId;

  return (
    <div className="page stack stack-4">
      <header className="page-head">
        <div className="eyebrow">{content.stats.modules} modules · ~{content.stats.hours} hours</div>
        <h1>The path</h1>
        <p className="lede">
          Nine levels, in order. Each module tells you why it exists and what an interviewer will
          ask about it. Tick steps off as you finish them — everything is stored in this browser.
        </p>
      </header>

      {content.roadmap.stages.map((stage) => (
        <StageCard
          key={stage.id}
          stage={stage}
          content={content}
          progress={progress}
          open={activeId === stage.id}
          onToggle={() => setOpenId(activeId === stage.id ? undefined : stage.id)}
        />
      ))}
    </div>
  );
}

function StageCard({
  stage,
  content,
  progress,
  open,
  onToggle,
}: {
  stage: Stage;
  content: Content;
  progress: ReturnType<typeof useProgress>;
  open: boolean;
  onToggle: () => void;
}) {
  const completion = stageCompletion(stage, progress);
  const complete = completion.total > 0 && completion.done === completion.total;

  return (
    <section className={`stage-card${complete ? ' done' : ''}`} id={stage.id}>
      <button className="stage-head" onClick={onToggle} aria-expanded={open}>
        <span className="level-badge">
          <b>{complete ? '✓' : stage.level}</b>
          <span>level</span>
        </span>
        <span style={{ minWidth: 0 }}>
          <h2>{stage.title}</h2>
          <span className="faint">{stage.tagline}</span>
          <span className="bar" style={{ display: 'block', marginTop: 9, maxWidth: 320 }}>
            <i
              style={{ width: `${Math.round(completion.ratio * 100)}%` }}
              className={complete ? 'good' : ''}
            />
          </span>
        </span>
        <span className="faint" style={{ textAlign: 'right' }}>
          {completion.done}/{completion.total}
          <br />~{stage.hours}h
        </span>
      </button>

      {open && (
        <div className="stage-body">
          <div className="focus-box" style={{ marginTop: 16 }}>
            <div className="eyebrow">Goal</div>
            <p style={{ margin: '6px 0 10px', fontSize: 14.5 }}>{stage.goal}</p>
            <div className="eyebrow">You're done when</div>
            <p style={{ margin: '6px 0 0', fontSize: 14.5 }} className="muted">
              {stage.outcome}
            </p>
          </div>

          {stage.modules.map((mod) => (
            <ModuleBlock
              key={mod.id}
              stage={stage}
              module={mod}
              content={content}
              progress={progress}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ModuleBlock({
  stage,
  module: mod,
  content,
  progress,
}: {
  stage: Stage;
  module: Module;
  content: Content;
  progress: ReturnType<typeof useProgress>;
}) {
  const completion = moduleCompletion(stage, mod, progress);
  const noteKey = `${stage.id}/${mod.id}`;
  const [noteOpen, setNoteOpen] = useState(false);
  const note = progress.notes[noteKey] ?? '';

  return (
    <div className="module">
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

      <div style={{ marginTop: 10 }}>
        {mod.steps.map((step, index) => (
          <StepRow
            key={index}
            step={step}
            content={content}
            stepId={stepKey(stage.id, mod.id, index)}
            done={Boolean(progress.steps[stepKey(stage.id, mod.id, index)])}
          />
        ))}
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn sm ghost" onClick={() => setNoteOpen((v) => !v)}>
          {note ? '📝 Notes' : '+ Add a note'}
        </button>
        {note && !noteOpen && (
          <span className="faint" style={{ flex: 1, minWidth: 0 }}>
            {note.slice(0, 90)}
            {note.length > 90 ? '…' : ''}
          </span>
        )}
      </div>
      {noteOpen && (
        <textarea
          style={{ marginTop: 8 }}
          placeholder="What clicked, what didn't, what to revisit…"
          defaultValue={note}
          onBlur={(event) => setNote(noteKey, event.target.value)}
        />
      )}
    </div>
  );
}

function StepRow({
  step,
  stepId,
  done,
  content,
}: {
  step: Step;
  stepId: string;
  done: boolean;
  content: Content;
}) {
  const meta =
    step.kind === 'drill'
      ? `${step.count} questions`
      : `${step.minutes} min`;

  const project = step.kind === 'build' ? content.projects.find((p) => p.id === step.project) : undefined;

  return (
    <div className={`step${done ? ' done' : ''}`}>
      <button
        className={`step-check${done ? ' on' : ''}`}
        aria-label={done ? 'Mark not done' : 'Mark done'}
        onClick={() => setStepDone(stepId, !done)}
      >
        ✓
      </button>
      <div className="step-title">
        <a href={stepHref(step)}>{step.title}</a>
        {project?.hasTests && (
          <span className="faint" style={{ marginLeft: 8 }}>
            has tests
          </span>
        )}
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
