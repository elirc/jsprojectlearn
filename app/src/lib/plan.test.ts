/** Today's plan, drill modes and the search index. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { heatLevel, heatmapCells, interleave, REVIEW_CAP, todayPlan, unlockedDecks } from './plan.ts';
import { dayKey, emptyProgress } from './progress.ts';
import type { Card } from './progress.ts';
import { buildSearch, hrefFor, searchRows } from './search.ts';
import { buildMock, parseDrillParams, selectDrill } from './session.ts';
import type { Content, Question, Roadmap, SearchRow } from './types.ts';

const DAY = 86_400_000;
const NOW = new Date(2026, 8, 24, 12).getTime();

const q = (id: string, patch: Partial<Question> = {}): Question => ({
  id,
  q: `${id}?`,
  choices: ['a', 'b'],
  answer: 0,
  why: 'w',
  level: 1,
  deck: 'd0',
  topic: 'T0',
  ...patch,
});
const card = (patch: Partial<Card> = {}): Card => ({
  ease: 2.5,
  interval: 1,
  due: NOW - DAY,
  reps: 1,
  lapses: 0,
  seen: 1,
  correct: 1,
  lastSeen: NOW - 2 * DAY,
  ...patch,
});

/** Stage 0 drills d0; stage 1 drills d1. */
const roadmap = {
  stages: [
    {
      id: 's0',
      level: 0,
      title: 'S0',
      modules: [
        {
          id: 'm0',
          steps: [
            { kind: 'build', project: 'p0', title: 'B0', minutes: 30 },
            { kind: 'drill', deck: 'd0', count: 5, title: 'D0' },
          ],
        },
      ],
    },
    { id: 's1', level: 1, title: 'S1', modules: [{ id: 'm1', steps: [{ kind: 'drill', deck: 'd1', count: 5, title: 'D1' }] }] },
  ],
} as unknown as Roadmap;

test('unseen questions are new, never due; decks unlock with the stage you are on', () => {
  const pool = [q('a'), q('b', { deck: 'd1', topic: 'T1' })];
  const plan = todayPlan(roadmap, pool, emptyProgress(), NOW);
  assert.equal(plan.reviews.length, 0, 'nothing seen, nothing due');
  assert.deepEqual(plan.fresh.map((x) => x.id), ['a'], 'd1 belongs to a later stage');
  assert.deepEqual([...unlockedDecks(roadmap, emptyProgress(), pool)], ['d0']);

  const progress = emptyProgress();
  progress.cards['b'] = card({ due: NOW + DAY });
  assert.ok(unlockedDecks(roadmap, progress, pool).has('d1'), 'a practised deck counts as reached');
});

test(`reviews are capped at ${REVIEW_CAP}, most overdue first, within the ceiling`, () => {
  const pool = Array.from({ length: 40 }, (_, i) => q(`r${i}`));
  pool.push(q('deep', { level: 3 }));
  const progress = emptyProgress();
  progress.settings.maxLevel = 2;
  pool.forEach((x, i) => (progress.cards[x.id] = card({ due: NOW - i * DAY })));
  const plan = todayPlan(roadmap, pool, progress, NOW);
  assert.equal(plan.reviews.length, REVIEW_CAP);
  assert.equal(plan.reviewsDue, 40, 'the ★★★ card is above the ceiling');
  // Overdue-ness saturates at 30 days, so anything a month late ties for first.
  assert.ok(Number(plan.reviews[0]?.id.slice(1)) >= 30, 'most overdue first');
});

test('new questions per day subtract what today already introduced', () => {
  const pool = Array.from({ length: 20 }, (_, i) => q(`n${i}`, { level: ((i % 3) + 1) as 1 | 2 | 3 }));
  const progress = emptyProgress();
  progress.settings.newPerDay = 6;
  assert.equal(todayPlan(roadmap, pool, progress, NOW).fresh.length, 6);
  progress.activity[dayKey(NOW)] = { cards: 4, correct: 4, newCards: 4, steps: 0 };
  const plan = todayPlan(roadmap, pool, progress, NOW);
  assert.equal(plan.fresh.length, 2);
  assert.deepEqual(plan.fresh.map((x) => x.level), [1, 1], 'easier first');
});

test('awayDays counts from the last active day; 0 when active today', () => {
  const progress = emptyProgress();
  assert.equal(todayPlan(roadmap, [], progress, NOW).awayDays, 0);
  progress.activity[dayKey(NOW - 6 * DAY)] = { cards: 1, correct: 1, newCards: 0, steps: 0 };
  assert.equal(todayPlan(roadmap, [], progress, NOW).awayDays, 6);
  progress.activity[dayKey(NOW)] = { cards: 1, correct: 1, newCards: 0, steps: 0 };
  assert.equal(todayPlan(roadmap, [], progress, NOW).awayDays, 0);
});

test('interleave deals three reviews to one new and appends leftovers', () => {
  assert.deepEqual(interleave(['r1', 'r2', 'r3', 'r4'], ['n1', 'n2', 'n3']), ['r1', 'r2', 'r3', 'n1', 'r4', 'n2', 'n3']);
});

test('modes: due is seen-and-due, new is unseen, missed is last-answer-wrong, saved is starred', () => {
  const pool = [q('due'), q('later'), q('fresh'), q('miss')];
  const progress = emptyProgress();
  progress.cards['due'] = card();
  progress.cards['later'] = card({ due: NOW + DAY });
  progress.cards['miss'] = card({ reps: 0, lapses: 1, due: NOW + DAY });
  progress.saved['later'] = 1;
  const ids = (search: string) =>
    selectDrill(pool, progress, parseDrillParams(search), NOW)
      .map((x) => x.id)
      .sort();
  assert.deepEqual(ids('mode=due'), ['due']);
  assert.deepEqual(ids('mode=new'), ['fresh']);
  assert.deepEqual(ids('mode=missed'), ['miss']);
  assert.deepEqual(ids('mode=saved'), ['later']);
});

test('a mock deals across topics before repeating one', () => {
  const pool = ['A', 'B', 'C', 'D'].flatMap((topic) =>
    Array.from({ length: 10 }, (_, i) => q(`${topic}${i}`, { topic })),
  );
  const mock = buildMock(pool, 8);
  assert.equal(mock.length, 8);
  for (const topic of ['A', 'B', 'C', 'D']) {
    assert.equal(mock.filter((x) => x.topic === topic).length, 2, `${topic} gets its share`);
  }
});

const content = {
  roadmap: { stages: [{ id: 's0', level: 0, title: 'Programming', tagline: 't', goal: 'g', modules: [] }] },
  guides: [
    {
      id: 'http-fundamentals',
      title: 'HTTP',
      blurb: 'b',
      words: 1,
      // As build-content emits it: the id comes from the renderer's slugger.
      headings: [{ id: 'idempotency-safe-methods-2', text: 'Idempotency & safe methods' }],
    },
  ],
  search: [
    { kind: 'module', id: 's0/m-values', title: 'Values', sub: 'S0', text: '' },
    { kind: 'project', id: 'js/01-fizzbuzz', title: 'FizzBuzz', sub: 'js', text: '' },
  ],
} as unknown as Content;

const first = (index: SearchRow[], query: string, kind?: SearchRow['kind']): SearchRow => {
  const row = searchRows(index, query)
    .flatMap((g) => g.rows)
    .find((r) => !kind || r.kind === kind);
  assert.ok(row, `a hit for "${query}"`);
  return row;
};

test('search covers pages, stages, guides and guide sections, with router paths', () => {
  const index = buildSearch(content);
  const heading = first(index, 'idempotency', 'heading');
  assert.equal(
    hrefFor(heading),
    '/guide/http-fundamentals#idempotency-safe-methods-2',
    'the id from the build is used as-is, dedupe suffix included',
  );
  assert.equal(hrefFor(first(index, 'settings', 'page')), '/settings');
  assert.equal(hrefFor(first(index, 'programming', 'stage')), '/path/s0');
  assert.equal(hrefFor(first(index, 'values', 'module')), '/path/s0#m-values', 'module hits land on the module');
});

test('search caps each kind and groups results in a fixed order', () => {
  const many = {
    ...content,
    guides: [
      {
        id: 'g',
        title: 'Guide',
        blurb: '',
        words: 1,
        headings: Array.from({ length: 20 }, (_, i) => ({ id: `section-${i}`, text: `Section ${i}` })),
      },
    ],
  } as unknown as Content;
  const groups = searchRows(buildSearch(many), 'section');
  assert.equal(groups.find((g) => g.label === 'Sections')?.rows.length, 5);
  assert.deepEqual(searchRows(buildSearch(many), ''), []);
});

test('heatmap: 84 Monday-first cells ending in the current week, intensity by work', () => {
  const now = new Date(2026, 8, 24, 9).getTime(); // a Thursday
  const activity = {
    [dayKey(now)]: { cards: 12, correct: 10, newCards: 0, steps: 0 },
    [dayKey(now - DAY)]: { cards: 0, correct: 0, newCards: 0, steps: 6 },
  };
  const cells = heatmapCells(activity, now);
  assert.equal(cells.length, 84);
  assert.equal(new Date(`${cells[0]?.day}T12:00`).getDay(), 1, 'the first cell is a Monday');
  const today = cells.find((c) => c.day === dayKey(now));
  assert.equal(today?.week, 11);
  assert.equal(today?.weekday, 3);
  assert.equal(today?.level, 2);
  assert.equal(cells.find((c) => c.day === dayKey(now - DAY))?.level, 4);
  assert.equal(cells.filter((c) => c.future).length, 3, 'Fri, Sat, Sun are still to come');
  assert.deepEqual([0, 1, 10, 11, 25, 26, 51].map((n) => heatLevel(n, 0)), [0, 1, 1, 2, 2, 3, 4]);
});
