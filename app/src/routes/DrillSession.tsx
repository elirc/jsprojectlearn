import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { deckById, mixedDeck } from '../lib/content.ts';
import { highlight } from '../lib/highlight.ts';
import { useKey, useProgress } from '../lib/hooks.ts';
import { gradeCard, recordSession } from '../lib/progress.ts';
import { buildDrill, shuffledChoices } from '../lib/session.ts';
import type { Content, Question } from '../lib/types.ts';

interface Answered {
  question: Question;
  chosen: number;
  correct: boolean;
  ms: number;
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export default function DrillSession({ content }: { content: Content }) {
  const { deckId = 'mixed' } = useParams();
  const [params] = useSearchParams();
  const progress = useProgress();

  const deck = deckById(content, deckId) ?? mixedDeck(content);
  const count = Number(params.get('count') ?? 15);
  const topic = params.get('topic');
  const dueOnly = params.get('due') === '1';

  // The question list is fixed when the session starts. Recomputing it as
  // answers land would reshuffle the deck under the user's feet.
  const [questions] = useState<Question[]>(() => {
    const pool = topic ? deck.questions.filter((q) => q.topic === topic) : deck.questions;
    return buildDrill(pool, progress, {
      count: Math.max(1, Math.min(count, 60)),
      maxLevel: progress.settings.maxLevel,
      dueOnly,
    });
  });

  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<number | undefined>(undefined);
  const [log, setLog] = useState<Answered[]>([]);
  const startedAt = useRef(Date.now());
  const questionStart = useRef(Date.now());

  const question = questions[index];
  const finished = index >= questions.length;

  // Choice order is stable per question but different every time you see it.
  const layout = useMemo(
    () => (question ? shuffledChoices(question) : { choices: [], answer: 0 }),
    [question],
  );

  const answer = useCallback(
    (choice: number) => {
      if (!question || chosen !== undefined) return;
      const ms = Date.now() - questionStart.current;
      const correct = choice === layout.answer;
      setChosen(choice);
      gradeCard(question.id, correct, ms);
      setLog((entries) => [...entries, { question, chosen: choice, correct, ms }]);
    },
    [question, chosen, layout.answer],
  );

  const next = useCallback(() => {
    setChosen(undefined);
    questionStart.current = Date.now();
    setIndex((i) => i + 1);
  }, []);

  useKey(['1', '2', '3', '4', '5', '6'], (key) => {
    const choice = Number(key) - 1;
    if (choice < layout.choices.length) answer(choice);
  });
  useKey(['Enter', ' '], () => {
    if (chosen !== undefined) next();
  });

  useEffect(() => {
    if (finished && log.length > 0) {
      recordSession({
        at: Date.now(),
        deck: deck.id,
        asked: log.length,
        correct: log.filter((entry) => entry.correct).length,
        ms: Date.now() - startedAt.current,
      });
    }
    // Only when the session ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  if (questions.length === 0) {
    return (
      <div className="page">
        <div className="empty">
          <h2>Nothing due here.</h2>
          <p className="muted">
            Every question in this deck is scheduled for later. That is the system working —
            come back tomorrow, or{' '}
            <Link to={`/drill/${deck.id}?count=20`}>drill it anyway</Link>.
          </p>
        </div>
      </div>
    );
  }

  if (finished) {
    return <Summary deck={deck.id} log={log} elapsed={Date.now() - startedAt.current} />;
  }

  if (!question) return null;

  return (
    <div className="page">
      <div className="drill">
        <div className="drill-top">
          <Link className="btn sm ghost" to="/drill">
            ← Decks
          </Link>
          <div className="drill-progress">
            <div className="bar">
              <i style={{ width: `${(index / questions.length) * 100}%` }} />
            </div>
          </div>
          <span className="mono faint">
            {index + 1}/{questions.length}
          </span>
          <Countdown
            key={question.id}
            seconds={progress.settings.seconds}
            paused={chosen !== undefined}
            onExpire={() => answer(-1)}
          />
        </div>

        <div className="row" style={{ marginBottom: 12 }}>
          <span className="pill accent">{question.topic}</span>
          <span className="pill">{'★'.repeat(question.level)}</span>
          {question.tags?.slice(0, 3).map((tag) => (
            <span key={tag} className="pill">
              {tag}
            </span>
          ))}
        </div>

        <h2 className="question">{question.q}</h2>

        {question.code && (
          <figure className="code">
            <figcaption>{question.lang ?? 'code'}</figcaption>
            <pre>
              <code
                dangerouslySetInnerHTML={{ __html: highlight(question.code, question.lang ?? '') }}
              />
            </pre>
          </figure>
        )}

        <div className="choices">
          {layout.choices.map((choice, i) => {
            let className = 'choice';
            if (chosen !== undefined) {
              if (i === layout.answer) className += ' correct';
              else if (i === chosen) className += ' wrong';
              else className += ' dim';
            }
            return (
              <button
                key={i}
                className={className}
                disabled={chosen !== undefined}
                onClick={() => answer(i)}
              >
                <span className="key">{LETTERS[i]}</span>
                <span>{choice}</span>
              </button>
            );
          })}
        </div>

        {chosen !== undefined && progress.settings.explain && (
          <div className={`verdict ${chosen === layout.answer ? 'right' : 'wrong'}`}>
            <h4>
              {chosen === layout.answer
                ? 'Correct'
                : chosen === -1
                  ? 'Out of time'
                  : 'Not quite'}
            </h4>
            <p>{question.why}</p>
            {question.asked && (
              <div className="asked">
                <b>Why they ask it:</b> {question.asked}
              </div>
            )}
          </div>
        )}

        {chosen !== undefined && (
          <div className="row" style={{ marginTop: 18 }}>
            <button className="btn primary big" onClick={next} autoFocus>
              {index + 1 === questions.length ? 'See results' : 'Next'} <span className="kbd">↵</span>
            </button>
            <span className="faint">Keys 1–{layout.choices.length} to answer</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Countdown({
  seconds,
  paused,
  onExpire,
}: {
  seconds: number;
  paused: boolean;
  onExpire: () => void;
}) {
  const [left, setLeft] = useState(seconds);
  const expire = useRef(onExpire);
  expire.current = onExpire;

  useEffect(() => {
    if (seconds <= 0 || paused) return;
    const id = setInterval(() => {
      setLeft((value) => {
        if (value <= 1) {
          clearInterval(id);
          expire.current();
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [seconds, paused]);

  if (seconds <= 0) return <span className="timer">∞</span>;
  return <span className={`timer${left <= 5 ? ' low' : ''}`}>{left}s</span>;
}

function Summary({ deck, log, elapsed }: { deck: string; log: Answered[]; elapsed: number }) {
  const correct = log.filter((entry) => entry.correct).length;
  const pct = log.length === 0 ? 0 : Math.round((correct / log.length) * 100);
  const missed = log.filter((entry) => !entry.correct);

  return (
    <div className="page stack stack-4">
      <header className="page-head">
        <div className="eyebrow">Session complete</div>
        <h1>
          {correct}/{log.length} · {pct}%
        </h1>
        <p className="lede">
          {pct >= 90
            ? 'That is interview-ready on this material.'
            : pct >= 70
              ? 'Solid. The misses below are the ones to reread.'
              : 'Worth slowing down — read each explanation properly before moving on.'}
        </p>
      </header>

      <div className="stat-row">
        <div className="stat">
          <b>{pct}%</b>
          <span>accuracy</span>
        </div>
        <div className="stat">
          <b>{Math.round(elapsed / 1000)}s</b>
          <span>total</span>
        </div>
        <div className="stat">
          <b>{log.length === 0 ? 0 : Math.round(elapsed / log.length / 1000)}s</b>
          <span>per question</span>
        </div>
        <div className="stat">
          <b>{missed.length}</b>
          <span>to revisit</span>
        </div>
      </div>

      <div className="row">
        <Link className="btn primary" to={`/drill/${deck}?count=${log.length}`}>
          Go again
        </Link>
        <Link className="btn ghost" to="/drill">
          Other decks
        </Link>
        <Link className="btn ghost" to="/progress">
          See progress
        </Link>
      </div>

      {missed.length > 0 && (
        <section className="stack stack-3">
          <h2>What you missed</h2>
          {missed.map((entry) => (
            <div key={entry.question.id} className="card">
              <div className="row" style={{ marginBottom: 8 }}>
                <span className="pill accent">{entry.question.topic}</span>
                {entry.question.tags?.slice(0, 2).map((tag) => (
                  <span key={tag} className="pill">
                    {tag}
                  </span>
                ))}
              </div>
              <strong>{entry.question.q}</strong>
              {entry.question.code && (
                <figure className="code" style={{ marginTop: 10 }}>
                  <figcaption>{entry.question.lang ?? 'code'}</figcaption>
                  <pre>
                    <code
                      dangerouslySetInnerHTML={{
                        __html: highlight(entry.question.code, entry.question.lang ?? ''),
                      }}
                    />
                  </pre>
                </figure>
              )}
              <p className="muted" style={{ margin: '10px 0 0' }}>
                <b style={{ color: 'var(--good)' }}>
                  {entry.question.choices[entry.question.answer]}
                </b>
                {' — '}
                {entry.question.why}
              </p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
