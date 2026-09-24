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
  /** Only serve cards that are currently due, or never seen. */
  dueOnly?: boolean;
  /** Injected clock, for tests. */
  now?: number;
}

const isDue = (card: Card | undefined, now: number): boolean =>
  card !== undefined && card.due <= now;

/** Lower score = ask sooner. */
export function priority(card: Card | undefined, now: number): number {
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
  const now = options.now ?? Date.now();
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
  /** Seen before and scheduled for now or earlier, within the level ceiling. */
  due: number;
  /** Never seen, within the level ceiling. Unseen is "new", never "due". */
  fresh: number;
}

export function topicStats(
  pool: Question[],
  progress: ProgressState,
  now = Date.now(),
  maxLevel: 1 | 2 | 3 = progress.settings.maxLevel,
): TopicStat[] {
  const byTopic = new Map<string, TopicStat>();

  for (const q of pool) {
    const stat = byTopic.get(q.topic) ?? {
      topic: q.topic,
      seen: 0,
      correct: 0,
      total: 0,
      due: 0,
      fresh: 0,
    };
    stat.total += 1;
    const card = progress.cards[q.id];
    if (card) {
      stat.seen += card.seen;
      stat.correct += card.correct;
    }
    if (q.level <= maxLevel) {
      if (!card) stat.fresh += 1;
      else if (isDue(card, now)) stat.due += 1;
    }
    byTopic.set(q.topic, stat);
  }
  return [...byTopic.values()].sort((a, b) => a.topic.localeCompare(b.topic));
}

/** Reviews due and questions never seen, within the level ceiling. */
export function dueSummary(
  questions: Question[],
  cards: ProgressState['cards'],
  now: number,
  maxLevel: 1 | 2 | 3,
): { due: number; fresh: number } {
  let due = 0;
  let fresh = 0;
  for (const q of questions) {
    if (q.level > maxLevel) continue;
    const card = cards[q.id];
    if (!card) fresh += 1;
    else if (card.due <= now) due += 1;
  }
  return { due, fresh };
}

export const accuracyOf = (stat: { seen: number; correct: number }): number =>
  stat.seen === 0 ? 0 : stat.correct / stat.seen;

/** Topics with enough attempts to judge, worst accuracy first. */
export function weakestTopics(stats: TopicStat[], minSeen = 4): TopicStat[] {
  return stats
    .filter((s) => s.seen >= minSeen)
    .sort((a, b) => accuracyOf(a) - accuracyOf(b));
}

// ------------------------------------------------------------ drill URLs

/**
 * Where the questions come from.
 *  practice  the smart order in buildDrill (due, then new, then weakest)
 *  today     reviews due (capped) plus today's new questions — see plan.ts
 *  due       only seen cards that are due
 *  new       only questions never seen
 *  missed    last answer was wrong (seen > 0 and reps reset to 0)
 *  saved     questions you starred
 *  mock      interview simulation: timed, spread across topics, no hints
 */
export const DRILL_MODES = ['practice', 'today', 'due', 'new', 'missed', 'saved', 'mock'] as const;
export type DrillMode = (typeof DRILL_MODES)[number];

export interface DrillSpec {
  mode: DrillMode;
  count: number;
  topic?: string;
  /** Exact level; overrides the Settings ceiling for this session. */
  level?: 1 | 2 | 3;
  /** Explicit question list ("drill these again"); order preserved. */
  ids?: string[];
  /** Only questions carrying at least one of these tags. */
  tags?: string[];
  /** The path step this drill was started from. */
  step?: string;
}

export const MAX_DRILL = 60;

/**
 * One parser for every /drill/:deck URL, so a hand-typed `?count=abc` gets a
 * sensible session instead of `slice(0, NaN)` and an empty "nothing due".
 */
export function parseDrillParams(search: string | URLSearchParams): DrillSpec {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const rawMode = params.get('mode');
  let mode: DrillMode = (DRILL_MODES as readonly string[]).includes(rawMode ?? '')
    ? (rawMode as DrillMode)
    : 'practice';
  // Legacy links: ?due=1 predates the mode grammar and meant "what's due today".
  if (mode === 'practice' && params.get('due') === '1') mode = 'today';

  const fallback = mode === 'mock' ? 40 : 15;
  const rawCount = params.get('count');
  const n = rawCount === null || rawCount.trim() === '' ? NaN : Number(rawCount);
  const count = Number.isFinite(n) ? Math.min(MAX_DRILL, Math.max(1, Math.floor(n))) : fallback;

  const level = Number(params.get('level'));
  const topic = params.get('topic')?.trim() || undefined;
  const ids = params
    .get('ids')
    ?.split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const step = params.get('step') || undefined;
  const tags = params
    .get('tags')
    ?.split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  return {
    mode,
    count,
    ...(topic ? { topic } : {}),
    ...(level === 1 || level === 2 || level === 3 ? { level } : {}),
    ...(ids?.length ? { ids } : {}),
    ...(tags?.length ? { tags } : {}),
    ...(step ? { step } : {}),
  };
}

/** Case-insensitive: hand-typed URLs say `topic=sql`, decks say "SQL". */
export const topicMatches = (question: Question, topic: string): boolean =>
  question.topic.toLowerCase() === topic.toLowerCase();

const hasAnyTag = (q: Question, tags: string[] | undefined): boolean =>
  !tags?.length || (q.tags ?? []).some((tag) => tags.includes(tag));

/** Deck → topic → tags → level (exact, or the Settings ceiling). */
export function filterPool(pool: Question[], spec: DrillSpec, maxLevel: 1 | 2 | 3): Question[] {
  return pool.filter(
    (q) =>
      (!spec.topic || topicMatches(q, spec.topic)) &&
      hasAnyTag(q, spec.tags) &&
      (spec.level ? q.level === spec.level : q.level <= maxLevel),
  );
}

/** "Missed" = the last answer was wrong: SM-2 resets reps to 0 on a miss. */
export const isMissed = (card: Card | undefined): boolean =>
  card !== undefined && card.seen > 0 && card.reps === 0;

/** The per-mode source filter, applied after deck/topic/tags/level. */
function inSource(q: Question, mode: DrillMode, progress: ProgressState, now: number): boolean {
  const card = progress.cards[q.id];
  switch (mode) {
    case 'due':
      return card !== undefined && card.due <= now;
    case 'new':
      return card === undefined;
    case 'missed':
      return isMissed(card);
    case 'saved':
      return Boolean(progress.saved[q.id]);
    default:
      return true;
  }
}

/**
 * A mock interview samples across topics the way an interviewer does:
 * group by topic, shuffle each group, deal round-robin, then shuffle the hand
 * so the order doesn't give the topics away.
 */
export function buildMock(pool: Question[], count: number): Question[] {
  const groups = new Map<string, Question[]>();
  for (const q of pool) groups.set(q.topic, [...(groups.get(q.topic) ?? []), q]);
  const queues = shuffle([...groups.values()].map((g) => shuffle(g)));
  const hand: Question[] = [];
  while (hand.length < count && queues.some((q) => q.length > 0)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next && hand.length < count) hand.push(next);
    }
  }
  return shuffle(hand);
}

/**
 * The questions for a session described by `spec`, drawn from `pool`.
 * (`today` is assembled by todayPlan in plan.ts, which needs the roadmap.)
 */
export function selectDrill(
  pool: Question[],
  progress: ProgressState,
  spec: DrillSpec,
  now: number,
): Question[] {
  if (spec.ids) {
    const byId = new Map(pool.map((q) => [q.id, q]));
    return spec.ids.map((id) => byId.get(id)).filter((q): q is Question => q !== undefined);
  }
  const candidates = filterPool(pool, spec, progress.settings.maxLevel).filter((q) =>
    inSource(q, spec.mode, progress, now),
  );
  if (spec.mode === 'mock') return buildMock(candidates, spec.count);
  // buildDrill applies the level ceiling itself; filterPool already did the
  // right thing (an exact level may be above the ceiling), so lift it here.
  return buildDrill(candidates, progress, { count: spec.count, maxLevel: 3, now });
}

export type EmptyReason =
  | 'unknown-topic'
  | 'no-tags'
  | 'ceiling'
  | 'nothing-due'
  | 'nothing-new'
  | 'nothing-missed'
  | 'nothing-saved';

/** Why a selection came back empty, so the empty state can say something true. */
export function emptyReason(pool: Question[], spec: DrillSpec, maxLevel: 1 | 2 | 3): EmptyReason {
  const inTopic = spec.topic ? pool.filter((q) => topicMatches(q, spec.topic ?? '')) : pool;
  if (inTopic.length === 0) return 'unknown-topic';
  if (!inTopic.some((q) => hasAnyTag(q, spec.tags))) return 'no-tags';
  if (filterPool(pool, spec, maxLevel).length === 0) return 'ceiling';
  if (spec.mode === 'new') return 'nothing-new';
  if (spec.mode === 'missed') return 'nothing-missed';
  if (spec.mode === 'saved') return 'nothing-saved';
  return 'nothing-due';
}
