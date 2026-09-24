/**
 * All progress lives in localStorage under one key, behind a tiny external
 * store so components can subscribe with useSyncExternalStore.
 *
 * Deliberately hand-rolled rather than pulled from npm: this file is the
 * worked example for react/41-mini-store and react/51-use-sync-external-store.
 *
 * Everything that reaches `state` goes through parseProgress(migrate(raw)),
 * whether it came from this tab's storage, another tab's write, or an
 * imported file. Stored data is input, and input gets validated.
 */
import LEGACY_STEP_KEYS from './legacy-step-keys.json' with { type: 'json' };

// The key keeps its v1 name on purpose: renaming it would orphan every
// existing profile. The schema version lives inside the payload.
const KEY = 'devpath.progress.v1';
const V1_BACKUP_KEY = 'devpath.progress.v1.backup';

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
  /** Absent on practice sessions (and on every v1 record). */
  mode?: 'mock';
  /** The path step this drill was started from. */
  step?: string;
}

export interface Settings {
  /** Countdown per question. 0 disables the timer. */
  seconds: number;
  /** Only serve questions at or below this level (1 junior … 3 deep). */
  maxLevel: 1 | 2 | 3;
  /** Reveal the explanation immediately after answering. */
  explain: boolean;
  /** Never-seen questions Today's plan adds per day. */
  newPerDay: number;
}

export interface Streak {
  current: number;
  longest: number;
  /** Local YYYY-MM-DD of the last day with activity. */
  lastDay: string;
}

/**
 * What happened on one local day. Counts only: minutes would mix measured
 * answer time with roadmap estimates, and a number that means two things
 * means nothing.
 */
export interface DayActivity {
  cards: number;
  correct: number;
  /** Questions seen for the first time (Today's new-per-day budget). */
  newCards: number;
  steps: number;
}

export interface ProgressState {
  version: 2;
  /** stepKey (`module/kind:target`) -> completion timestamp. */
  steps: Record<string, number>;
  /** Free-form notes per module, keyed by module id. */
  notes: Record<string, string>;
  cards: Record<string, Card>;
  sessions: SessionRecord[];
  streak: Streak;
  settings: Settings;
  /** Question id -> when it was saved for later. */
  saved: Record<string, number>;
  /** Local YYYY-MM-DD -> that day's activity. */
  activity: Record<string, DayActivity>;
}

export const CURRENT_VERSION = 2;

export const DEFAULT_SETTINGS: Settings = { seconds: 45, maxLevel: 3, explain: true, newPerDay: 10 };

export function emptyProgress(): ProgressState {
  return {
    version: 2,
    steps: {},
    notes: {},
    cards: {},
    sessions: [],
    streak: { current: 0, longest: 0, lastDay: '' },
    settings: { ...DEFAULT_SETTINGS },
    saved: {},
    activity: {},
  };
}

// ------------------------------------------------------------- parsing

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNum = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

const count = (value: unknown): number => (isNum(value) ? Math.max(0, Math.floor(value)) : 0);

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function parseCard(raw: unknown): Card | undefined {
  if (!isRecord(raw)) return undefined;
  const fields = ['ease', 'interval', 'due', 'reps', 'lapses', 'seen', 'correct', 'lastSeen'] as const;
  if (!fields.every((f) => isNum(raw[f]))) return undefined;
  const n = (f: (typeof fields)[number]) => raw[f] as number;
  return {
    ease: clamp(n('ease'), 1.3, 5),
    interval: Math.max(0, n('interval')),
    due: n('due'),
    reps: Math.max(0, n('reps')),
    lapses: Math.max(0, n('lapses')),
    seen: Math.max(0, n('seen')),
    correct: clamp(n('correct'), 0, n('seen')),
    lastSeen: n('lastSeen'),
  };
}

function parseSession(raw: unknown): SessionRecord | undefined {
  if (!isRecord(raw) || typeof raw['deck'] !== 'string') return undefined;
  const { at, asked, correct, ms } = raw;
  if (!isNum(at) || !isNum(asked) || !isNum(correct) || !isNum(ms) || asked <= 0) return undefined;
  const record: SessionRecord = {
    at,
    deck: raw['deck'],
    asked,
    correct: clamp(correct, 0, asked),
    ms: Math.max(0, ms),
  };
  if (raw['mode'] === 'mock') record.mode = 'mock';
  if (typeof raw['step'] === 'string' && raw['step']) record.step = raw['step'];
  return record;
}

function parseDay(raw: unknown): DayActivity | undefined {
  if (!isRecord(raw)) return undefined;
  const cards = count(raw['cards']);
  return {
    cards,
    correct: Math.min(cards, count(raw['correct'])),
    newCards: Math.min(cards, count(raw['newCards'])),
    steps: count(raw['steps']),
  };
}

export function parseSettings(raw: unknown): Settings {
  const s = isRecord(raw) ? raw : {};
  const level = s['maxLevel'];
  return {
    seconds: isNum(s['seconds']) ? clamp(Math.round(s['seconds']), 0, 600) : DEFAULT_SETTINGS.seconds,
    maxLevel: level === 1 || level === 2 || level === 3 ? level : DEFAULT_SETTINGS.maxLevel,
    explain: typeof s['explain'] === 'boolean' ? s['explain'] : DEFAULT_SETTINGS.explain,
    newPerDay: isNum(s['newPerDay'])
      ? clamp(Math.round(s['newPerDay']), 0, 50)
      : DEFAULT_SETTINGS.newPerDay,
  };
}

function parseStreak(raw: unknown): Streak {
  const s = isRecord(raw) ? raw : {};
  const lastDay = typeof s['lastDay'] === 'string' && DAY_KEY.test(s['lastDay']) ? s['lastDay'] : '';
  const current = isNum(s['current']) ? Math.max(0, Math.floor(s['current'])) : 0;
  const longest = isNum(s['longest']) ? Math.max(0, Math.floor(s['longest'])) : 0;
  return { current, longest: Math.max(longest, current), lastDay };
}

function parseMap<T>(raw: unknown, pick: (value: unknown) => T | undefined): Record<string, T> {
  const out: Record<string, T> = {};
  if (!isRecord(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const parsed = pick(value);
    if (parsed !== undefined) out[key] = parsed;
  }
  return out;
}

/**
 * Field-by-field validation of a current-version state. Anything that does
 * not parse is dropped (a bad card) or replaced by its default (bad settings);
 * nothing here throws. Partial settings keep the defaults for missing fields —
 * a file with only `{seconds: 30}` must not blank `maxLevel`.
 */
export function parseProgress(raw: unknown): ProgressState {
  const r = isRecord(raw) ? raw : {};
  const activity = parseMap(r['activity'], parseDay);
  for (const day of Object.keys(activity)) if (!DAY_KEY.test(day)) delete activity[day];
  return {
    version: 2,
    steps: parseMap(r['steps'], (v) => (isNum(v) ? v : undefined)),
    notes: parseMap(r['notes'], (v) => (typeof v === 'string' && v.trim() ? v : undefined)),
    cards: parseMap(r['cards'], parseCard),
    sessions: Array.isArray(r['sessions'])
      ? r['sessions'].map(parseSession).filter((s): s is SessionRecord => s !== undefined).slice(-500)
      : [],
    streak: parseStreak(r['streak']),
    settings: parseSettings(r['settings']),
    saved: parseMap(r['saved'], (v) => (isNum(v) ? v : undefined)),
    activity,
  };
}

// ----------------------------------------------------------- migration

/**
 * v1 step keys (`stage/module/index`) -> v2 keys (`module/kind:target`),
 * generated once from the roadmap v1 shipped with and frozen. It is data
 * about the past: never regenerate it from a newer roadmap.
 */
const LEGACY: Readonly<Record<string, string>> = LEGACY_STEP_KEYS;

function addDay(activity: Record<string, DayActivity>, at: number, patch: Partial<DayActivity>): void {
  const day = dayKey(at);
  const prev = activity[day] ?? { cards: 0, correct: 0, newCards: 0, steps: 0 };
  activity[day] = {
    cards: prev.cards + (patch.cards ?? 0),
    correct: prev.correct + (patch.correct ?? 0),
    newCards: prev.newCards + (patch.newCards ?? 0),
    steps: prev.steps + (patch.steps ?? 0),
  };
}

/**
 * Bring an older payload up to the current shape. Shape-only: it needs no
 * content, so it can run in read() before anything has been fetched.
 *
 * v1 -> v2:
 *  - step ticks are rekeyed through the frozen legacy table. A key the table
 *    does not know is kept verbatim — never delete a tick: nothing renders it,
 *    but it survives export/import (the raw v1 payload is also backed up — see
 *    read()). Timestamps are kept; if two old keys land on one new key, the
 *    later tick wins.
 *  - notes were keyed `stage/module`; they are keyed by module now, so a
 *    module that moves stage keeps its note. On a collision the longer note wins.
 *  - activity is backfilled from what v1 recorded: session answer counts and
 *    step tick days. v1 never recorded first sightings, so newCards stays 0.
 */
export function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw['version'] !== 1) return raw;

  const steps: Record<string, number> = {};
  if (isRecord(raw['steps'])) {
    for (const [oldKey, at] of Object.entries(raw['steps'])) {
      if (!isNum(at)) continue;
      const newKey = LEGACY[oldKey] ?? oldKey;
      steps[newKey] = Math.max(steps[newKey] ?? 0, at);
    }
  }

  const notes: Record<string, string> = {};
  if (isRecord(raw['notes'])) {
    for (const [oldKey, text] of Object.entries(raw['notes'])) {
      if (typeof text !== 'string') continue;
      const moduleId = oldKey.slice(oldKey.indexOf('/') + 1);
      if ((notes[moduleId] ?? '').length < text.length) notes[moduleId] = text;
    }
  }

  const activity: Record<string, DayActivity> = {};
  if (Array.isArray(raw['sessions'])) {
    for (const session of raw['sessions']) {
      const parsed = parseSession(session);
      if (parsed) addDay(activity, parsed.at, { cards: parsed.asked, correct: parsed.correct });
    }
  }
  for (const at of Object.values(steps)) addDay(activity, at, { steps: 1 });

  return { ...raw, version: 2, steps, notes, activity, saved: {} };
}

/** Parse an exported file. Throws a message fit for the Settings page. */
export function parseImport(json: string): ProgressState {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (!isRecord(raw) || !isNum(raw['version'])) throw new Error('Unrecognised progress file');
  if (raw['version'] > CURRENT_VERSION) throw new Error('This file was made by a newer DevPath.');
  if (raw['version'] < 1) throw new Error('Unrecognised progress file');
  return parseProgress(migrate(raw));
}

// --------------------------------------------------------------- store

let persisted = true;

function read(): ProgressState {
  if (typeof localStorage === 'undefined') return emptyProgress();
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    persisted = false;
    return emptyProgress();
  }
  if (!raw) return emptyProgress();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    if (!isRecord(parsed)) throw new Error('not an object');
  } catch {
    // Unreadable. Keep a copy before anything overwrites it, so a bug here
    // costs the user a manual restore rather than their history.
    try {
      localStorage.setItem(`devpath.progress.corrupt-${Date.now()}`, raw);
    } catch {
      /* nothing more we can do */
    }
    return emptyProgress();
  }

  if (parsed['version'] === 1) {
    const next = parseProgress(migrate(parsed));
    try {
      // The untouched v1 payload stays around as the rollback path, and the
      // migrated state is written straight back so a reload doesn't migrate
      // (or back up) again.
      if (localStorage.getItem(V1_BACKUP_KEY) === null) localStorage.setItem(V1_BACKUP_KEY, raw);
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* the in-memory state is still right; the next commit retries the write */
    }
    return next;
  }
  return parseProgress(parsed);
}

let state: ProgressState = read();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function commit(next: ProgressState): void {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    persisted = true;
  } catch {
    // Private mode, quota, or a browser blocking site data. The session still
    // works; Layout shows a one-line warning so nobody trusts a streak that
    // is not being saved.
    persisted = false;
  }
  notify();
}

// Another tab wrote progress. Without this, each tab keeps its own copy and
// the last one to write wins for the WHOLE object — tab A's drill answers
// would silently erase tab B's step ticks.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key !== KEY && event.key !== null) return;
    state = read();
    notify();
  });
}

export const progressStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): ProgressState {
    return state;
  },
  /** False when the last write to localStorage failed. */
  isPersisted(): boolean {
    return persisted;
  },
  /** Test seam: swap the whole state (defaults to empty) and notify. */
  replaceForTests(next: ProgressState = emptyProgress()): void {
    commit(next);
  },
  /** Test seam: re-read storage as if the page had just loaded. */
  reloadForTests(): void {
    state = read();
    notify();
  },
};

// ---------------------------------------------------------------- days

/** Local calendar day, so a streak rolls over at the user's midnight. */
export function dayKey(at: number | Date = Date.now()): string {
  const d = at instanceof Date ? at : new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whole calendar days from a to b. UTC maths on the date parts, so DST can't skew it. */
export function daysBetween(a: string, b: string): number {
  const toMs = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((toMs(b) - toMs(a)) / 86_400_000);
}

/** The streak after activity on `day`. */
export function advanceStreak(streak: Streak, day: string): Streak {
  if (streak.lastDay === day) return streak;
  const gap = streak.lastDay ? daysBetween(streak.lastDay, day) : Infinity;
  // gap < 0 means the clock went backwards; start over rather than guess.
  const current = gap === 1 ? streak.current + 1 : 1;
  return { current, longest: Math.max(current, streak.longest), lastDay: day };
}

/**
 * The streak as it should be SHOWN on `day`. Stored `current` only changes on
 * activity, so someone who stopped ten days ago still has current = 12 in
 * storage; the display must say 0. Storage is corrected by the next activity.
 */
export function currentStreak(streak: Streak, day: string): number {
  if (!streak.lastDay) return 0;
  const gap = daysBetween(streak.lastDay, day);
  return gap === 0 || gap === 1 ? streak.current : 0;
}

function withActivity(at: number, patch: Partial<DayActivity>): Record<string, DayActivity> {
  const activity = { ...state.activity };
  addDay(activity, at, patch);
  return activity;
}

// ---------------------------------------------------------------- steps

/**
 * Tick or untick path steps. Unticking does not subtract from the activity
 * log: that log is history, and the tick did happen.
 */
export function setStepsDone(keys: string[], done: boolean): void {
  const now = Date.now();
  const steps = { ...state.steps };
  const changed = keys.filter((key) => Boolean(steps[key]) !== done);
  if (changed.length === 0) return;
  for (const key of changed) {
    if (done) steps[key] = now;
    else delete steps[key];
  }
  commit({
    ...state,
    steps,
    streak: done ? advanceStreak(state.streak, dayKey(now)) : state.streak,
    activity: done ? withActivity(now, { steps: changed.length }) : state.activity,
  });
}

export function setStepDone(key: string, done: boolean): void {
  setStepsDone([key], done);
}

export function setNote(moduleKey: string, text: string): void {
  const current = state.notes[moduleKey] ?? '';
  const next = text.trim() ? text : '';
  if (current === next) return;
  const notes = { ...state.notes };
  if (next) notes[moduleKey] = next;
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
 * Pure: the store wrapper below supplies `now`.
 */
export function scheduleCard(
  prev: Card | undefined,
  correct: boolean,
  elapsedMs: number,
  now: number,
): Card {
  const base = prev ?? blankCard();
  const quick = elapsedMs < 8000;
  let { ease, interval, reps, lapses } = base;

  if (correct) {
    const quality = quick ? 5 : 3.5;
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

  return {
    ease,
    interval,
    // interval 0 means "due now": the next drill serves it first.
    due: now + interval * DAY,
    reps,
    lapses,
    seen: base.seen + 1,
    correct: base.correct + (correct ? 1 : 0),
    lastSeen: now,
  };
}

export function gradeCard(id: string, correct: boolean, elapsedMs: number): void {
  const now = Date.now();
  const prev = state.cards[id];
  const card = scheduleCard(prev, correct, elapsedMs, now);
  commit({
    ...state,
    cards: { ...state.cards, [id]: card },
    // An answered question is practice even if the session is abandoned.
    streak: advanceStreak(state.streak, dayKey(now)),
    activity: withActivity(now, { cards: 1, correct: correct ? 1 : 0, newCards: prev ? 0 : 1 }),
  });
}

export function recordSession(record: SessionRecord): void {
  const sessions = [...state.sessions, record].slice(-500);
  commit({ ...state, sessions, streak: advanceStreak(state.streak, dayKey(record.at)) });
}

/** Star or unstar a question for later. */
export function toggleSaved(id: string): void {
  const saved = { ...state.saved };
  if (saved[id]) delete saved[id];
  else saved[id] = Date.now();
  commit({ ...state, saved });
}

export function updateSettings(patch: Partial<Settings>): void {
  commit({ ...state, settings: parseSettings({ ...state.settings, ...patch }) });
}

/**
 * Erase ticks, notes, cards, sessions, saved questions, activity and the
 * streak. Drill settings are kept on purpose: they describe how you like to
 * practise, not what you did.
 */
export function resetAll(): void {
  commit({ ...emptyProgress(), settings: state.settings });
}

export function exportState(): string {
  return JSON.stringify(state, null, 2);
}

/** Replace everything with an already-parsed state (see parseImport). */
export function replaceState(next: ProgressState): void {
  commit(parseProgress(next));
}

export function importState(json: string): void {
  commit(parseImport(json));
}
