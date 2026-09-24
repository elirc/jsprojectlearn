/**
 * Smoke test: boot the real application in jsdom and click through it.
 *
 * "It compiles" is not "it renders". This mounts the actual component tree
 * against the actual generated content and asserts that each main route puts
 * something real on the screen — which is what catches a broken hook, a bad
 * router usage, or a runtime error inside a component.
 *
 * Run: `node --import ./app/test/register.mjs --test app/src/app.smoke.test.ts`
 * (or `npm test` from the root). Requires `npm run content` first.
 * More focused suites live next to this one in app.*.smoke.test.ts.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './testing/harness.ts';
import type { Harness } from './testing/harness.ts';

let app: Harness;

before(async () => {
  app = await boot();
});

after(() => app?.close());

test('the app mounts and renders the dashboard', () => {
  const text = app.text();
  assert.ok(app.container.innerHTML.length > 500, 'expected a rendered tree');
  assert.match(text, /DevPath/, 'brand should render');
  assert.match(text, /day streak/, 'dashboard stats should render');
  // Not "Today": that is always in the nav, so it could never fail.
  assert.match(text, /Reviews and new questions|Path complete/, "today's plan card should render");
});

test('the dashboard lists every stage of the path', () => {
  const text = app.text();
  for (const title of [
    'Programming, actually',
    'The browser, without a framework',
    'TypeScript',
    'React',
    'C# and ASP.NET Core',
    'Shipping and being interviewed',
  ]) {
    assert.ok(text.includes(title), `expected stage "${title}" on the dashboard`);
  }
});

test('a fresh profile has no hot "due" badge: unseen questions are new, not due', () => {
  assert.equal(app.$('.nav-item .count.hot'), null);
});

test('the path route renders modules and their interview focus', async () => {
  await app.goto('#/path/s0-basics');
  const text = app.text();
  assert.match(text, /The path/);
  assert.match(text, /Values, variables, and branching/, 'first module should render');
  assert.match(text, /Interviewers ask/, 'interview focus box should render');
  assert.match(text, /FizzBuzz/, 'a build step should render');
});

test('the drills route lists decks with real question counts', async () => {
  await app.goto('#/drill');
  const text = app.text();
  assert.match(text, /JavaScript fundamentals/);
  assert.match(text, /ASP\.NET Core and EF Core/);
  assert.match(text, /\d+ new/, 'new-question counts should render');
});

test('a drill session renders a question with four answerable choices', async () => {
  await app.goto('#/drill/js-fundamentals?count=5');
  assert.match(app.text(), /JavaScript/, 'topic pill should render');
  const choices = app.$$('button.choice');
  assert.equal(choices.length, 4, 'expected four choices');
  assert.deepEqual(
    choices.map((c) => c.querySelector('.key')?.textContent),
    ['1', '2', '3', '4'],
    'choice badges show the keys that answer them',
  );

  await app.click(choices[0] as HTMLElement);
  assert.match(app.text(), /Correct|Not quite/, 'a verdict should appear after answering');
  assert.ok(app.$('.verdict'), 'the explanation panel should render');
});

test('the project library renders and filters', async () => {
  await app.goto('#/library');
  const text = app.text();
  assert.match(text, /Project library/);
  assert.match(text, /\d+ shown/);
  assert.match(text, /on path/, 'projects scheduled by the roadmap should be badged');
});

test('a project page renders its markdown docs', async () => {
  await app.goto('#/project/react/19-fetch-race');
  const text = app.text();
  assert.match(text, /Open in a browser/, 'an HTML original is opened, not run with node');
  assert.match(text, /react\/19-fetch-race\/original\.html/);
  assert.ok(text.includes('Learn') || text.includes('The refactor'), 'document tabs should render');
});

test('a guide renders its long-form markdown', async () => {
  await app.goto('#/guide/http-fundamentals');
  const text = app.text();
  assert.match(text, /HTTP/);
  assert.match(text, /idempotent/i, 'guide body should render');
  assert.match(text, /On this page/, 'the table of contents should render');
});

test('the handbook renders through the doc route', async () => {
  await app.goto('#/doc/HANDBOOK.md');
  assert.match(app.text(), /Handbook/i);
});

test('the progress route renders per-stage and per-topic breakdowns', async () => {
  await app.goto('#/progress');
  const text = app.text();
  assert.match(text, /path complete/);
  assert.match(text, /By stage/);
  assert.match(text, /By topic/);
});

test('an unknown route renders the not-found page rather than crashing', async () => {
  await app.goto('#/no/such/route');
  assert.match(app.text(), /Nothing here/);
});

test('an unknown deck renders not-found instead of silently drilling everything', async () => {
  await app.goto('#/drill/no-such-deck');
  assert.match(app.text(), /Nothing here/);
});

test('Settings and the theme toggle live in the sidebar foot, which mobile keeps visible', () => {
  const foot = app.$('.sidebar-foot');
  assert.ok(foot, 'sidebar foot should render');
  assert.ok(foot.querySelector('a[href="#/settings"]'), 'Settings link in the foot');
  assert.ok(foot.querySelector('button'), 'theme toggle in the foot');
});
