/**
 * Navigation and state regressions: the path accordion, project tabs,
 * in-document anchors, import validation, cross-tab sync, streak display.
 */
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './testing/harness.ts';
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

const stageToggle = (title: RegExp) => app.find('button.stage-toggle', title);

test('on a deep-linked stage, other stages open and the current one collapses', async () => {
  await app.goto('#/path/s0-basics');
  const first = stageToggle(/Programming, actually/);
  const second = stageToggle(/Code that survives/);
  assert.ok(first && second);
  assert.equal(first.getAttribute('aria-expanded'), 'true');

  await app.click(second);
  assert.equal(stageToggle(/Code that survives/)?.getAttribute('aria-expanded'), 'true');
  assert.equal(stageToggle(/Programming, actually/)?.getAttribute('aria-expanded'), 'false');

  await app.click(stageToggle(/Code that survives/) as HTMLElement);
  assert.equal(stageToggle(/Code that survives/)?.getAttribute('aria-expanded'), 'false');
});

test('stage titles are real headings, not text inside a button', async () => {
  await app.goto('#/path');
  const heading = app.$('.stage-card h2');
  assert.ok(heading);
  assert.equal(heading.closest('button'), null, 'the h2 must not sit inside a button');
  assert.ok(heading.querySelector('button[aria-controls]'));
});

test('moving to another project resets to its first tab and never 404s', async () => {
  await app.goto('#/project/react/19-fetch-race');
  const fileTab = app.$$('button.tab').find((b) => /\.(html|js|jsx)$/.test(b.textContent ?? ''));
  assert.ok(fileTab, 'a source-file tab should exist');
  await app.click(fileTab);
  assert.equal(fileTab.getAttribute('aria-selected'), 'true');

  await app.goto('#/project/react/03-key-prop');
  assert.equal(app.$('button.tab[aria-selected="true"]')?.textContent, 'Learn');
  assert.doesNotMatch(app.text(), /Could not load/);
});

test('a TypeScript project shows a run command that works for enums too', async () => {
  await app.goto('#/project/ts/07-enums-vs-unions');
  assert.match(app.text(), /--experimental-transform-types typescript\/07-enums-vs-unions\/original\.ts/);
  assert.doesNotMatch(app.text(), /original\.js/);
});

test('in-page anchors in the TS handbook stay inside the document', async () => {
  await app.goto('#/doc/typescript/HANDBOOK.md');
  const anchor = app.$$('.prose a').find((a) => a.getAttribute('href')?.startsWith('#/doc/typescript/HANDBOOK.md#'));
  assert.ok(anchor, 'bare #section links should be rewritten to the doc route');
  await app.goto(anchor.getAttribute('href') as string);
  assert.doesNotMatch(app.text(), /Nothing here/);
  assert.match(app.text(), /On this page/);
});

test('importing an invalid file shows an error and leaves progress untouched', async () => {
  const before = app.progress.emptyProgress();
  before.steps['kept/step'] = 1;
  await app.act(() => app.progress.progressStore.replaceForTests(before));
  await app.goto('#/settings');

  const input = app.$('input[type="file"]') as HTMLInputElement | null;
  assert.ok(input);
  const file = new app.win.File(['{"not": "progress"}'], 'bad.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await app.act(() => {
    input.dispatchEvent(new app.win.Event('change', { bubbles: true }));
  });
  await app.settle();

  assert.match(app.$('[role="status"]')?.textContent ?? '', /Unrecognised progress file/);
  assert.deepEqual(Object.keys(app.progress.progressStore.getSnapshot().steps), ['kept/step']);
});

test("another tab's write reaches this tab through the storage event", async () => {
  const other = app.progress.emptyProgress();
  other.steps['from/other/tab'] = Date.now();
  const raw = JSON.stringify(other);
  await app.act(() => {
    app.win.localStorage.setItem('devpath.progress.v1', raw);
    app.win.dispatchEvent(new app.win.StorageEvent('storage', { key: 'devpath.progress.v1', newValue: raw }));
  });
  assert.ok(app.progress.progressStore.getSnapshot().steps['from/other/tab']);
});

test('a streak that lapsed days ago displays as 0 without rewriting storage', async () => {
  const state = app.progress.emptyProgress();
  state.streak = { current: 12, longest: 12, lastDay: '2020-01-01' };
  await app.act(() => app.progress.progressStore.replaceForTests(state));
  await app.goto('#/progress');
  const stat = app.find('.stat', /day streak/);
  assert.equal(stat?.querySelector('b')?.textContent, '0');
  assert.equal(app.progress.progressStore.getSnapshot().streak.current, 12, 'storage untouched until next activity');
});

test('the due badge counts reviews within the level ceiling only', async () => {
  const state = app.progress.emptyProgress();
  const past = Date.now() - 86_400_000;
  const card = { ease: 2.5, interval: 1, due: past, reps: 1, lapses: 0, seen: 1, correct: 1, lastSeen: past };
  state.cards['jsf-001'] = card;
  state.cards['no-such-question'] = card;
  await app.act(() => app.progress.progressStore.replaceForTests(state));
  await app.goto('#/');
  const badge = app.$('.nav-item .count.hot');
  assert.equal(badge?.textContent, '1', 'one real, seen, due question');
});

test('a v1 profile is migrated on load: ticks follow their step, the raw payload is backed up', async () => {
  const v1 = JSON.stringify({
    version: 1,
    steps: { 's0-basics/m-values/2': Date.now(), 'bogus/key/9': Date.now() },
    notes: { 's0-basics/m-values': 'my v1 note' },
    cards: {},
    sessions: [],
    streak: { current: 0, longest: 0, lastDay: '' },
    settings: { seconds: 45, maxLevel: 3, explain: true },
  });
  await app.act(() => {
    app.win.localStorage.removeItem('devpath.progress.v1.backup');
    app.win.localStorage.setItem('devpath.progress.v1', v1);
    app.progress.progressStore.reloadForTests();
  });

  const state = app.progress.progressStore.getSnapshot();
  assert.equal(state.version, 2);
  assert.deepEqual(Object.keys(state.steps).sort(), ['bogus/key/9', 'm-values/build:js/01-fizzbuzz'], 'unknown v1 ticks are kept');
  assert.equal(app.win.localStorage.getItem('devpath.progress.v1.backup'), v1, 'rollback copy kept');
  assert.equal(JSON.parse(app.win.localStorage.getItem('devpath.progress.v1') ?? '{}').version, 2, 'written back once');

  await app.goto('#/path/s0-basics');
  const row = app.$$('.step').find((r) => r.querySelector('a[href*="js/01-fizzbuzz"]'));
  const check = row?.querySelector('button.step-check');
  assert.equal(check?.getAttribute('aria-checked'), 'true', 'the FizzBuzz tick survived the rekey');
  assert.match(app.text(), /my v1 note/, 'the note moved to its module key');
});

test('an error boundary shows a fallback with retry instead of a blank screen', async () => {
  const { createElement } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { default: ErrorBoundary } = await import('./components/ErrorBoundary.tsx');
  let fail = true;
  const Flaky = () => {
    if (fail) throw new Error('boom');
    return createElement('p', null, 'recovered');
  };
  const host = app.win.document.createElement('div');
  app.win.document.body.append(host);
  const root = createRoot(host);
  const quiet = console.error;
  console.error = () => {};
  try {
    await app.act(() => root.render(createElement(ErrorBoundary, null, createElement(Flaky))));
    assert.match(host.textContent ?? '', /This screen hit a bug\.boom/);
    fail = false;
    const retry = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Try again');
    await app.act(() => retry?.click());
    assert.equal(host.textContent, 'recovered');
  } finally {
    console.error = quiet;
    await app.act(() => root.unmount());
    host.remove();
  }
});

test('a route that throws inside Layout shows the fallback while the sidebar keeps working', async () => {
  // Corrupt data only the Progress page reads: a null session row makes it throw.
  const broken = app.progress.emptyProgress();
  (broken.sessions as unknown[]).push(null);
  await app.act(() => app.progress.progressStore.replaceForTests(broken));
  const quiet = console.error;
  console.error = () => {};
  try {
    await app.goto('#/progress');
    const main = app.$('main#main');
    assert.match(main?.textContent ?? '', /This screen hit a bug\./, 'the fallback renders inside main');
    assert.ok(app.$('.sidebar .nav-item[href="#/path"]'), 'the sidebar is still there');

    // The boundary is keyed on the pathname: a sidebar click clears it.
    await app.click('.sidebar .nav-item[href="#/path"]');
    assert.equal(app.win.location.hash, '#/path');
    assert.doesNotMatch(app.text(), /This screen hit a bug/);
    assert.ok(app.$('button.stage-toggle'), 'the path renders');
  } finally {
    console.error = quiet;
  }
});

test('importing a valid file can be cancelled at the confirm prompt', async () => {
  const before = app.progress.emptyProgress();
  before.steps['kept/step'] = 1;
  await app.act(() => app.progress.progressStore.replaceForTests(before));
  await app.goto('#/settings');

  const incoming = app.progress.emptyProgress();
  incoming.steps['other/step'] = 2;
  const input = app.$('input[type="file"]') as HTMLInputElement;
  const file = new app.win.File([JSON.stringify(incoming)], 'export.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  let asked = '';
  app.confirmWith((message) => {
    asked = message;
    return false;
  });
  try {
    await app.act(() => {
      input.dispatchEvent(new app.win.Event('change', { bubbles: true }));
    });
    await app.settle();
  } finally {
    app.confirmWith();
  }
  assert.match(asked, /Replace your progress with this file\?/);
  assert.match(app.$('[role="status"]')?.textContent ?? '', /Import cancelled\. Nothing changed\./);
  assert.deepEqual(Object.keys(app.progress.progressStore.getSnapshot().steps), ['kept/step']);
});

test('the theme toggle cycles system → light → dark → system; storage and Settings follow', async () => {
  const html = app.win.document.documentElement;
  const toggle = () => app.$('.sidebar-foot button') as HTMLElement;
  assert.equal(app.win.localStorage.getItem('devpath.theme'), null, 'starts on system');
  assert.match(toggle().textContent ?? '', /System/);

  await app.click(toggle());
  assert.equal(html.dataset['theme'], 'light');
  assert.equal(app.win.localStorage.getItem('devpath.theme'), 'light');
  assert.match(toggle().textContent ?? '', /Light/);

  await app.click(toggle());
  assert.equal(html.dataset['theme'], 'dark');
  assert.equal(app.win.localStorage.getItem('devpath.theme'), 'dark');

  await app.goto('#/settings');
  const select = app.$$('select').find((s) => [...(s as HTMLSelectElement).options].some((o) => o.value === 'system')) as
    | HTMLSelectElement
    | undefined;
  assert.ok(select, 'the Settings theme select');
  assert.equal(select.value, 'dark', 'Settings shows the choice made in the sidebar');
  assert.equal(select.selectedOptions[0]?.textContent, 'Dark', 'plain label, no glyph');

  await app.click(toggle());
  assert.equal(app.win.localStorage.getItem('devpath.theme'), null, 'system removes the key');
  assert.equal(select.value, 'system', 'the Settings select follows the sidebar toggle');
  assert.match(toggle().textContent ?? '', /System/);
});

test('moving between documents scrolls to the anchor in the NEW document, never against the old one', async () => {
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const { PUBLIC } = await import('./testing/harness.ts');
  const { tableOfContents } = await import('./lib/markdown.ts');
  const idsOf = async (id: string) =>
    tableOfContents(await readFile(path.join(PUBLIC, 'docs', 'guides', `${id}.md`), 'utf8')).map((h) => h.id);
  const httpIds = new Set(await idsOf('http-fundamentals'));
  const anchor = (await idsOf('sql-fundamentals')).find((id) => !httpIds.has(id));
  assert.ok(anchor, 'a section only the SQL guide has');

  await app.goto('#/guide/http-fundamentals');
  const scrolled: string[] = [];
  const proto = app.win.HTMLElement.prototype;
  const hadOwn = Object.prototype.hasOwnProperty.call(proto, 'scrollIntoView');
  const original = proto.scrollIntoView;
  const originalScrollTo = app.win.scrollTo;
  proto.scrollIntoView = function (this: HTMLElement) {
    scrolled.push(`into:${this.id}`);
  };
  app.win.scrollTo = (() => scrolled.push('top')) as typeof app.win.scrollTo;
  try {
    await app.goto(`#/guide/sql-fundamentals#${anchor}`);
    // With a stale "ready" for the old document, the effect would first run
    // against the HTTP guide, miss the anchor and jump to the top.
    assert.deepEqual(scrolled, [`into:${anchor}`]);
  } finally {
    if (hadOwn) proto.scrollIntoView = original;
    else Reflect.deleteProperty(proto, 'scrollIntoView');
    app.win.scrollTo = originalScrollTo;
  }
});

test('a skip link moves focus to the main region; route changes focus the new page', async () => {
  await app.goto('#/');
  const skip = app.$('a.skip-link');
  assert.ok(skip);
  await app.click(skip);
  assert.equal(app.win.document.activeElement?.id, 'main');
  assert.equal(app.win.location.hash, '#/', 'the skip link is not a route');

  (app.$('.nav-item[href="#/drill"]') as HTMLElement).focus();
  await app.click('.nav-item[href="#/drill"]');
  assert.equal(app.win.document.activeElement?.id, 'main');
});
