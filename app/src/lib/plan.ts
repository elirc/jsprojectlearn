/**
 * Today's plan: what to do in the next half hour, derived from the roadmap
 * and the progress store. Pure — the caller supplies `now`.
 */
import { dayKey, daysBetween } from './progress.ts';
import type { DayActivity, ProgressState } from './progress.ts';
import { nextStep } from './selectors.ts';
import type { NextStep } from './selectors.ts';
import { priority, shuffle } from './session.ts';
import type { Question, Roadmap } from './types.ts';

/** Reviews beyond this roll over to tomorrow; a 200-card wall gets skipped, not done. */
export const REVIEW_CAP = 30;

/**
 * Decks you have reached: used by a drill step in a stage at or before the
 * stage you are on, or already practised (imported progress, extra drills).
 * `mixed` is everything, so it never unlocks anything by itself.
 */
export function unlockedDecks(roadmap: Roadmap, progress: ProgressState, questions: Question[]): Set<string> {
  const current = nextStep(roadmap, progress)?.stage.id;
  const unlocked = new Set<string>();
  for (const stage of roadmap.stages) {
    for (const mod of stage.modules) {
      for (const step of mod.steps) {
        if (step.kind === 'drill' && step.deck !== 'mixed') unlocked.add(step.deck);
      }
    }
    if (stage.id === current) break;
  }
  for (const q of questions) if (progress.cards[q.id]) unlocked.add(q.deck);
  return unlocked;
}

export interface TodayPlan {
  /** Seen, due and within the ceiling — most urgent first, capped. */
  reviews: Question[];
  /** How many reviews are due in total, before the cap. */
  reviewsDue: number;
  /** Never-seen questions from reached decks, within today's new allowance. */
  fresh: Question[];
  /** The drill Today starts: 3 reviews to 1 new, leftovers appended. */
  queue: Question[];
  next: NextStep | undefined;
  /** Whole days since the last day with any activity (0 = active today or never). */
  awayDays: number;
  today: DayActivity | undefined;
}

/** Three reviews, one new, repeat — so a session never ends on a wall of new material. */
export function interleave<T>(reviews: T[], fresh: T[]): T[] {
  const out: T[] = [];
  let r = 0;
  let f = 0;
  while (r < reviews.length || f < fresh.length) {
    for (let i = 0; i < 3 && r < reviews.length; i++) out.push(reviews[r++] as T);
    if (f < fresh.length) out.push(fresh[f++] as T);
  }
  return out;
}

export function todayPlan(
  roadmap: Roadmap,
  questions: Question[],
  progress: ProgressState,
  now: number,
): TodayPlan {
  const { maxLevel, newPerDay } = progress.settings;
  const day = dayKey(now);
  const today = progress.activity[day];

  const due = questions.filter((q) => {
    const card = progress.cards[q.id];
    return q.level <= maxLevel && card !== undefined && card.seen > 0 && card.due <= now;
  });
  due.sort((a, b) => priority(progress.cards[a.id], now) - priority(progress.cards[b.id], now));
  const reviews = due.slice(0, REVIEW_CAP);

  const allowance = Math.max(0, newPerDay - (today?.newCards ?? 0));
  const unlocked = unlockedDecks(roadmap, progress, questions);
  const unseen = questions.filter((q) => q.level <= maxLevel && !progress.cards[q.id] && unlocked.has(q.deck));
  // Easier first, random within a level.
  const fresh = ([1, 2, 3] as const)
    .flatMap((level) => shuffle(unseen.filter((q) => q.level === level)))
    .slice(0, allowance);

  const past = Object.keys(progress.activity).filter((d) => d < day).sort();
  const last = past[past.length - 1];
  const awayDays = today || !last ? 0 : daysBetween(last, day);

  return {
    reviews,
    reviewsDue: due.length,
    fresh,
    queue: interleave(reviews, fresh),
    next: nextStep(roadmap, progress),
    awayDays,
    today,
  };
}

/** The two topics most of today's new questions come from, for the plan copy. */
export function topTopics(questions: Question[], n = 2): string[] {
  const counts = new Map<string, number>();
  for (const q of questions) counts.set(q.topic, (counts.get(q.topic) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([topic]) => topic);
}

export interface HeatCell {
  day: string;
  /** Column (week, oldest first) and row (0 = Monday). */
  week: number;
  weekday: number;
  cards: number;
  steps: number;
  level: 0 | 1 | 2 | 3 | 4;
  future: boolean;
}

/** Intensity by work done: an answered card is 1, a finished path step is 10. */
export function heatLevel(cards: number, steps: number): HeatCell['level'] {
  const work = cards + 10 * steps;
  if (work === 0) return 0;
  if (work <= 10) return 1;
  if (work <= 25) return 2;
  if (work <= 50) return 3;
  return 4;
}

/**
 * `weeks` Monday-first columns ending with the current week, from the
 * activity log. Days after today are marked `future` so they render blank.
 */
export function heatmapCells(activity: ProgressState['activity'], now: number, weeks = 12): HeatCell[] {
  const today = new Date(now);
  today.setHours(12, 0, 0, 0); // noon: DST shifts can't push a day over midnight
  const mondayOffset = (today.getDay() + 6) % 7;
  const start = new Date(today);
  start.setDate(today.getDate() - mondayOffset - (weeks - 1) * 7);
  const todayKey = dayKey(today);

  const cells: HeatCell[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const day = dayKey(d);
    const a = activity[day];
    const cards = a?.cards ?? 0;
    const steps = a?.steps ?? 0;
    cells.push({
      day,
      week: Math.floor(i / 7),
      weekday: i % 7,
      cards,
      steps,
      level: heatLevel(cards, steps),
      future: day > todayKey,
    });
  }
  return cells;
}
