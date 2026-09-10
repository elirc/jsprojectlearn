import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { allQuestions } from '../lib/content.ts';
import { useProgress } from '../lib/hooks.ts';
import { overallCompletion, stageCompletion } from '../lib/selectors.ts';
import { accuracyOf, topicStats } from '../lib/session.ts';
import type { Content } from '../lib/types.ts';

export default function ProgressView({ content }: { content: Content }) {
  const progress = useProgress();
  const questions = useMemo(() => allQuestions(content), [content]);
  const stats = useMemo(() => topicStats(questions, progress), [questions, progress]);
  const overall = overallCompletion(content.roadmap, progress);

  const answered = stats.reduce((n, s) => n + s.seen, 0);
  const correct = stats.reduce((n, s) => n + s.correct, 0);
  const mastered = Object.values(progress.cards).filter((c) => c.interval >= 14).length;
  const recent = [...progress.sessions].reverse().slice(0, 12);

  return (
    <div className="page stack stack-5">
      <header className="page-head">
        <div className="eyebrow">Everything below lives in this browser only</div>
        <h1>Progress</h1>
      </header>

      <div className="stat-row">
        <div className="stat">
          <b>{Math.round(overall.ratio * 100)}%</b>
          <span>path complete</span>
        </div>
        <div className="stat">
          <b>{answered === 0 ? '—' : `${Math.round((correct / answered) * 100)}%`}</b>
          <span>drill accuracy</span>
        </div>
        <div className="stat">
          <b>{mastered}</b>
          <span>questions locked in</span>
        </div>
        <div className="stat">
          <b>{progress.streak.current}</b>
          <span>day streak</span>
        </div>
      </div>

      <section>
        <h2>By stage</h2>
        <div style={{ marginTop: 12 }}>
          {content.roadmap.stages.map((stage) => {
            const completion = stageCompletion(stage, progress);
            return (
              <div key={stage.id} className="topic-row">
                <Link to={`/path/${stage.id}`}>
                  <span className="faint mono" style={{ marginRight: 8 }}>
                    L{stage.level}
                  </span>
                  {stage.title}
                </Link>
                <div className="bar">
                  <i
                    style={{ width: `${Math.round(completion.ratio * 100)}%` }}
                    className={completion.ratio === 1 ? 'good' : ''}
                  />
                </div>
                <span className="mono faint">
                  {completion.done}/{completion.total}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2>By topic</h2>
        <p className="faint" style={{ marginTop: 4 }}>
          Accuracy across every drill answer. A topic with a low bar and a high “due” count is the
          one to open next.
        </p>
        <div style={{ marginTop: 12 }}>
          {stats.map((stat) => (
            <div key={stat.topic} className="topic-row">
              <div>
                <Link to={`/drill/mixed?topic=${encodeURIComponent(stat.topic)}&count=15`}>
                  {stat.topic}
                </Link>
                <span className="faint" style={{ marginLeft: 10 }}>
                  {stat.due} due of {stat.total}
                </span>
              </div>
              <div className="bar">
                <i
                  style={{ width: `${Math.round(accuracyOf(stat) * 100)}%` }}
                  className={accuracyOf(stat) > 0.75 ? 'good' : ''}
                />
              </div>
              <span className="mono faint">
                {stat.seen === 0 ? '—' : `${Math.round(accuracyOf(stat) * 100)}%`}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>Recent sessions</h2>
        {recent.length === 0 ? (
          <p className="faint">No drills yet. <Link to="/drill">Start one.</Link></p>
        ) : (
          <div style={{ marginTop: 12 }}>
            {recent.map((session) => (
              <div key={session.at} className="topic-row" style={{ gridTemplateColumns: '1fr 120px 62px' }}>
                <div>
                  <span className="mono faint" style={{ marginRight: 10 }}>
                    {new Date(session.at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                  {session.deck}
                </div>
                <div className="bar">
                  <i
                    style={{ width: `${(session.correct / session.asked) * 100}%` }}
                    className={session.correct / session.asked > 0.75 ? 'good' : ''}
                  />
                </div>
                <span className="mono faint">
                  {session.correct}/{session.asked}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
