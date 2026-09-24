import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import Inline from '../components/Inline.tsx';
import { useContent } from '../lib/content-context.ts';
import { useNow, useProgress } from '../lib/hooks.ts';
import { todayPlan } from '../lib/plan.ts';
import { toggleSaved } from '../lib/progress.ts';
import { accuracyOf, isMissed, topicStats } from '../lib/session.ts';
import type { Deck } from '../lib/types.ts';
import ProgressBar from '../components/ProgressBar.tsx';

export default function Drills() {
  const content = useContent();
  const progress = useProgress();
  const questions = content.questions;
  const now = useNow();
  const stats = useMemo(() => topicStats(questions, progress, now), [questions, progress, now]);
  const plan = useMemo(() => todayPlan(content.roadmap, questions, progress, now), [content.roadmap, questions, progress, now]);
  const byTopic = new Map(stats.map((s) => [s.topic, s]));

  const missed = questions.filter((q) => isMissed(progress.cards[q.id])).length;
  const saved = questions
    .filter((q) => progress.saved[q.id])
    .sort((a, b) => (progress.saved[b.id] ?? 0) - (progress.saved[a.id] ?? 0));
  const todayCount = plan.queue.length;

  return (
    <div className="page stack stack-4">
      <header className="page-head">
        <div className="eyebrow">
          {content.stats.questions} questions · {content.stats.decks} decks
        </div>
        <h1>Drills</h1>
        <p className="lede">
          Rapid-fire multiple choice on the things interviewers actually ask. Questions you get wrong come back
          sooner; questions you nail get spaced out. Answer with keys <span className="kbd">1</span>–
          <span className="kbd">4</span>, advance with <span className="kbd">↵</span>, save with{' '}
          <span className="kbd">S</span>.
        </p>
      </header>

      <section className="card">
        <div className="spread">
          <div>
            <h2>Today's drill</h2>
            <p className="faint mt-1 m-0">
              {plan.reviews.length} reviews due · {plan.fresh.length} new
              {plan.reviewsDue > plan.reviews.length && ` · ${plan.reviewsDue - plan.reviews.length} more tomorrow`}
            </p>
          </div>
        </div>
        <div className="row mt-3">
          {todayCount > 0 ? (
            <Link className="btn primary" to="/drill/mixed?mode=today">
              ⚡ Start today's drill
            </Link>
          ) : (
            <span className="faint">Nothing due today.</span>
          )}
          <Link className="btn ghost" to="/drill/mixed?count=10">
            Quick 10
          </Link>
          <Link className="btn ghost" to="/drill/mixed?mode=mock">
            Mock interview
          </Link>
        </div>
      </section>

      <section className="card">
        <h2>Your review pile</h2>
        {missed === 0 && saved.length === 0 ? (
          <p className="faint mt-1 m-0">Nothing here yet. Questions you miss and questions you save collect here.</p>
        ) : (
          <>
            <p className="faint mt-1 m-0">
              {missed} missed · {saved.length} saved
            </p>
            <div className="row mt-3">
              {missed > 0 && (
                <Link className="btn" to="/drill/mixed?mode=missed&count=20">
                  Drill missed
                </Link>
              )}
              {saved.length > 0 && (
                <Link className="btn" to={`/drill/mixed?mode=saved&count=${Math.min(saved.length, 60)}`}>
                  Drill saved ({saved.length})
                </Link>
              )}
            </div>
          </>
        )}
        {saved.length > 0 && (
          <details className="saved-list mt-3">
            <summary>Saved questions</summary>
            <ul>
              {saved.map((q) => (
                <li key={q.id}>
                  <span className="min-w-0">
                    <span className="faint">{q.topic} · </span>
                    <Inline text={q.q} />
                  </span>
                  <button className="btn sm ghost" onClick={() => toggleSaved(q.id)}>
                    Unsave
                  </button>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <div className="grid cols-320">
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
  stat: { seen: number; correct: number; due: number; fresh: number } | undefined;
}) {
  const accuracy = stat ? accuracyOf(stat) : 0;
  const attempted = (stat?.seen ?? 0) > 0;
  const levels = [1, 2, 3].map((level) => deck.questions.filter((q) => q.level === level).length);

  return (
    <div className="card stack stack-3">
      <div className="spread align-start">
        <h3>{deck.title}</h3>
        {stat && (stat.due > 0 || stat.fresh > 0) && (
          <span className="pill accent">
            {[stat.due > 0 && `${stat.due} due`, stat.fresh > 0 && `${stat.fresh} new`].filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
      <p className="faint m-0 flex-1">{deck.blurb}</p>
      <div className="faint">
        ★ {levels[0]} · ★★ {levels[1]} · ★★★ {levels[2]}
      </div>
      {attempted && (
        <div>
          <ProgressBar percent={Math.round(accuracy * 100)} good={accuracy > 0.75} label={`${deck.title} accuracy`} />
          <div className="faint mt-1">
            {Math.round(accuracy * 100)}% over {stat?.seen} answers
          </div>
        </div>
      )}
      <div className="row">
        <Link className="btn primary sm" to={`/drill/${deck.id}?count=15`}>
          Drill 15
        </Link>
        <Link className="btn ghost sm" to={`/drill/${deck.id}?count=${Math.min(deck.questions.length, 60)}`}>
          All {Math.min(deck.questions.length, 60)}
        </Link>
      </div>
    </div>
  );
}
