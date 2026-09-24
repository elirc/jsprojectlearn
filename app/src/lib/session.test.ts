/** Drill URL grammar, selection and due/new counting. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyProgress } from './progress.ts';
import type { Card } from './progress.ts';
import { dueSummary, emptyReason, parseDrillParams, selectDrill } from './session.ts';
import type { Question } from './types.ts';

const q = (id: string, patch: Partial<Question> = {}): Question => ({
  id,
  q: `${id}?`,
  choices: ['a', 'b'],
  answer: 0,
  why: 'w',
  level: 1,
  deck: 'd',
  topic: 'JavaScript',
  ...patch,
});

const card = (patch: Partial<Card>): Card => ({
  ease: 2.5, interval: 1, due: 0, reps: 1, lapses: 0, seen: 1, correct: 1, lastSeen: 0, ...patch,
});

test('parseDrillParams clamps count: abc → default, 0/-5 → 1, 999 → 60', () => {
  assert.equal(parseDrillParams('count=abc').count, 15);
  assert.equal(parseDrillParams('').count, 15);
  assert.equal(parseDrillParams('count=').count, 15);
  assert.equal(parseDrillParams('count=0').count, 1);
  assert.equal(parseDrillParams('count=-5').count, 1);
  assert.equal(parseDrillParams('count=999').count, 60);
  assert.equal(parseDrillParams('count=7.9').count, 7);
});

test('parseDrillParams: modes, legacy due=1, exact level, ids order, tags', () => {
  assert.equal(parseDrillParams('due=1').mode, 'today', 'legacy ?due=1 meant "what is due today"');
  assert.equal(parseDrillParams('mode=due').mode, 'due');
  assert.equal(parseDrillParams('mode=new').mode, 'new');
  assert.equal(parseDrillParams('mode=saved').mode, 'saved');
  assert.equal(parseDrillParams('mode=missed').mode, 'missed');
  assert.equal(parseDrillParams('mode=bogus').mode, 'practice');
  assert.equal(parseDrillParams('mode=mock').count, 40);
  assert.equal(parseDrillParams('level=2').level, 2);
  assert.equal(parseDrillParams('level=7').level, undefined);
  assert.deepEqual(parseDrillParams('ids=c,a,,b').ids, ['c', 'a', 'b']);
  assert.deepEqual(parseDrillParams('tags=strings%2Cloops').tags, ['strings', 'loops']);
});

test('topic filter is case-insensitive', () => {
  const pool = [q('a'), q('b', { topic: 'SQL & data' })];
  const picked = selectDrill(pool, emptyProgress(), parseDrillParams('topic=javascript'), Date.now());
  assert.deepEqual(picked.map((x) => x.id), ['a']);
});

test('an exact level overrides the ceiling; the ceiling applies otherwise', () => {
  const pool = [q('one', { level: 1 }), q('three', { level: 3 })];
  const progress = emptyProgress();
  progress.settings.maxLevel = 1;
  assert.deepEqual(selectDrill(pool, progress, parseDrillParams(''), 0).map((x) => x.id), ['one']);
  assert.deepEqual(selectDrill(pool, progress, parseDrillParams('level=3'), 0).map((x) => x.id), ['three']);
});

test('tags narrow the pool to questions carrying any of them', () => {
  const pool = [q('a', { tags: ['loops'] }), q('b', { tags: ['closures'] }), q('c')];
  const picked = selectDrill(pool, emptyProgress(), parseDrillParams('tags=loops,strings'), 0);
  assert.deepEqual(picked.map((x) => x.id), ['a']);
});

test('ids keep their order and ignore unknown ids', () => {
  const pool = [q('a'), q('b'), q('c')];
  const picked = selectDrill(pool, emptyProgress(), parseDrillParams('ids=c,zzz,a'), 0);
  assert.deepEqual(picked.map((x) => x.id), ['c', 'a']);
});

test('emptyReason tells an unknown topic, missing tags and the ceiling apart from nothing due', () => {
  const pool = [q('a', { level: 3, tags: ['x'] })];
  assert.equal(emptyReason(pool, parseDrillParams('topic=cobol'), 3), 'unknown-topic');
  assert.equal(emptyReason(pool, parseDrillParams('tags=nope'), 3), 'no-tags');
  assert.equal(emptyReason(pool, parseDrillParams(''), 1), 'ceiling');
  assert.equal(emptyReason(pool, parseDrillParams(''), 3), 'nothing-due');
});

test('dueSummary: unseen is new, seen-and-due is due, both within the ceiling', () => {
  const now = 1_000_000;
  const pool = [q('new1'), q('due1'), q('later'), q('due3', { level: 3 }), q('new3', { level: 3 })];
  const cards = {
    due1: card({ due: now - 1 }),
    later: card({ due: now + 1 }),
    due3: card({ due: now - 1 }),
  };
  assert.deepEqual(dueSummary(pool, cards, now, 3), { due: 2, fresh: 2 });
  assert.deepEqual(dueSummary(pool, cards, now, 1), { due: 1, fresh: 1 });
  assert.deepEqual(dueSummary(pool, cards, now + 2, 1), { due: 2, fresh: 1 }, 'time moves due forward');
});
