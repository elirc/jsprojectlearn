/**
 * All progress lives in localStorage under one key, behind a tiny external
 * store so components can subscribe with useSyncExternalStore.
 *
 * Deliberately hand-rolled rather than pulled from npm: this file is the
 * worked example for react/41-mini-store and react/51-use-sync-external-store.
 */

const KEY = 'devpath.progress.v1';

/** One question's spaced-repetition state (SM-2, simplified). */
export interface Card {
  /** Ease factor. Starts at 2.5, floors at 1.3 — lower means shown more often. */
  ease: number;
  /** Days until the next review. */
  interval: number;
  /** Epoch ms when this becomes due. */
  due: number;
  reps: number;
  lapses: number;
  seen: number;
  correct: number;
  lastSeen: number;
}

export interface SessionRecord {
  at: number;
  deck: string;
  asked: number;
  correct: number;
  ms: number;
}

export interface Settings {
  /** Countdown per question. 0 disables the timer. */
  seconds: number;
  /** Only serve questions at or below this level (1 junior … 3 deep). */
  maxLevel: 1 | 2 | 3;
  /** Reveal the explanation immediately after answering. */
  explain: boolean;
}

export interface ProgressState {
  version: 1;
  /** stepKey -> completion timestamp. */
  steps: Record<string, number>;
  /** Free-form notes per module, keyed "stageId/moduleId". */
  notes: Record<string, string>;
  cards: Record<string, Card>;
  sessions: SessionRecord[];
  streak: { current: number; longest: number; lastDay: string };
  settings: Settings;
}

const EMPTY: ProgressState = {
  version: 1,
  steps: {},
  notes: {},
  cards: {},
  sessions: [],
  streak: { current: 0, longest: 0, lastDay: '' },
  settings: { seconds: 45, maxLevel: 3, explain: true },
};

function read(): ProgressState {
  if (typeof localStorage === 'undefined') return EMPTY;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<ProgressState>;
    // Merge rather than trust: a state written by an older build is missing keys.
    return {
      ...EMPTY,
      ...parsed,
      steps: parsed.steps ?? {},
      notes: parsed.notes ?? {},
      cards: parsed.cards ?? {},
      sessions: parsed.sessions ?? [],
      streak: { ...EMPTY.streak, ...parsed.streak },
      settings: { ...EMPTY.settings, ...parsed.settings },
    };
  } catch {
    return EMPTY;
  }
}

let state: ProgressState = read();
const listeners = new Set<() => void>();

function commit(next: ProgressState): void {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode, quota, or a browser blocking site data. The session still
    // works, it just won't be remembered — not worth interrupting the user.
  }
  for (const listener of listeners) listener();
}

export const progressStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): ProgressState {
    return state;
  },
};

/** Local calendar day, so a streak rolls over at the user's midnight. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(a: string, b: string): number {
  const toMs = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((toMs(b) - toMs(a)) / 86_400_000);
}

function touchStreak(streak: ProgressState['streak']): ProgressState['streak'] {
  const day = today();
  if (streak.lastDay === day) return streak;
  const gap = streak.lastDay ? daysBetween(streak.lastDay, day) : Infinity;
  const current = gap === 1 ? streak.current + 1 : 1;
  return { current, longest: Math.max(current, streak.longest), lastDay: day };
}

// ---------------------------------------------------------------- steps

export function setStepDone(key: string, done: boolean): void {
  const steps = { ...state.steps };
  if (done) steps[key] = Date.now();
  else delete steps[key];
  commit({ ...state, steps, streak: done ? touchStreak(state.streak) : state.streak });
}

export function setNote(moduleKey: string, text: string): void {
  const notes = { ...state.notes };
  if (text.trim()) notes[moduleKey] = text;
  else delete notes[moduleKey];
  commit({ ...state, notes });
}

// ---------------------------------------------------------------- drills

const DAY = 86_400_000;

function blankCard(): Card {
  return { ease: 2.5, interval: 0, due: 0, reps: 0, lapses: 0, seen: 0, correct: 0, lastSeen: 0 };
}

/**
 * SM-2, trimmed to what a multiple-choice drill can actually observe.
 * A right answer given quickly is worth more than a right answer that took
 * the whole timer, because hesitation is the signal that it isn't solid yet.
 */
export function gradeCard(id: string, correct: boolean, elapsedMs: number): void {
  const prev = state.cards[id] ?? blankCard();
  const quick = elapsedMs < 8000;
  const quality = correct ? (quick ? 5 : 3.5) : 1;

  let { ease, interval, reps, lapses } = prev;

  if (correct) {
    reps += 1;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = 3;
    else interval = Math.round(interval * ease);
    ease = Math.max(1.3, ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  } else {
    reps = 0;
    lapses += 1;
    interval = 0;
    ease = Math.max(1.3, ease - 0.2);
  }

  const card: Card = {
    ease,
    interval,
    // interval 0 means "again this session" — due immediately.
    due: Date.now() + interval * DAY,
    reps,
    lapses,
    seen: prev.seen + 1,
    correct: prev.correct + (correct ? 1 : 0),
    lastSeen: Date.now(),
  };

  commit({ ...state, cards: { ...state.cards, [id]: card } });
}

export function recordSession(record: SessionRecord): void {
  const sessions = [...state.sessions, record].slice(-500);
  commit({ ...state, sessions, streak: touchStreak(state.streak) });
}

export function updateSettings(patch: Partial<Settings>): void {
  commit({ ...state, settings: { ...state.settings, ...patch } });
}

export function resetAll(): void {
  commit({ ...EMPTY, settings: state.settings });
}

export function exportState(): string {
  return JSON.stringify(state, null, 2);
}

export function importState(json: string): void {
  const parsed = JSON.parse(json) as Partial<ProgressState>;
  if (parsed.version !== 1) throw new Error('Unrecognised progress file');
  commit({ ...EMPTY, ...parsed } as ProgressState);
}
