/**
 * The daily loop, in jsdom under StrictMode: Today's plan, marking path steps
 * done where the work happens, drills that tick their step, mock interviews,
 * ending early, saving questions, and search.
 *
 * Only `s0-basics` / `m-values` are assumed to exist: the rest of the roadmap
 * is content and changes. Step details are read from the generated roadmap.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { boot, PUBLIC } from './testing/harness.ts';
import type { Harness } from './testing/harness.ts';
import { stepKey } from './lib/types.ts';
import type { Guide, Module, Roadmap, Step } from './lib/types.ts';

let app: Harness;
let values: Module;

const stepOf = <K extends Step['kind']>(kind: K): Extract<Step, { kind: K }> => {
  const step = values.steps.find((s) => s.kind === kind);
  assert.ok(step, `m-values should have a ${kind} step`);
  return step as Extract<Step, { kind: K }>;
};

before(async () => {
  const roadmap: Roadmap = JSON.parse(await readFile(path.join(PUBLIC, 'content', 'roadmap.json'), 'utf8'));
  const mod = roadmap.stages.find((s) => s.id === 's0-basics')?.modules.find((m) => m.id === 'm-values');
  assert.ok(mod, 's0-basics/m-values must exist');
  values = mod;
  app = await boot();
});

after(() => app?.close());

beforeEach(async () => {
  await app.goto('#/');
  await app.act(() => app.progress.progressStore.replaceForTests());
});

async function answerFirst(): Promise<void> {
  const choice = app.$('button.choice');
  assert.ok(choice, 'a choice should be on screen');
  await app.click(choice);
}

async function type(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(app.win.HTMLInputElement.prototype, 'value')?.set;
  await app.act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new app.win.Event('input', { bubbles: true }));
  });
  await app.settle(2);
}

test("Today's plan offers reviews + new questions and the next path step", async () => {
  await app.goto('#/');
  assert.match(app.text(), /Today · about \d+ minutes/);
  assert.match(app.text(), /Reviews and new questions/);
  assert.match(app.text(), /\d+ new from/);
  const start = app.find('.plan a', /Start drill/);
  assert.equal(start?.getAttribute('href'), '#/drill/mixed?mode=today');
  const nextLink = app.$$('.plan-row a').find((a) => a.getAttribute('href')?.includes('step='));
  assert.ok(nextLink, 'the next step links with ?step=');

  await app.click(start as HTMLElement);
  assert.match(app.text(), /Today's drill/);
  assert.ok(app.$$('button.choice').length > 0);
});

test('Today welcomes you back after a gap, without calling new questions due', async () => {
  const state = app.progress.emptyProgress();
  const past = Date.now() - 6 * 86_400_000;
  state.activity[app.progress.dayKey(past)] = { cards: 3, correct: 2, newCards: 3, steps: 0 };
  await app.act(() => app.progress.progressStore.replaceForTests(state));
  await app.goto('#/');
  assert.match(app.text(), /Welcome back — it's been 6 days/);
  assert.doesNotMatch(app.find('.plan-meta', /new/)?.textContent ?? '', /\bdue\b/, 'nothing seen, so nothing due');
});

test('a guide step can be marked read from the guide, then leads to the next step', async () => {
  const guide = stepOf('guide');
  const key = stepKey('m-values', guide);
  await app.goto(`#/guide/${guide.guide}?step=${encodeURIComponent(key)}`);
  const mark = app.find('.stepbar button', /Mark as read/);
  assert.ok(mark, 'the StepBar offers Mark as read');
  assert.match(app.$('.stepbar')?.textContent ?? '', /step 1 of/);
  await app.click(mark);
  assert.ok(app.progress.progressStore.getSnapshot().steps[key], 'the step is ticked');
  assert.match(app.$('.stepbar')?.textContent ?? '', /Step done/);
  const next = app.find('.stepbar a', /Next →/);
  assert.match(next?.getAttribute('href') ?? '', /step=/);

  await app.click('.stepbar button', /Undo/);
  assert.equal(app.progress.progressStore.getSnapshot().steps[key], undefined);
});

test('the Guides index marks a guide read once its path step is ticked', async () => {
  const guide = stepOf('guide');
  const card = () => app.$(`a.card[href="#/guide/${guide.guide}"]`);
  await app.goto('#/guides');
  assert.ok(card(), 'the guide has a card');
  assert.doesNotMatch(card()?.textContent ?? '', /✓ Read/);
  await app.act(() => app.progress.setStepDone(stepKey('m-values', guide), true));
  assert.match(card()?.textContent ?? '', /✓ Read/);
  assert.equal(app.$$('.pill.good').filter((p) => p.textContent === '✓ Read').length, 1, 'only that guide');
});
test('a build step is marked done from its project page', async () => {
  const build = stepOf('build');
  await app.goto(`#/project/${build.project}`);
  await app.click('.stepbar button', /Mark build done/);
  assert.ok(app.progress.progressStore.getSnapshot().steps[stepKey('m-values', build)]);
});

test('finishing a drill opened from its path step ticks the step', async () => {
  const drill = stepOf('drill');
  const key = stepKey('m-values', drill);
  await app.goto(`#/drill/${drill.deck}?count=${drill.count}&step=${encodeURIComponent(key)}`);
  const total = Number(/\d+\/(\d+)/.exec(app.$('.drill-top .mono')?.textContent ?? '')?.[1]);
  assert.ok(total > 0, 'the session has questions');
  for (let i = 0; i < total; i++) {
    await answerFirst();
    await app.click('button.btn.primary.big');
  }
  assert.ok(app.progress.progressStore.getSnapshot().steps[key], 'the drill step is done');
  assert.match(app.text(), /Path step complete/);
  assert.equal(app.progress.progressStore.getSnapshot().sessions.at(-1)?.step, key);
});

test('End finishes early with a summary and does not tick the step', async () => {
  const drill = stepOf('drill');
  const key = stepKey('m-values', drill);
  await app.goto(`#/drill/${drill.deck}?count=5&step=${encodeURIComponent(key)}`);
  await answerFirst();
  await app.click('button.btn', /^End$/);
  assert.match(app.text(), /ended early/);
  assert.match(app.text(), /\d\/1 · /);
  assert.equal(app.progress.progressStore.getSnapshot().steps[key], undefined);
  assert.equal(app.progress.progressStore.getSnapshot().sessions.length, 1);

  await app.goto('#/drill/js-fundamentals?count=5');
  await app.click('button.btn', /^End$/);
  assert.match(app.win.location.hash, /^#\/drill$/, 'ending before any answer just leaves');
});

test('S saves the question on screen; the Drills page lists it', async () => {
  await app.goto('#/drill/js-fundamentals?count=3');
  await app.press('s', app.win.document.body);
  const saved = Object.keys(app.progress.progressStore.getSnapshot().saved);
  assert.equal(saved.length, 1);
  assert.match(app.find('button.btn', /Save/)?.textContent ?? '', /★ Saved/);

  await app.goto('#/drill');
  assert.match(app.text(), /Drill saved \(1\)/);
  assert.ok(app.$('.saved-list li'), 'the saved question is listed');
});

test('a mock gives no feedback until the end, then a readiness verdict', async () => {
  await app.goto('#/drill/mixed?mode=mock&count=3');
  assert.match(app.text(), /Mock · no hints/);
  for (let i = 0; i < 3; i++) {
    await answerFirst();
    assert.equal(app.$('.verdict'), null, 'no verdict mid-mock');
    assert.equal(app.$('.choice.correct'), null, 'no colouring mid-mock');
    await app.wait(400);
    await app.settle();
  }
  assert.match(app.text(), /Every question/);
  assert.match(app.text(), /phone screen|Close\.|Not yet|Ready at ★/);
  assert.equal(app.progress.progressStore.getSnapshot().sessions.at(-1)?.mode, 'mock');
});

test('search finds a guide section, and closing returns focus to the trigger', async () => {
  const trigger = app.$('.cmd-trigger');
  assert.ok(trigger);
  trigger.focus();
  await app.click(trigger);
  const input = app.win.document.querySelector<HTMLInputElement>('[role="dialog"] input[role="combobox"]');
  assert.ok(input);
  assert.equal(app.win.document.activeElement, input, 'focus moves into the dialog');

  const guides: Guide[] = JSON.parse(await readFile(path.join(PUBLIC, 'content', 'guides.json'), 'utf8'));
  const guide = guides.find((g) => g.headings.length > 0);
  assert.ok(guide);
  await type(input, guide.headings[0]?.text ?? '');
  const option = app.win.document.querySelector('[role="listbox"] [role="option"][aria-selected="true"]');
  assert.ok(option, 'a highlighted option');
  assert.ok(app.win.document.querySelector('[role="option"][id^="cmd-opt-heading"]'), 'a section hit');

  await app.press('Escape', input);
  assert.equal(app.win.document.querySelector('[role="dialog"]'), null);
  assert.equal(app.win.document.activeElement, trigger, 'focus is back on the trigger');
});

test('/ opens search; Tab stays inside the dialog; keys typed there never reach a drill', async () => {
  await app.goto('#/drill/js-fundamentals?count=3');
  const opened = await app.press('/', app.win.document.body);
  assert.equal(opened, true, '/ is taken by the shortcut');
  const dialog = app.win.document.querySelector('[role="dialog"]');
  assert.ok(dialog, '/ opens the search dialog');
  const input = dialog.querySelector('input') as HTMLInputElement;
  assert.equal(app.win.document.activeElement, input);

  assert.equal(await app.press('Tab', input), true, 'Tab is trapped');
  assert.equal(await app.press('Tab', input, { shiftKey: true }), true, 'Shift+Tab is trapped');
  assert.equal(app.win.document.activeElement, input);

  await app.press('1', input);
  assert.equal(app.$('.verdict'), null, 'a digit typed into search does not answer the question');

  await app.click('.cmd-overlay');
  assert.equal(app.win.document.querySelector('[role="dialog"]'), null, 'clicking the overlay closes it');
});

test('a section hit lands on a heading that exists in the rendered guide', async () => {
  const guides: Guide[] = JSON.parse(await readFile(path.join(PUBLIC, 'content', 'guides.json'), 'utf8'));
  const guide = guides.find((g) => g.headings.length > 0) as Guide;
  await app.press('k', app.win.document.body, { ctrlKey: true });
  const input = app.win.document.querySelector<HTMLInputElement>('[role="dialog"] input') as HTMLInputElement;
  await type(input, guide.headings[0]?.text ?? '');
  const heading = app.win.document.querySelector<HTMLElement>('[role="option"][id^="cmd-opt-heading"]');
  assert.ok(heading);
  await app.click(heading);
  await app.settle();
  const anchor = decodeURIComponent(app.win.location.hash.split('#').at(-1) ?? '');
  assert.ok(app.win.document.getElementById(anchor), `#${anchor} should exist on the page`);
});

test('library filters live in the URL and survive a round trip to a project', async () => {
  await app.goto('#/library');
  await app.click('button.tab', /React/);
  assert.match(app.win.location.hash, /track=react/);
  await app.click('button.btn', /On the path only/);
  assert.match(app.win.location.hash, /path=1/);
  const card = app.$('a.card.link');
  assert.ok(card);
  await app.click(card);
  await app.act(() => app.win.history.back());
  await app.settle();
  assert.equal(app.$('button.tab[aria-pressed="true"]')?.textContent?.startsWith('React'), true);
  assert.equal(app.find('button.btn', /On the path only/)?.getAttribute('aria-pressed'), 'true');
});

test('progress shows a 12-week activity heatmap fed by today\'s answers', async () => {
  await app.goto('#/drill/js-fundamentals?count=2');
  await answerFirst();
  await app.goto('#/progress');
  assert.equal(app.$$('.heatmap rect[class^="hm-"]').length > 60, true);
  assert.ok(app.$('.heatmap rect.hm-today.hm-1'), "today's square shows the answer");
  assert.match(app.text(), /1 active days in the last 12 weeks/);
});
