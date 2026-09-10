import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { allQuestions } from '../lib/content.ts';
import { useProgress } from '../lib/hooks.ts';
import {
  nextStep,
  overallCompletion,
  remainingMinutes,
  stageCompletion,
  stepHref,
  STEP_GLYPH,
  STEP_LABEL,
} from '../lib/selectors.ts';
import { accuracyOf, topicStats, weakestTopics } from '../lib/session.ts';
import type { Content } from '../lib/types.ts';

export default function Dashboard({ content }: { content: Content }) {
  const progress = useProgress();
  const questions = useMemo(() => allQuestions(content), [content]);

  const overall = overallCompletion(content.roadmap, progress);
  const next = nextStep(content.roadmap, progress);
  const minutesLeft = remainingMinutes(content.roadmap, progress);
  const stats = useMemo(() => topicStats(questions, progress), [questions, progress]);
  const weak = weakestTopics(stats).slice(0, 4);
  const due = stats.reduce((n, s) => n + s.due, 0);

  const answered = stats.reduce((n, s) => n + s.seen, 0);
  const correct = stats.reduce((n, s) => n + s.correct, 0);

  return (
    <div className="page stack stack-5">
      <header className="page-head">
        <div className="eyebrow">{content.roadmap.subtitle}</div>
        <h1>
          {overall.done === 0 ? 'Start here' : `${Math.round(overall.ratio * 100)}% of the way there`}
        </h1>
        <p className="lede">{content.roadmap.targetRole}</p>
      </header>

      <div className="stat-row">
        <div className="stat">
          <b>{progress.streak.current}</b>
          <span>day streak{progress.streak.longest > 0 && ` · best ${progress.streak.longest}`}</span>
        </div>
        <div className="stat">
          <b>
            {overall.done}
            <span style={{ fontSize: 15, color: 'var(--ink-faint)' }}>/{overall.total}</span>
          </b>
          <span>steps complete</span>
        </div>
        <div className="stat">
          <b>{answered === 0 ? '—' : `${Math.round((correct / answered) * 100)}%`}</b>
          <span>drill accuracy ({answered} answered)</span>
        </div>
        <div className="stat">
          <b>{Math.round(minutesLeft / 60)}h</b>
          <span>of study left</span>
        </div>
      </div>

      {next ? (
        <section className="card">
          <div className="eyebrow">Next up</div>
          <div className="spread" style={{ marginTop: 10, alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ marginBottom: 6 }}>{next.step.title}</h2>
              <p className="faint" style={{ margin: 0 }}>
                {next.stage.title} · {next.module.title}
              </p>
            </div>
            <a className="btn primary big" href={stepHref(next.step)}>
              <span aria-hidden="true">{STEP_GLYPH[next.step.kind]}</span>
              {STEP_LABEL[next.step.kind]}
            </a>
          </div>
          <p className="module-why" style={{ marginTop: 14 }}>
            {next.module.why}
          </p>
          {next.module.interviewFocus && (
            <div className="focus-box">
              <div className="eyebrow">What they ask about this</div>
              <ul>
                {next.module.interviewFocus.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      ) : (
        <section className="card">
          <h2>Path complete.</h2>
          <p className="muted">
            Every step is checked off. Keep the drills warm — <Link to="/drill/mixed">run a full
            mixed mock</Link> and see if the accuracy holds.
          </p>
        </section>
      )}

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <section className="card">
          <div className="spread">
            <h3>Drills due</h3>
            <span className={`pill ${due > 0 ? 'accent' : 'good'}`}>{due} ready</span>
          </div>
          <p className="faint" style={{ margin: '8px 0 14px' }}>
            Questions you have never seen, plus ones the schedule says you are about to forget.
          </p>
          <Link className="btn primary" to="/drill/mixed?count=20&due=1">
            ⚡ Drill 20 now
          </Link>
        </section>

        <section className="card">
          <h3>Weakest topics</h3>
          {weak.length === 0 ? (
            <p className="faint" style={{ margin: '8px 0 0' }}>
              Answer a few drills and your weak spots show up here.
            </p>
          ) : (
            <div style={{ marginTop: 10 }}>
              {weak.map((stat) => (
                <div key={stat.topic} className="topic-row">
                  <Link to={`/drill/mixed?topic=${encodeURIComponent(stat.topic)}`}>
                    {stat.topic}
                  </Link>
                  <div className="bar">
                    <i
                      style={{ width: `${Math.round(accuracyOf(stat) * 100)}%` }}
                      className={accuracyOf(stat) > 0.75 ? 'good' : ''}
                    />
                  </div>
                  <span className="mono faint">{Math.round(accuracyOf(stat) * 100)}%</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section>
        <div className="spread" style={{ marginBottom: 14 }}>
          <h2>The path</h2>
          <Link className="btn sm ghost" to="/path">
            Open full roadmap →
          </Link>
        </div>
        <div className="grid">
          {content.roadmap.stages.map((stage) => {
            const completion = stageCompletion(stage, progress);
            return (
              <Link
                key={stage.id}
                to={`/path/${stage.id}`}
                className="card"
                style={{ color: 'inherit', display: 'block' }}
              >
                <div className="spread" style={{ alignItems: 'flex-start' }}>
                  <div className="eyebrow">Level {stage.level}</div>
                  <span className="pill">{Math.round(completion.ratio * 100)}%</span>
                </div>
                <h3 style={{ margin: '8px 0 4px' }}>{stage.title}</h3>
                <p className="faint" style={{ margin: '0 0 12px' }}>
                  {stage.tagline}
                </p>
                <div className="bar">
                  <i
                    style={{ width: `${Math.round(completion.ratio * 100)}%` }}
                    className={completion.ratio === 1 ? 'good' : ''}
                  />
                </div>
                <div className="faint" style={{ marginTop: 8 }}>
                  {stage.modules.length} modules · ~{stage.hours}h
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="banner">
        <strong>What this path deliberately skips.</strong>
        <p style={{ margin: '6px 0 0' }}>{content.roadmap.notOnThisPath}</p>
      </section>
    </div>
  );
}
