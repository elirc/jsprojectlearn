import type { Card, ProgressState } from './progress.ts';
import type { Question } from './types.ts';

/**
 * Picking which questions to ask.
 *
 * A drill is not a random sample. In priority order it serves:
 *   1. cards that are due for review (you got them wrong, or it has been a while),
 *   2. cards you have never seen,
 *   3. everything else, weakest-first.
 *
 * That ordering is what turns "a quiz" into "revision that converges".
 */

export interface DrillOptions {
  count: number;
  maxLevel: 1 | 2 | 3;
  /** Restrict to questions carrying one of these tags. */
  tags?: string[];
  /** Only serve cards that are currently due. */
  dueOnly?: boolean;
}

const isDue = (card: Card | undefined, now: number): boolean =>
  card !== undefined && card.due <= now;

/** Lower score = ask sooner. */
function priority(card: Card | undefined, now: number): number {
  if (!card) return 1; // unseen: right after due cards
  if (card.due <= now) {
    // The more overdue and the weaker the card, the earlier it goes.
    const overdueDays = (now - card.due) / 86_400_000;
    return -1 - Math.min(overdueDays, 30) / 30 - card.lapses * 0.1;
  }
  const accuracy = card.seen > 0 ? card.correct / card.seen : 0;
  return 2 + accuracy;
}

export function buildDrill(
  pool: Question[],
  progress: ProgressState,
  options: DrillOptions,
): Question[] {
  const now = Date.now();
  let candidates = pool.filter((q) => q.level <= options.maxLevel);

  if (options.tags?.length) {
    const wanted = new Set(options.tags);
    candidates = candidates.filter((q) => q.tags?.some((t) => wanted.has(t)));
  }
  if (options.dueOnly) {
    candidates = candidates.filter((q) => {
      const card = progress.cards[q.id];
      return card === undefined || isDue(card, now);
    });
  }

  // Shuffle first so equal-priority questions don't always arrive in file order.
  const shuffled = shuffle(candidates);
  shuffled.sort((a, b) => priority(progress.cards[a.id], now) - priority(progress.cards[b.id], now));
  return shuffled.slice(0, options.count);
}

export function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/**
 * Choice order is shuffled per question so you cannot learn "the answer is
 * always B", but it has to stay stable while the question is on screen.
 */
export function shuffledChoices(question: Question): { choices: string[]; answer: number } {
  const indices = shuffle(question.choices.map((_, i) => i));
  return {
    choices: indices.map((i) => question.choices[i] as string),
    answer: indices.indexOf(question.answer),
  };
}

export interface TopicStat {
  topic: string;
  seen: number;
  correct: number;
  total: number;
  due: number;
}

export function topicStats(pool: Question[], progress: ProgressState): TopicStat[] {
  const now = Date.now();
  const byTopic = new Map<string, TopicStat>();

  for (const q of pool) {
    const stat = byTopic.get(q.topic) ?? { topic: q.topic, seen: 0, correct: 0, total: 0, due: 0 };
    stat.total += 1;
    const card = progress.cards[q.id];
    if (card) {
      stat.seen += card.seen;
      stat.correct += card.correct;
      if (isDue(card, now)) stat.due += 1;
    } else {
      stat.due += 1;
    }
    byTopic.set(q.topic, stat);
  }
  return [...byTopic.values()].sort((a, b) => a.topic.localeCompare(b.topic));
}

export const accuracyOf = (stat: { seen: number; correct: number }): number =>
  stat.seen === 0 ? 0 : stat.correct / stat.seen;

/** Topics with enough attempts to judge, worst accuracy first. */
export function weakestTopics(stats: TopicStat[], minSeen = 4): TopicStat[] {
  return stats
    .filter((s) => s.seen >= minSeen)
    .sort((a, b) => accuracyOf(a) - accuracyOf(b));
}
