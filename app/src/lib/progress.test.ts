/**
 * Progress store: parsing, import, SM-2 scheduling and streak maths.
 * Everything here is pure; no DOM, no storage.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceStreak,
  currentStreak,
  daysBetween,
  emptyProgress,
  migrate,
  parseImport,
  parseProgress,
  scheduleCard,
} from './progress.ts';

const DAY = 86_400_000;

// ---------------------------------------------------------------- parsing

test('import with partial settings keeps the defaults for the rest (maxLevel stays 3)', () => {
  const state = parseImport(JSON.stringify({ version: 1, settings: { seconds: 30 } }));
  assert.equal(state.settings.seconds, 30);
  assert.equal(state.settings.maxLevel, 3, 'a missing maxLevel must not become undefined');
  assert.equal(state.settings.explain, true);
});

test('parseProgress never throws on garbage and falls back to empty', () => {
  for (const raw of [null, undefined, 42, 'x', [], [1, 2], { steps: [] }, { cards: 'no' }]) {
    const state = parseProgress(raw);
    assert.deepEqual(state.steps, {});
    assert.deepEqual(state.cards, {});
    assert.equal(state.settings.maxLevel, 3);
  }
});

test('parseProgress clamps settings and drops malformed cards individually', () => {
  const good = { ease: 2.5, interval: 1, due: 5, reps: 1, lapses: 0, seen: 1, correct: 1, lastSeen: 5 };
  const state = parseProgress({
    settings: { seconds: -1, maxLevel: 9, explain: 'yes' },
    cards: { ok: good, bad: { ...good, due: 'tomorrow' }, worse: null },
    steps: { a: 1, b: 'x' },
    sessions: [{ at: 1, deck: 'd', asked: 2, correct: 5, ms: 10 }, { at: 'x' }],
  });
  assert.equal(state.settings.seconds, 0);
  assert.equal(state.settings.maxLevel, 3);
  assert.equal(state.settings.explain, true);
  assert.deepEqual(Object.keys(state.cards), ['ok']);
  assert.deepEqual(state.steps, { a: 1 });
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0]?.correct, 2, 'correct is clamped to asked');
});

test('parseImport rejects non-progress files with a readable message', () => {
  assert.throws(() => parseImport('not json'), /not valid JSON/);
  assert.throws(() => parseImport('{"hello": 1}'), /Unrecognised progress file/);
  assert.throws(() => parseImport('[1,2]'), /Unrecognised progress file/);
  assert.throws(() => parseImport('{"version": 99}'), /newer DevPath/);
});

test('export then import is lossless at v2', () => {
  const state = emptyProgress();
  state.steps['m/build:x'] = 123;
  state.notes['m'] = 'hello';
  state.cards['q1'] = scheduleCard(undefined, true, 1000, 1_000_000);
  state.sessions.push({ at: 5, deck: 'mixed', asked: 3, correct: 2, ms: 900 });
  state.streak = { current: 2, longest: 4, lastDay: '2026-09-22' };
  state.settings = { seconds: 20, maxLevel: 2, explain: false, newPerDay: 5 };
  state.saved['q1'] = 7;
  state.activity['2026-09-22'] = { cards: 3, correct: 2, newCards: 1, steps: 1 };
  state.sessions.push({ at: 6, deck: 'mixed', asked: 40, correct: 30, ms: 1, mode: 'mock', step: 'm-x/drill:mixed' });
  assert.deepEqual(parseImport(JSON.stringify(state)), state);
});

// ------------------------------------------------------------------ SM-2

test('scheduleCard: first quick correct → 1 day, then 3, then interval × ease', () => {
  const now = 1_000_000;
  const one = scheduleCard(undefined, true, 1000, now);
  assert.equal(one.interval, 1);
  assert.equal(one.reps, 1);
  assert.equal(one.ease, 2.6);
  assert.equal(one.due, now + DAY);
  const two = scheduleCard(one, true, 1000, now);
  assert.equal(two.interval, 3);
  const three = scheduleCard({ ...two, ease: 2.7 }, true, 1000, now);
  assert.equal(three.interval, Math.round(3 * 2.7));
  assert.equal(three.seen, 3);
  assert.equal(three.correct, 3);
});

test('scheduleCard: a slow correct (≥8s, boundary included) lowers ease slightly', () => {
  const slow = scheduleCard(undefined, true, 8000, 0);
  assert.ok(Math.abs(slow.ease - (2.5 - 0.065)) < 1e-9, String(slow.ease));
});

test('scheduleCard: wrong resets reps and interval, counts a lapse, floors ease at 1.3', () => {
  let card = scheduleCard(undefined, false, 1000, 0);
  assert.equal(card.reps, 0);
  assert.equal(card.interval, 0);
  assert.equal(card.lapses, 1);
  assert.equal(card.ease, 2.3);
  for (let i = 0; i < 10; i++) card = scheduleCard(card, false, 1000, 0);
  assert.equal(card.ease, 1.3);
  assert.equal(card.correct, 0);
});

// ---------------------------------------------------------------- streaks

const s = (current: number, lastDay: string, longest = current) => ({ current, longest, lastDay });

test('advanceStreak: same day, next day, gap, first ever', () => {
  assert.deepEqual(advanceStreak(s(3, '2026-09-22'), '2026-09-22'), s(3, '2026-09-22'));
  assert.deepEqual(advanceStreak(s(3, '2026-09-22'), '2026-09-23'), s(4, '2026-09-23'));
  assert.deepEqual(advanceStreak(s(3, '2026-09-20', 5), '2026-09-23'), s(1, '2026-09-23', 5));
  assert.deepEqual(advanceStreak(s(0, ''), '2026-09-23'), s(1, '2026-09-23'));
});

test('advanceStreak: DST and year rollover count as one day; a clock moved back restarts', () => {
  assert.equal(daysBetween('2026-03-08', '2026-03-09'), 1);
  assert.equal(daysBetween('2026-10-25', '2026-10-26'), 1);
  assert.equal(advanceStreak(s(9, '2026-12-31'), '2027-01-01').current, 10);
  assert.equal(advanceStreak(s(9, '2026-09-23'), '2026-09-20').current, 1);
});

test('currentStreak shows 0 once a day has been missed, and leaves storage alone', () => {
  const streak = s(12, '2026-09-10');
  assert.equal(currentStreak(streak, '2026-09-10'), 12);
  assert.equal(currentStreak(streak, '2026-09-11'), 12, 'yesterday still counts until today ends');
  assert.equal(currentStreak(streak, '2026-09-12'), 0);
  assert.equal(currentStreak(s(0, ''), '2026-09-12'), 0);
  assert.equal(streak.current, 12);
});

// -------------------------------------------------------------- migration

/** A profile as the shipped v1 app wrote it. */
const V1 = {
  version: 1,
  steps: {
    's0-basics/m-values/2': 1_700_000_000_000, // plain: same module, keyed by target
    's6-node-backend/m-rest-api/1': 1_700_000_100_000, // one of the nine re-homed steps
    'bogus/key/9': 1_700_000_200_000, // not on the v1 roadmap at all
  },
  notes: { 's0-basics/m-values': 'remember ===', 's6-node-backend/m-rest-api': 'status codes' },
  cards: {},
  sessions: [{ at: 1_700_000_000_000, deck: 'mixed', asked: 10, correct: 7, ms: 60_000 }],
  streak: { current: 1, longest: 3, lastDay: '2023-11-14' },
  settings: { seconds: 30, maxLevel: 2, explain: false },
};

test('v1 → v2 rekeys steps through the frozen map, applies overrides, keeps unknown keys verbatim', () => {
  const state = parseImport(JSON.stringify(V1));
  assert.equal(state.version, 2);
  assert.deepEqual(state.steps, {
    'm-values/build:js/01-fizzbuzz': 1_700_000_000_000,
    'm-node-crud/build:js/65-rest-api': 1_700_000_100_000,
    'bogus/key/9': 1_700_000_200_000,
  });
});

test('v1 → v2 strips the stage from note keys and keeps settings', () => {
  const state = parseImport(JSON.stringify(V1));
  assert.deepEqual(state.notes, { 'm-values': 'remember ===', 'm-rest-api': 'status codes' });
  assert.equal(state.settings.seconds, 30);
  assert.equal(state.settings.maxLevel, 2);
  assert.equal(state.settings.newPerDay, 10, 'new v2 settings get their defaults');
  assert.deepEqual(state.saved, {});
});

test('v1 → v2 backfills activity with counts only, from sessions and step days', () => {
  const state = parseImport(JSON.stringify(V1));
  const total = Object.values(state.activity).reduce(
    (sum, day) => ({
      cards: sum.cards + day.cards,
      correct: sum.correct + day.correct,
      newCards: sum.newCards + day.newCards,
      steps: sum.steps + day.steps,
    }),
    { cards: 0, correct: 0, newCards: 0, steps: 0 },
  );
  // Three v1 ticks, including the unknown one that is kept verbatim.
  assert.deepEqual(total, { cards: 10, correct: 7, newCards: 0, steps: 3 });
  assert.ok(Object.keys(state.activity).every((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)));
});

test('migrate drops ticks with a bad timestamp and leaves a v2 payload untouched', () => {
  const out = migrate({
    version: 1,
    steps: { 's0-basics/m-values/2': 5, 's0-basics/m-values/3': 9, 'x/y/1': 'bad' },
  }) as { steps: Record<string, number> };
  assert.deepEqual(out.steps, { 'm-values/build:js/01-fizzbuzz': 5, 'm-values/build:js/03-rot13': 9 });

  const v2 = { version: 2, steps: { 'bogus/key/9': 1 } };
  assert.equal(migrate(v2), v2, 'a current payload is not rewritten');
});
