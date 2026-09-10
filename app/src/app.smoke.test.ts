/**
 * Smoke test: boot the real application in jsdom and click through it.
 *
 * "It compiles" is not "it renders". This mounts the actual component tree
 * against the actual generated content and asserts that each main route puts
 * something real on the screen — which is what catches a broken hook, a bad
 * router usage, or a runtime error inside a component.
 *
 * Written with createElement rather than JSX because Node's type stripping
 * removes types but does not transform JSX.
 *
 * Run: `node --test app/src/app.smoke.test.ts` (or `npm test` from the root).
 * Requires `npm run content` to have produced app/public/content.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '..', 'public');

// Loaded dynamically, after the DOM globals exist — React reads them on import.
type Mounted = { container: HTMLElement; act: (fn: () => void | Promise<void>) => Promise<void> };
let mounted: Mounted | undefined;

before(async () => {
  assert.ok(
    existsSync(path.join(PUBLIC, 'content', 'roadmap.json')),
    'Generated content is missing — run `npm run content` first.',
  );

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });

  const win = dom.window as unknown as Window & typeof globalThis;

  // Some of these (navigator, location) are getter-only on globalThis in
  // modern Node, so they have to be redefined rather than assigned.
  const define = (name: string, value: unknown) =>
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });

  define('window', win);
  define('document', win.document);
  define('navigator', win.navigator);
  define('location', win.location);
  define('localStorage', win.localStorage);
  define('HTMLElement', win.HTMLElement);
  define('Node', win.Node);
  define('Event', win.Event);
  define('MouseEvent', win.MouseEvent);
  define('KeyboardEvent', win.KeyboardEvent);
  define('getComputedStyle', win.getComputedStyle.bind(win));
  define('requestAnimationFrame', (cb: FrameRequestCallback) => win.setTimeout(() => cb(0), 0));
  define('cancelAnimationFrame', (id: number) => win.clearTimeout(id));
  // React 19 checks this before allowing act().
  define('IS_REACT_ACT_ENVIRONMENT', true);

  // Serve the generated content off disk, the way the dev server would.
  define('fetch', async (input: string | URL) => {
    const url = new URL(String(input), 'http://localhost/');
    const file = path.join(PUBLIC, decodeURIComponent(url.pathname));
    if (!existsSync(file)) {
      return new Response('not found', { status: 404 });
    }
    return new Response(await readFile(file, 'utf8'), { status: 200 });
  });

  const { createElement } = await import('react');
  const { act } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { HashRouter } = await import('react-router-dom');
  const { default: App } = await import('./App.tsx');

  const container = win.document.getElementById('root') as unknown as HTMLElement;
  const root = createRoot(container);

  const wrappedAct = async (fn: () => void | Promise<void>) => {
    await act(async () => {
      await fn();
    });
  };

  await wrappedAct(() => {
    root.render(createElement(HashRouter, null, createElement(App)));
  });

  mounted = { container, act: wrappedAct };
  // Routes load their markdown and JSON through fetch, so a render is not
  // finished until those promises have resolved and re-rendered.
  await settle();
});

/** Flush enough macrotask turns for the route's async loads to land. */
async function settle(turns = 6): Promise<void> {
  assert.ok(mounted);
  for (let i = 0; i < turns; i++) {
    await mounted.act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2));
    });
  }
}

after(() => {
  // Release the jsdom window so the process can exit cleanly.
  // jsdom keeps timers alive; nothing else holds the process open.
  (globalThis as Record<string, unknown>)['window'] = undefined;
});

function screen(): { text: string; html: string } {
  assert.ok(mounted, 'app did not mount');
  return { text: mounted.container.textContent ?? '', html: mounted.container.innerHTML };
}

/** Follow an in-app hash route and let React re-render. */
async function goto(hashPath: string): Promise<void> {
  assert.ok(mounted);
  await mounted.act(async () => {
    window.location.hash = hashPath;
    await new Promise((resolve) => setTimeout(resolve, 2));
  });
  await settle();
}

// ------------------------------------------------------------------- tests

test('the app mounts and renders the dashboard', () => {
  const { text, html } = screen();
  assert.ok(html.length > 500, 'expected a rendered tree, got: ' + html.slice(0, 200));
  assert.match(text, /DevPath/, 'brand should render');
  assert.match(text, /day streak/, 'dashboard stats should render');
  assert.match(text, /Next up|Path complete/, 'the next-step card should render');
});

test('the dashboard lists every stage of the path', () => {
  const { text } = screen();
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

test('the path route renders modules and their interview focus', async () => {
  await goto('#/path/s0-basics');
  const { text } = screen();
  assert.match(text, /The path/);
  assert.match(text, /Values, variables, and branching/, 'first module should render');
  assert.match(text, /Interviewers ask/, 'interview focus box should render');
  assert.match(text, /FizzBuzz/, 'a build step should render');
});

test('the drills route lists decks with real question counts', async () => {
  await goto('#/drill');
  const { text } = screen();
  assert.match(text, /Mixed mock/);
  assert.match(text, /JavaScript fundamentals/);
  assert.match(text, /ASP\.NET Core and EF Core/);
  assert.match(text, /\d+ due/, 'due counts should render');
});

test('a drill session renders a question with four answerable choices', async () => {
  await goto('#/drill/js-fundamentals?count=5');
  assert.ok(mounted);
  const { text } = screen();

  // The question stem and the A/B/C/D keys.
  assert.match(text, /JavaScript/, 'topic pill should render');
  const choices = mounted.container.querySelectorAll('button.choice');
  assert.equal(choices.length, 4, 'expected four choices');

  // Answering should reveal the explanation panel.
  await mounted.act(async () => {
    (choices[0] as HTMLElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const after = screen();
  assert.match(after.text, /Correct|Not quite/, 'a verdict should appear after answering');
  assert.ok(
    mounted.container.querySelector('.verdict'),
    'the explanation panel should render',
  );
});

test('the project library renders and filters', async () => {
  await goto('#/library');
  const { text } = screen();
  assert.match(text, /Project library/);
  assert.match(text, /\d+ shown/);
  assert.match(text, /on path/, 'projects scheduled by the roadmap should be badged');
});

test('a project page renders its markdown docs', async () => {
  await goto('#/project/react/19-fetch-race');
  const { text } = screen();
  assert.match(text, /node |dotnet |open /, 'the run-it hint should render');
  assert.ok(
    text.includes('Learn') || text.includes('The refactor'),
    'document tabs should render',
  );
});

test('a guide renders its long-form markdown', async () => {
  await goto('#/guide/http-fundamentals');
  const { text } = screen();
  assert.match(text, /HTTP from the wire up/);
  assert.match(text, /idempotent/i, 'guide body should render');
  assert.match(text, /On this page/, 'the table of contents should render');
});

test('the handbook renders through the doc route', async () => {
  await goto('#/doc/HANDBOOK.md');
  const { text } = screen();
  assert.match(text, /Handbook/i);
});

test('the progress route renders per-stage and per-topic breakdowns', async () => {
  await goto('#/progress');
  const { text } = screen();
  assert.match(text, /path complete/);
  assert.match(text, /By stage/);
  assert.match(text, /By topic/);
});

test('an unknown route renders the not-found page rather than crashing', async () => {
  await goto('#/no/such/route');
  const { text } = screen();
  assert.match(text, /Nothing here/);
});
