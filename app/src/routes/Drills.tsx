import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { allQuestions } from '../lib/content.ts';
import { useProgress } from '../lib/hooks.ts';
import { accuracyOf, topicStats } from '../lib/session.ts';
import type { Content, Deck } from '../lib/types.ts';

export default function Drills({ content }: { content: Content }) {
  const progress = useProgress();
  const questions = useMemo(() => allQuestions(content), [content]);
  const stats = useMemo(() => topicStats(questions, progress), [questions, progress]);
  const byTopic = new Map(stats.map((s) => [s.topic, s]));
  const totalDue = stats.reduce((n, s) => n + s.due, 0);

  return (
    <div className="page stack stack-4">
      <header className="page-head">
        <div className="eyebrow">{content.stats.questions} questions · {content.stats.decks} decks</div>
        <h1>Drills</h1>
        <p className="lede">
          Rapid-fire multiple choice on the things interviewers actually ask. Questions you get
          wrong come back sooner; questions you nail get spaced out. Answer with keys{' '}
          <span className="kbd">1</span>–<span className="kbd">4</span>, advance with{' '}
          <span className="kbd">↵</span>.
        </p>
      </header>

      <section className="card">
        <div className="spread">
          <div>
            <h2>Mixed mock</h2>
            <p className="faint" style={{ margin: '4px 0 0' }}>
              Every topic, shuffled — the closest thing here to a real screen.
            </p>
          </div>
          <span className={`pill ${totalDue > 0 ? 'accent' : 'good'}`}>{totalDue} due</span>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <Link className="btn primary" to="/drill/mixed?count=20&due=1">
            ⚡ 20 due now
          </Link>
          <Link className="btn ghost" to="/drill/mixed?count=10">
            Quick 10
          </Link>
          <Link className="btn ghost" to="/drill/mixed?count=40">
            Full 40
          </Link>
        </div>
      </section>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
        {content.decks.map((deck) => (
          <DeckCard key={deck.id} deck={deck} stat={byTopic.get(deck.topic)} />
        ))}
      </div>
    </div>
  );
}

function DeckCard({
  deck,
  stat,
}: {
  deck: Deck;
  stat: { seen: number; correct: number; due: number } | undefined;
}) {
  const accuracy = stat ? accuracyOf(stat) : 0;
  const attempted = (stat?.seen ?? 0) > 0;

  return (
    <div className="card stack stack-3">
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <h3>{deck.title}</h3>
        {stat && stat.due > 0 && <span className="pill accent">{stat.due} due</span>}
      </div>
      <p className="faint" style={{ margin: 0, flex: 1 }}>
        {deck.blurb}
      </p>
      {attempted && (
        <div>
          <div className="bar">
            <i
              style={{ width: `${Math.round(accuracy * 100)}%` }}
              className={accuracy > 0.75 ? 'good' : ''}
            />
          </div>
          <div className="faint" style={{ marginTop: 6 }}>
            {Math.round(accuracy * 100)}% over {stat?.seen} answers
          </div>
        </div>
      )}
      <div className="row">
        <Link className="btn primary sm" to={`/drill/${deck.id}?count=15`}>
          Drill 15
        </Link>
        <Link className="btn ghost sm" to={`/drill/${deck.id}?count=${deck.questions.length}`}>
          All {deck.questions.length}
        </Link>
      </div>
    </div>
  );
}
