import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useContent } from '../lib/content-context.ts';
import { pct } from '../lib/format.ts';
import { useNow, useProgress } from '../lib/hooks.ts';
import { todayPlan, topTopics } from '../lib/plan.ts';
import type { TodayPlan } from '../lib/plan.ts';
import { currentStreak, dayKey, daysBetween } from '../lib/progress.ts';
import type { ProgressState } from '../lib/progress.ts';
import { stageCompletion, stepHref, STEP_GLYPH } from '../lib/selectors.ts';
import type { NextStep } from '../lib/selectors.ts';
import { accuracyOf, topicStats, weakestTopics } from '../lib/session.ts';
import type { Step } from '../lib/types.ts';
import ProgressBar from '../components/ProgressBar.tsx';
import Stat from '../components/Stat.tsx';

const OPEN_LABEL: Record<Step['kind'], string> = {
  build: 'Open build',
  guide: 'Read guide',
  read: 'Read',
  drill: 'Start drill',
};

/** A drill card takes about 45 seconds with the explanation. */
const drillMinutes = (cards: number): number => Math.ceil(cards * 0.75);
const stepMinutes = (step: Step): number => (step.kind === 'drill' ? drillMinutes(step.count) : step.minutes);

/** Accuracy over the last 7 local days of the activity log, or undefined with no answers. */
function weekAccuracy(progress: ProgressState, now: number): number | undefined {
  const today = dayKey(now);
  let cards = 0;
  let correct = 0;
  for (const [day, activity] of Object.entries(progress.activity)) {
    if (daysBetween(day, today) < 7) {
      cards += activity.cards;
      correct += activity.correct;
    }
  }
  return cards === 0 ? undefined : correct / cards;
}

function relativeDay(days: number): string {
  if (days <= 0) return 'later today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

export default function Dashboard() {
  const content = useContent();
  const progress = useProgress();
  const questions = content.questions;
  const now = useNow();
  const plan = useMemo(() => todayPlan(content.roadmap, questions, progress, now), [content.roadmap, questions, progress, now]);
  const stats = useMemo(() => topicStats(questions, progress, now), [questions, progress, now]);
  const weak = weakestTopics(stats).slice(0, 4);
  const streak = currentStreak(progress.streak, dayKey(now));
  const accuracy = weekAccuracy(progress, now);
  const lockedIn = Object.values(progress.cards).filter((c) => c.interval >= 14).length;

  const { next } = plan;
  const minutes = drillMinutes(plan.queue.length) + (next ? stepMinutes(next.step) : 0);

  return (
    <div className="page stack stack-5">
      <header className="page-head">
        <div className="eyebrow">
          {next ? `Level ${next.stage.level} · ${next.stage.title}` : content.roadmap.subtitle}
        </div>
        <h1>{minutes > 0 ? `Today · about ${minutes} minutes` : 'Today · nothing due'}</h1>
        <p className="lede">
          {plan.awayDays >= 3 ? (
            <>
              Welcome back — it's been {plan.awayDays} days. Reviews first
              {plan.reviewsDue > plan.reviews.length
                ? `; ${plan.reviews.length} of ${plan.reviewsDue} are queued today and the rest roll over.`
                : '.'}
            </>
          ) : next ? (
            <>
              {plan.queue.length > 0 ? 'Clear your reviews, then keep going on' : 'Keep going on'} “{next.module.title}”.
            </>
          ) : (
            content.roadmap.targetRole
          )}
        </p>
      </header>

      <section className="card plan" aria-label="Today's plan">
        <DrillRow plan={plan} now={now} />
        <StepRow next={next} />
      </section>

      <div className="stat-row">
        <Stat value={streak} label={<>day streak{progress.streak.longest > 0 && ` · best ${progress.streak.longest}`}</>} />
        <Stat value={accuracy === undefined ? '—' : `${pct(accuracy)}%`} label="accuracy, last 7 days" />
        <Stat value={lockedIn} label="questions locked in" />
      </div>

      <div className="grid fit-300">
        <section className="card">
          <h3>Weakest topics</h3>
          {weak.length === 0 ? (
            <p className="faint mt-2 m-0">Answer a few drills and your weak spots show up here.</p>
          ) : (
            <div className="mt-2">
              {weak.map((stat) => (
                <div key={stat.topic} className="topic-row">
                  <Link to={`/drill/mixed?topic=${encodeURIComponent(stat.topic)}&count=15`}>{stat.topic}</Link>
                  <ProgressBar percent={pct(accuracyOf(stat))} good={accuracyOf(stat) > 0.75} label={`${stat.topic} accuracy`} />
                  <span className="mono faint">{pct(accuracyOf(stat))}%</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {next?.module.interviewFocus && (
          <section className="card">
            <h3>What they ask about this</h3>
            <ul className="focus-list">
              {next.module.interviewFocus.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <section>
        <div className="spread mb-3">
          <h2>The path</h2>
          <Link className="btn sm ghost" to="/path">
            Open full roadmap →
          </Link>
        </div>
        {content.roadmap.stages.map((stage) => {
          const completion = stageCompletion(stage, progress);
          const here = next?.stage.id === stage.id;
          return (
            <div key={stage.id} className="topic-row">
              <Link to={`/path/${stage.id}`}>
                <span className="faint mono mr-2">L{stage.level}</span>
                {stage.title}
                {here && <span className="pill accent ml-2">You are here</span>}
              </Link>
              <ProgressBar percent={pct(completion.ratio)} good={completion.ratio === 1} label={`${stage.title} progress`} />
              <span className="mono faint">
                {completion.done}/{completion.total}
              </span>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function DrillRow({ plan, now }: { plan: TodayPlan; now: number }) {
  const { questions } = useContent();
  const progress = useProgress();
  const reviews = plan.reviews.length;
  const fresh = plan.fresh.length;
  const topics = topTopics(plan.fresh).join(', ');

  if (reviews + fresh === 0) {
    let text: string;
    if (plan.today && plan.today.cards > 0) {
      text = `✓ Reviews done — ${plan.today.cards} answered today, ${pct(plan.today.correct / plan.today.cards)}% right`;
    } else {
      // Count what a drill would actually show: real questions within the
      // difficulty ceiling, like the due badge (dueSummary).
      const upcoming: number[] = [];
      for (const q of questions) {
        const card = progress.cards[q.id];
        if (q.level > progress.settings.maxLevel || !card || card.due <= now) continue;
        upcoming.push(daysBetween(dayKey(now), dayKey(card.due)));
      }
      const soonest = upcoming.length ? Math.min(...upcoming) : undefined;
      text =
        soonest === undefined
          ? 'Nothing due.'
          : `Nothing due. Next reviews ${relativeDay(soonest)} (${upcoming.filter((d) => d === soonest).length}).`;
    }
    return (
      <div className="plan-row done">
        <span className="plan-num" aria-hidden="true">
          ✓
        </span>
        <div className="min-w-0">{text}</div>
        <Link className="btn ghost" to="/drill/mixed?count=10">
          Extra 10
        </Link>
      </div>
    );
  }

  const meta = [
    reviews > 0 && `${reviews} due`,
    fresh > 0 && `${fresh} new${topics ? ` from ${topics}` : ''}`,
    plan.reviewsDue > reviews && `${plan.reviewsDue - reviews} more tomorrow`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="plan-row">
      <span className="plan-num">1</span>
      <div className="min-w-0">
        <div className="plan-title">
          <span aria-hidden="true">⚡ </span>Reviews and new questions
          <span className="faint"> · ~{drillMinutes(reviews + fresh)} min</span>
        </div>
        <div className="plan-meta">{meta}</div>
      </div>
      <Link className="btn primary" to="/drill/mixed?mode=today">
        Start drill
      </Link>
    </div>
  );
}

function StepRow({ next }: { next: NextStep | undefined }) {
  if (!next) {
    return (
      <div className="plan-row">
        <span className="plan-num">2</span>
        <div className="min-w-0">
          <div className="plan-title">Path complete</div>
          <div className="plan-meta">Keep the reviews warm and run a mock weekly.</div>
        </div>
        <Link className="btn" to="/drill/mixed?mode=mock">
          Run a mock
        </Link>
      </div>
    );
  }
  const { step } = next;
  return (
    <div className="plan-row">
      <span className="plan-num">2</span>
      <div className="min-w-0">
        <div className="plan-title">
          <span aria-hidden="true">{STEP_GLYPH[step.kind]} </span>
          {step.title}
          <span className="faint"> · ~{stepMinutes(step)} min</span>
        </div>
        <div className="plan-meta">
          Level {next.stage.level} · {next.module.title}
          {step.kind === 'drill' && ` · ${step.count} questions`}
        </div>
      </div>
      <Link className="btn" to={stepHref(step, next.key)}>
        {OPEN_LABEL[step.kind]}
      </Link>
    </div>
  );
}
