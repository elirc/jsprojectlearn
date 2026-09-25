/**
 * The Guides index at real scale (~190 guides): grouping, filtering, hiding
 * read guides. Its own suite so it gets a fresh jsdom app rather than one
 * that has already carried a dozen drill sessions.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './testing/harness.ts';
import type { Harness } from './testing/harness.ts';
import { stepKey } from './lib/types.ts';

let app: Harness;
const howTo = { kind: 'guide', guide: 'how-to-use-devpath', title: '', minutes: 10 } as const;
const card = () => app.$(`a.card[href="#/guide/${howTo.guide}"]`);

before(async () => {
  app = await boot();
});

after(() => app?.close());

test('guides are grouped by the stage that first schedules them, in path order', async () => {
  await app.goto('#/guides');
  const headings = app.$$('section h2').map((h) => h.textContent ?? '');
  assert.ok(headings[0]?.startsWith('Programming, actually'), `first group is the first stage, got ${headings[0]}`);
  assert.ok(headings.length > 5, 'guides are spread over several stage groups');
  assert.ok(card(), 'the first scheduled guide has a card');
});

test('the text filter narrows the list and says so when nothing matches', async () => {
  await app.goto('#/guides?q=How%20this%20path');
  assert.ok(card(), 'the matching guide is still shown');
  assert.ok(app.$$('a.card').length < 10, 'most guides are filtered out');

  await app.goto('#/guides?q=zzzz-no-such-guide');
  assert.match(app.text(), /No guide matches that filter/);
});

test('Hide read removes a guide once its path step is ticked', async () => {
  await app.goto('#/guides?unread=1');
  assert.ok(card(), 'unread guides are shown');

  await app.act(() => app.progress.setStepDone(stepKey('m-values', howTo), true));
  assert.equal(card(), null, 'the read guide is hidden');

  await app.goto('#/guides');
  assert.match(card()?.textContent ?? '', /✓ Read/, 'without the toggle it is back, marked read');
});
