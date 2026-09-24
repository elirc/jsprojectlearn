import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import Heatmap from '../components/Heatmap.tsx';
import { useNow, useProgress } from '../lib/hooks.ts';
import { currentStreak, dayKey } from '../lib/progress.ts';
import { overallCompletion, stageCompletion } from '../lib/selectors.ts';
import { accuracyOf, topicStats } from '../lib/session.ts';
import { useContent } from '../lib/content-context.ts';
import ProgressBar from '../components/ProgressBar.tsx';
import Stat from '../components/Stat.tsx';

export default function ProgressView() {
  const content = useContent();
  const progress = useProgress();
  const questions = content.questions;
  const now = useNow();
  const stats = useMemo(() => topicStats(questions, progress, now), [questions, progress, now]);
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
        <Stat value={`${Math.round(overall.ratio * 100)}%`} label="path complete" />
        <Stat value={answered === 0 ? '—' : `${Math.round((correct / answered) * 100)}%`} label="drill accuracy" />
        <Stat value={mastered} label="questions locked in" />
        <Stat value={currentStreak(progress.streak, dayKey(now))} label="day streak" />
      </div>

      <section>
        <h2>Activity</h2>
        <Heatmap activity={progress.activity} now={now} />
      </section>

      <section>
        <h2>By stage</h2>
        <div className="mt-3">
          {content.roadmap.stages.map((stage) => {
            const completion = stageCompletion(stage, progress);
            return (
              <div key={stage.id} className="topic-row">
                <Link to={`/path/${stage.id}`}>
                  <span className="faint mono mr-2">
                    L{stage.level}
                  </span>
                  {stage.title}
                </Link>
                <ProgressBar percent={Math.round(completion.ratio * 100)} good={completion.ratio === 1} label={`${stage.title} progress`} />
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
        <p className="faint mt-1">
          Accuracy across every drill answer. A topic with a low bar and a high “due” count is the
          one to open next.
        </p>
        <div className="mt-3">
          {stats.map((stat) => (
            <div key={stat.topic} className="topic-row">
              <div>
                <Link to={`/drill/mixed?topic=${encodeURIComponent(stat.topic)}&count=15`}>
                  {stat.topic}
                </Link>
                <span className="faint ml-2">
                  {stat.due} due · {stat.fresh} new of {stat.total}
                </span>
              </div>
              <ProgressBar percent={Math.round(accuracyOf(stat) * 100)} good={accuracyOf(stat) > 0.75} label={`${stat.topic} accuracy`} />
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
          <div className="mt-3">
            {recent.map((session) => (
              <div key={session.at} className="topic-row session-row">
                <div>
                  <span className="mono faint mr-2">
                    {new Date(session.at).toLocaleDateString(undefined, {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                  {session.deck === 'mixed' ? 'Mixed' : (content.decks.find((d) => d.id === session.deck)?.title ?? session.deck)}
                  {session.mode === 'mock' && <span className="pill accent ml-2">Mock</span>}
                </div>
                <ProgressBar percent={(session.correct / session.asked) * 100} good={session.correct / session.asked > 0.75} label="Session score" />
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
