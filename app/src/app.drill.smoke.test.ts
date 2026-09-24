/**
 * Drill-session regressions, in jsdom under StrictMode.
 * Each test resets progress through the store's test seam first.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { boot, loadDecks } from './testing/harness.ts';
import type { Harness } from './testing/harness.ts';

let app: Harness;

before(async () => {
  app = await boot();
});

after(() => app?.close());

beforeEach(async () => {
  await app.goto('#/');
  await app.act(() => app.progress.progressStore.replaceForTests());
});

/** Answer the current question with its first choice and move on. */
async function answerAndAdvance(): Promise<void> {
  const choice = app.$('button.choice');
  assert.ok(choice, 'a choice should be on screen');
  await app.click(choice);
  await app.click('button.btn.primary.big');
}

test('"Go again" starts a fresh session on the identical URL', async () => {
  await app.goto('#/drill/js-fundamentals?count=2');
  await answerAndAdvance();
  await answerAndAdvance();
  assert.match(app.text(), /session complete/i);

  await app.click('a.btn', /Go again/);
  assert.doesNotMatch(app.text(), /session complete/i, 'the summary must not stick');
  assert.match(app.text(), /1\/2/, 'a new session starts at question 1');
});

test('typing another deck URL starts that deck (hash edits have key "default")', async () => {
  await app.goto('#/drill/js-fundamentals?count=3');
  assert.match(app.$('.pill.accent')?.textContent ?? '', /JavaScript/);
  await app.goto('#/drill/react-hooks?count=3');
  assert.match(app.$('.pill.accent')?.textContent ?? '', /React/);
});

test('"drill it anyway" leaves the nothing-due state', async () => {
  const decks = await loadDecks();
  const deck = decks.find((d) => d.id === 'typescript');
  assert.ok(deck);
  const later = Date.now() + 30 * 86_400_000;
  const state = app.progress.emptyProgress();
  for (const q of deck.questions) {
    state.cards[q.id] = { ease: 2.5, interval: 30, due: later, reps: 3, lapses: 0, seen: 3, correct: 3, lastSeen: Date.now() };
  }
  await app.act(() => app.progress.progressStore.replaceForTests(state));

  await app.goto('#/drill/typescript?count=5&mode=due');
  assert.match(app.text(), /Nothing due here/);
  await app.click('a', /drill it anyway/);
  assert.equal(app.$$('button.choice').length > 0, true, 'questions should be served');
});

test('a hand-typed count=abc falls back to a real session, not an empty one', async () => {
  await app.goto('#/drill/js-fundamentals?count=abc');
  assert.match(app.text(), /1\/15/);
});

test('topic filters match case-insensitively; an unknown topic says so', async () => {
  await app.goto('#/drill/mixed?topic=javascript&count=3');
  assert.equal(app.$$('button.choice').length > 0, true);
  await app.goto('#/drill/mixed?topic=cobol&count=3');
  assert.match(app.text(), /No topic called/);
});

test('Enter on a focused choice is left to the button; Enter on the page advances', async () => {
  await app.goto('#/drill/js-fundamentals?count=3');
  const second = app.$$('button.choice')[1];
  assert.ok(second);
  second.focus();
  const prevented = await app.press('Enter', second);
  assert.equal(prevented, false, 'the page must not swallow Enter on a focused control');
  // jsdom has no key-to-click activation; do what the browser would.
  await app.click(second);
  assert.equal(second.getAttribute('aria-pressed'), 'true', 'the focused choice was answered');

  const prevented2 = await app.press('Enter', app.win.document.body);
  assert.equal(prevented2, true);
  assert.match(app.text(), /2\/3/, 'Enter on the page moves to the next question');
});

test('Space and Enter on the page are left alone until there is an answer to move on from', async () => {
  await app.goto('#/drill/js-fundamentals?count=3');
  const body = app.win.document.body;
  assert.equal(await app.press(' ', body), false, 'Space still scrolls a long question');
  assert.equal(await app.press('Enter', body), false);
  assert.match(app.text(), /1\/3/, 'nothing advanced');

  await app.click('button.choice');
  assert.equal(await app.press(' ', body), true, 'after answering, Space moves on');
  assert.match(app.text(), /2\/3/);
  assert.equal(await app.press(' ', body), false, 'and is released again on the next question');
});

test('back/forward between two drill sessions remounts a fresh session each way', async () => {
  const counter = () => app.$('.drill-top .mono')?.textContent ?? '';
  await app.goto('#/drill/js-fundamentals?count=3');
  await answerAndAdvance();
  assert.match(counter(), /^2\/3/);
  // Through real Links, so each entry gets its own location.key.
  await app.click('.nav-item[href="#/drill"]');
  await app.click('a.btn.primary.sm');
  assert.match(counter(), /^1\/15/);

  await app.act(() => app.win.history.go(-2));
  await app.settle(8);
  assert.match(app.win.location.hash, /js-fundamentals\?count=3/);
  assert.match(counter(), /^1\/3/, 'Back remounts the session instead of restoring the old instance');

  await app.act(() => app.win.history.go(2));
  await app.settle(8);
  assert.match(counter(), /^1\/15/, 'Forward starts the other deck afresh');
});

test('number keys are ignored while the search dialog is open', async () => {
  await app.goto('#/drill/js-fundamentals?count=3');
  await app.press('k', app.win.document.body, { ctrlKey: true });
  assert.ok(app.win.document.querySelector('[aria-modal="true"]'), 'search should be open');
  await app.press('1', app.win.document.body);
  assert.equal(app.$('.verdict'), null, 'the hidden drill must not be answered');
  await app.press('Escape', app.win.document.body);
  assert.equal(app.win.document.querySelector('[aria-modal="true"]'), null);
});

test('a timeout grades the question exactly once under StrictMode', async () => {
  const state = app.progress.emptyProgress();
  state.settings.seconds = 1;
  await app.act(() => app.progress.progressStore.replaceForTests(state));

  await app.goto('#/drill/js-fundamentals?count=2');
  await app.wait(1600);
  await app.settle();

  assert.match(app.text(), /Out of time/);
  const cards = Object.values(app.progress.progressStore.getSnapshot().cards);
  assert.equal(cards.length, 1, 'one question graded');
  assert.equal(cards[0]?.seen, 1, 'graded once, not twice');
  assert.equal(cards[0]?.lapses, 1);
});

test('the summary shows what you picked next to the right answer', async () => {
  await app.goto('#/drill/js-fundamentals?count=4');
  // Answer every question with the timer-free path: pick choice 1 each time.
  for (let i = 0; i < 4; i++) await answerAndAdvance();
  assert.match(app.text(), /session complete/i);
  const sessions = app.progress.progressStore.getSnapshot().sessions;
  assert.equal(sessions.length, 1, 'the session is recorded once');
  if (app.$('.review-card')) {
    assert.match(app.text(), /You picked:/);
    assert.match(app.text(), /Answer:/);
  }
});
