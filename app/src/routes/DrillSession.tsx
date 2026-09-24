import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import CodeBlock from '../components/CodeBlock.tsx';
import Inline from '../components/Inline.tsx';
import StepBar from '../components/StepBar.tsx';
import { deckById } from '../lib/content.ts';
import { useContent } from '../lib/content-context.ts';
import { reduceMotion, useKey, useProgress } from '../lib/hooks.ts';
import { todayPlan } from '../lib/plan.ts';
import { gradeCard, recordSession, setStepDone, toggleSaved } from '../lib/progress.ts';
import { stepByKey } from '../lib/selectors.ts';
import type { NextStep } from '../lib/selectors.ts';
import { emptyReason, filterPool, parseDrillParams, selectDrill, shuffledChoices } from '../lib/session.ts';
import type { DrillSpec } from '../lib/session.ts';
import type { Deck, Question } from '../lib/types.ts';
import NotFound from './NotFound.tsx';
import ProgressBar from '../components/ProgressBar.tsx';
import Stat from '../components/Stat.tsx';

interface Answered {
  question: Question;
  /** Index into the shuffled choices, or -1 when the timer ran out. */
  chosen: number;
  picked?: string;
  correct: boolean;
  ms: number;
}

/** A mock is always timed; this is the clock when the timer is switched off. */
const MOCK_SECONDS = 45;

export default function DrillSession() {
  const content = useContent();
  const { deckId = 'mixed' } = useParams();
  const [params] = useSearchParams();
  const deck = useMemo(() => deckById(content, deckId), [content, deckId]);
  if (!deck) return <NotFound />;
  // App.tsx keys this route per navigation, so parsing once per mount is right.
  return <Session deck={deck} spec={parseDrillParams(params)} search={params.toString()} />;
}

/** What the header calls this session. */
function sessionTitle(deck: Deck, spec: DrillSpec): string {
  if (spec.mode === 'mock') return deck.id === 'mixed' ? 'Mock interview' : `Mock interview · ${deck.title}`;
  if (spec.mode === 'today') return "Today's drill";
  return deck.id === 'mixed' ? 'Mixed' : deck.title;
}

const MODE_PILL: Partial<Record<DrillSpec['mode'], string>> = {
  due: 'Due',
  new: 'New',
  missed: 'Missed',
  saved: 'Saved',
  mock: 'Mock · no hints',
};

function Session({ deck, spec, search }: { deck: Deck; spec: DrillSpec; search: string }) {
  const { roadmap } = useContent();
  const progress = useProgress();
  const navigate = useNavigate();
  const mock = spec.mode === 'mock';

  // The step this drill was opened from, if the key still names a drill step.
  const [pathStep] = useState<NextStep | undefined>(() => {
    const found = stepByKey(roadmap, spec.step);
    return found?.step.kind === 'drill' ? found : undefined;
  });

  // The question list is fixed when the session starts. Recomputing it as
  // answers land would reshuffle the deck under the user's feet.
  const [questions] = useState<Question[]>(() => {
    const now = Date.now();
    if (spec.mode !== 'today') return selectDrill(deck.questions, progress, spec, now);
    const pool = spec.topic || spec.tags ? filterPool(deck.questions, spec, 3) : deck.questions;
    return todayPlan(roadmap, pool, progress, now).queue;
  });

  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<number | undefined>(undefined);
  const [log, setLog] = useState<Answered[]>([]);
  const [startedAt] = useState(() => Date.now());
  const [endedAt, setEndedAt] = useState<number | undefined>(undefined);
  const [endedEarly, setEndedEarly] = useState(false);

  const logRef = useRef<Answered[]>([]);
  const recorded = useRef(false);
  const answeredIndex = useRef(-1);
  const questionStart = useRef(0);

  const question = questions[index];
  const finished = endedAt !== undefined;
  const seconds = mock ? progress.settings.seconds || MOCK_SECONDS : progress.settings.seconds;

  useEffect(() => {
    questionStart.current = Date.now();
  }, [index]);

  // Choice order is stable per question but different every time you see it.
  const layout = useMemo(
    () => (question ? shuffledChoices(question) : { choices: [], answer: 0 }),
    [question],
  );

  const record = (entries: Answered[], at: number) => {
    if (recorded.current || entries.length === 0) return;
    recorded.current = true;
    recordSession({
      at,
      deck: deck.id,
      asked: entries.length,
      correct: entries.filter((entry) => entry.correct).length,
      ms: at - startedAt,
      ...(mock ? { mode: 'mock' as const } : {}),
      ...(pathStep ? { step: pathStep.key } : {}),
    });
  };

  // Leaving mid-session still counts what was answered. StrictMode's dev
  // remount runs this with an empty log, so it is a no-op there. The cleanup
  // reads the latest `record` through a ref: effect events are only
  // documented to be callable from inside effects, not from their cleanups.
  const recordRef = useRef(record);
  useEffect(() => {
    recordRef.current = record;
  });
  useEffect(() => () => recordRef.current(logRef.current, Date.now()), []);

  const finish = (early: boolean) => {
    const at = Date.now();
    setEndedAt(at);
    setEndedEarly(early);
    record(logRef.current, at);
    // Finishing the drill a path step asked for completes that step. Ending
    // early doesn't: the step asked for a number of questions, not a visit.
    if (!early && pathStep?.step.kind === 'drill') {
      const needed = Math.min(pathStep.step.count, questions.length);
      if (logRef.current.length >= needed) setStepDone(pathStep.key, true);
    }
  };

  const answer = (choice: number) => {
    // One grade per question, whatever calls this (click, key, timer).
    if (!question || chosen !== undefined || answeredIndex.current === index) return;
    answeredIndex.current = index;
    const ms = Date.now() - questionStart.current;
    const correct = choice === layout.answer;
    setChosen(choice);
    gradeCard(question.id, correct, ms);
    const entry: Answered = { question, chosen: choice, picked: layout.choices[choice], correct, ms };
    logRef.current = [...logRef.current, entry];
    setLog(logRef.current);
  };

  const next = () => {
    if (index + 1 >= questions.length) finish(false);
    setChosen(undefined);
    setIndex((i) => i + 1);
  };

  // A mock gives no feedback, so there is nothing to read: move on by itself.
  const advance = useEffectEvent(next);
  useEffect(() => {
    if (!mock || chosen === undefined) return;
    const id = setTimeout(() => advance(), reduceMotion() ? 0 : 350);
    return () => clearTimeout(id);
  }, [mock, chosen]);

  const end = () => {
    if (logRef.current.length === 0) navigate('/drill');
    else finish(true);
  };

  useKey(['1', '2', '3', '4', '5', '6'], (key) => {
    const choice = Number(key) - 1;
    if (!finished && choice < layout.choices.length) answer(choice);
  });
  // Only listen for Enter/Space while there is a graded answer to move on
  // from: otherwise Space must still scroll a long question.
  useKey(chosen !== undefined && !mock && !finished ? ['Enter', ' '] : [], next);
  useKey(['s', 'S'], () => {
    if (!finished && question) toggleSaved(question.id);
  });

  const title = sessionTitle(deck, spec);

  if (questions.length === 0) {
    return <EmptyDrill deck={deck} spec={spec} maxLevel={progress.settings.maxLevel} />;
  }

  if (finished || !question) {
    return (
      <Summary
        deck={deck}
        title={title}
        spec={spec}
        log={log}
        elapsed={(endedAt ?? startedAt) - startedAt}
        search={search}
        pathStep={pathStep}
        early={endedEarly}
      />
    );
  }

  const answered = chosen !== undefined;
  const right = answered && chosen === layout.answer;
  const saved = Boolean(progress.saved[question.id]);

  return (
    <div className="page">
      <div className="drill">
        <div className="drill-title">
          <h2>{title}</h2>
          {spec.topic && <span className="pill">{spec.topic}</span>}
          {spec.tags?.map((tag) => (
            <span key={tag} className="pill">
              #{tag}
            </span>
          ))}
          {spec.level && <span className="pill">{'★'.repeat(spec.level)} only</span>}
          {MODE_PILL[spec.mode] && <span className="pill accent">{MODE_PILL[spec.mode]}</span>}
        </div>

        <div className="drill-top">
          <button className="btn sm ghost" onClick={end} title="Finish now and see results">
            End
          </button>
          <div className="drill-progress">
            <ProgressBar percent={(index / questions.length) * 100} label="Session progress" />
          </div>
          <span className="mono faint">
            {index + 1}/{questions.length}
          </span>
          <Countdown key={question.id} seconds={seconds} paused={answered} onExpire={() => answer(-1)} />
        </div>

        <div className="row mb-3">
          <span className="pill accent">{question.topic}</span>
          <span className="pill" aria-label={`Level ${question.level}`}>
            {'★'.repeat(question.level)}
          </span>
          {question.tags?.slice(0, 3).map((tag) => (
            <span key={tag} className="pill">
              {tag}
            </span>
          ))}
        </div>

        <Inline as="h2" className="question" id="drill-question" text={question.q} />

        {question.code && <CodeBlock code={question.code} lang={question.lang} />}

        <div className="choices" role="group" aria-labelledby="drill-question">
          {layout.choices.map((choice, i) => {
            let className = 'choice';
            let mark = '';
            if (answered && mock) {
              if (i === chosen) className += ' picked';
            } else if (answered) {
              if (i === layout.answer) {
                className += ' correct';
                mark = '✓';
              } else if (i === chosen) {
                className += ' wrong';
                mark = '✗';
              } else className += ' dim';
            }
            return (
              <button
                key={i}
                className={className}
                disabled={answered}
                aria-pressed={answered ? i === chosen : undefined}
                onClick={() => answer(i)}
              >
                <span className="key" aria-hidden="true">
                  {mark || i + 1}
                </span>
                <span>
                  <Inline text={choice} />
                  {answered && !mock && i === layout.answer && <span className="sr-only"> (correct answer)</span>}
                  {answered && !mock && i === chosen && i !== layout.answer && (
                    <span className="sr-only"> (your answer)</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <div aria-live="polite">
          {answered && mock && <p className="sr-only">Answer recorded.</p>}
          {answered && !mock && (
            <div className={`verdict ${right ? 'right' : 'wrong'}`}>
              <h4>
                <span aria-hidden="true">{right ? '✓ ' : '✗ '}</span>
                {right ? 'Correct' : chosen === -1 ? 'Out of time' : 'Not quite'}
              </h4>
              {progress.settings.explain && (
                <>
                  <Inline as="p" text={question.why} />
                  {question.asked && (
                    <div className="asked">
                      <b>Why they ask it:</b> <Inline text={question.asked} />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <div className="row mt-3">
          {answered && !mock && (
            <button className="btn primary big" onClick={next} autoFocus>
              {index + 1 === questions.length ? 'See results' : 'Next'} <span className="kbd">↵</span>
            </button>
          )}
          <button className="btn sm ghost" onClick={() => toggleSaved(question.id)} aria-pressed={saved}>
            {saved ? '★ Saved' : '☆ Save'}
          </button>
          <span className="faint">
            Keys 1–{layout.choices.length} to answer{answered && !mock ? ', Enter for next' : ''} · S to save
          </span>
        </div>
      </div>
    </div>
  );
}

/** Retry links keep the session's topic, tags and level. */
function retryParams(spec: DrillSpec, extra: Record<string, string>): string {
  const params = new URLSearchParams(extra);
  if (spec.topic) params.set('topic', spec.topic);
  if (spec.tags?.length) params.set('tags', spec.tags.join(','));
  if (spec.level) params.set('level', String(spec.level));
  return params.toString();
}

function EmptyDrill({ deck, spec, maxLevel }: { deck: Deck; spec: DrillSpec; maxLevel: 1 | 2 | 3 }) {
  const reason = emptyReason(deck.questions, spec, maxLevel);
  const anyway = (
    <Link to={`/drill/${deck.id}?${retryParams(spec, { count: '20' })}`}>drill it anyway</Link>
  );
  let body;
  if (reason === 'unknown-topic') {
    body = (
      <>
        <h2>No topic called “{spec.topic}”.</h2>
        <p className="muted">
          <Link to={`/drill/${deck.id}`}>Drill the whole deck</Link> or <Link to="/drill">pick another</Link>.
        </p>
      </>
    );
  } else if (reason === 'no-tags') {
    body = (
      <>
        <h2>No question here carries {spec.tags?.length === 1 ? 'that tag' : 'those tags'}.</h2>
        <p className="muted">
          Nothing in {deck.title} is tagged {spec.tags?.join(', ')}.{' '}
          <Link to={`/drill/${deck.id}`}>Drill the whole deck</Link> instead.
        </p>
      </>
    );
  } else if (reason === 'ceiling') {
    body = (
      <>
        <h2>Everything here is above your level ceiling.</h2>
        <p className="muted">
          Settings serve questions up to {'★'.repeat(maxLevel)}. <Link to="/settings">Raise the ceiling</Link> to
          drill these.
        </p>
      </>
    );
  } else if (reason === 'nothing-missed') {
    body = (
      <>
        <h2>Nothing missed.</h2>
        <p className="muted">
          Either you're good or you haven't drilled yet — <Link to="/drill/mixed?mode=today">start today's drill</Link>.
        </p>
      </>
    );
  } else if (reason === 'nothing-saved') {
    body = (
      <>
        <h2>Nothing saved.</h2>
        <p className="muted">Press S during a drill to keep a question here.</p>
      </>
    );
  } else if (reason === 'nothing-new') {
    body = (
      <>
        <h2>You've seen every question here.</h2>
        <p className="muted">Nothing new is left in this selection — {anyway} for a review.</p>
      </>
    );
  } else {
    body = (
      <>
        <h2>Nothing due here.</h2>
        <p className="muted">
          Every question in this selection is scheduled for later. That is the system working — come back
          tomorrow, or {anyway}.
        </p>
      </>
    );
  }
  return (
    <div className="page">
      <div className="empty">{body}</div>
    </div>
  );
}

/**
 * Counts down against a fixed deadline rather than counting ticks, so a
 * throttled background tab can't make the display drift. `onExpire` is called
 * from the interval callback — never from inside a state updater, which React
 * may run twice — and a ref makes sure it fires once.
 */
export function Countdown({
  seconds,
  paused,
  onExpire,
}: {
  seconds: number;
  paused: boolean;
  onExpire: () => void;
}) {
  const [deadline] = useState(() => Date.now() + seconds * 1000);
  const [now, setNow] = useState(() => Date.now());
  const fired = useRef(false);
  const expire = useEffectEvent(onExpire);

  useEffect(() => {
    if (seconds <= 0 || paused) return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= deadline && !fired.current) {
        fired.current = true;
        clearInterval(id);
        expire();
      }
    }, 250);
    return () => clearInterval(id);
  }, [seconds, paused, deadline]);

  if (seconds <= 0) return <span className="timer">∞</span>;
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  // The ticking number is readable but not live (it would chatter every
  // second); a separate polite region speaks once when time runs low.
  return (
    <>
      <span className={`timer${left <= 5 ? ' low' : ''}`} aria-live="off">
        {left}s
      </span>
      <span className="sr-only" aria-live="polite">
        {left > 0 && left <= 5 && !paused ? '5 seconds left' : ''}
      </span>
    </>
  );
}

/** The readiness verdict after a mock. A ★-only ceiling can't earn "book one". */
function mockVerdict(pct: number, ceiling: number): string {
  if (pct >= 80) {
    return ceiling >= 2
      ? 'Ready for a phone screen on this material. Book one.'
      : 'Ready at ★ level. Raise the ceiling in Settings and pass it again before you book a screen.';
  }
  if (pct >= 65) return 'Close. The misses below are your next two weeks.';
  return 'Not yet — work the review pile and the weakest topics, then try again in a week.';
}

function Summary({
  deck,
  title,
  spec,
  log,
  elapsed,
  search,
  pathStep,
  early,
}: {
  deck: Deck;
  title: string;
  spec: DrillSpec;
  log: Answered[];
  elapsed: number;
  search: string;
  pathStep: NextStep | undefined;
  early: boolean;
}) {
  const progress = useProgress();
  const mock = spec.mode === 'mock';
  const correct = log.filter((entry) => entry.correct).length;
  const pct = log.length === 0 ? 0 : Math.round((correct / log.length) * 100);
  const missed = log.filter((entry) => !entry.correct);
  const ceiling = spec.level ?? progress.settings.maxLevel;

  // Mock: every answer, wrong ones first. Practice: only the misses.
  const reviewed = mock ? [...missed, ...log.filter((entry) => entry.correct)] : missed;

  const byTopic = new Map<string, { asked: number; correct: number }>();
  for (const entry of log) {
    const row = byTopic.get(entry.question.topic) ?? { asked: 0, correct: 0 };
    row.asked += 1;
    if (entry.correct) row.correct += 1;
    byTopic.set(entry.question.topic, row);
  }
  const topics = [...byTopic.entries()].sort((a, b) => a[1].correct / a[1].asked - b[1].correct / b[1].asked);

  const stepDone = pathStep ? Boolean(progress.steps[pathStep.key]) : false;

  return (
    <div className="page stack stack-4">
      <header className="page-head">
        <div className="eyebrow">
          {title} · {early ? 'ended early' : 'session complete'}
        </div>
        <h1>
          {correct}/{log.length} · {pct}%
        </h1>
        <p className="lede">
          {mock
            ? mockVerdict(pct, ceiling)
            : pct >= 90
              ? 'That is interview-ready on this material.'
              : pct >= 70
                ? 'Solid. The misses below are the ones to reread.'
                : 'Worth slowing down — read each explanation properly before moving on.'}
        </p>
      </header>

      {pathStep && <StepBar steps={[pathStep]} eyebrow={stepDone ? 'Path step complete' : 'On the path'} />}

      <div className="stat-row">
        <Stat value={`${pct}%`} label="accuracy" />
        <Stat value={`${Math.round(elapsed / 1000)}s`} label="total" />
        <Stat value={`${log.length === 0 ? 0 : Math.round(elapsed / log.length / 1000)}s`} label="per question" />
        <Stat value={missed.length} label="to revisit" />
      </div>

      <div className="row">
        <Link className="btn primary" to={`/drill/${deck.id}${search ? `?${search}` : ''}`}>
          Go again
        </Link>
        {missed.length > 0 && (
          <Link
            className="btn"
            to={`/drill/${deck.id}?${retryParams(spec, { ids: missed.map((entry) => entry.question.id).join(',') })}`}
          >
            Drill these {missed.length} again
          </Link>
        )}
        <Link className="btn ghost" to="/drill">
          Other decks
        </Link>
        <Link className="btn ghost" to="/progress">
          See progress
        </Link>
      </div>

      {mock && topics.length > 0 && (
        <section>
          <h2>By topic</h2>
          <div className="mt-3">
            {topics.map(([topic, row]) => (
              <div key={topic} className="topic-row">
                <span>{topic}</span>
                <ProgressBar percent={Math.round((row.correct / row.asked) * 100)} good={row.correct / row.asked >= 0.8} label={`${topic} score`} />
                <span className="mono faint">
                  {row.correct}/{row.asked}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {reviewed.length > 0 && (
        <section className="stack stack-3">
          <h2>{mock ? 'Every question' : 'What you missed'}</h2>
          {reviewed.map((entry) => (
            <ReviewCard key={entry.question.id} entry={entry} saved={Boolean(progress.saved[entry.question.id])} />
          ))}
        </section>
      )}
    </div>
  );
}

function ReviewCard({ entry, saved }: { entry: Answered; saved: boolean }) {
  const q = entry.question;
  return (
    <div className="card review-card">
      <div className="spread mb-2">
        <div className="row">
          <span className="pill accent">{q.topic}</span>
          {q.tags?.slice(0, 2).map((tag) => (
            <span key={tag} className="pill">
              {tag}
            </span>
          ))}
        </div>
        <button className="btn sm ghost" onClick={() => toggleSaved(q.id)} aria-pressed={saved}>
          {saved ? '★ Saved' : '☆ Save'}
        </button>
      </div>
      <Inline as="strong" text={q.q} />
      {q.code && (
        <div className="mt-2">
          <CodeBlock code={q.code} lang={q.lang} />
        </div>
      )}
      {entry.correct ? (
        <div className="review-pick right">
          <span aria-hidden="true">✓</span>
          <span>
            You picked: <Inline text={entry.picked ?? ''} />
          </span>
        </div>
      ) : (
        <>
          <div className="review-pick wrong">
            <span aria-hidden="true">✗</span>
            <span>
              {entry.chosen === -1 ? (
                'Ran out of time'
              ) : (
                <>
                  You picked: <Inline text={entry.picked ?? ''} />
                </>
              )}
            </span>
          </div>
          <div className="review-pick right">
            <span aria-hidden="true">✓</span>
            <span>
              Answer: <Inline text={q.choices[q.answer] ?? ''} />
            </span>
          </div>
        </>
      )}
      <Inline as="p" className="muted mt-2 m-0" text={q.why} />
      {q.asked && (
        <p className="faint mt-2 m-0">
          <b>Why they ask it:</b> <Inline text={q.asked} />
        </p>
      )}
    </div>
  );
}
