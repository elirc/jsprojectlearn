/**
 * Boots the real application in jsdom for the smoke tests.
 *
 * Each smoke file calls boot() once in `before()` and close() in `after()`.
 * The app is mounted inside StrictMode, like main.tsx, so double-invoked
 * effects and updaters are exercised here rather than discovered in dev.
 *
 * Written without JSX because Node's type stripping does not transform it.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PUBLIC = path.resolve(HERE, '..', '..', 'public');

type Progress = typeof import('../lib/progress.ts');

export interface Harness {
  win: Window & typeof globalThis;
  container: HTMLElement;
  progress: Progress;
  act(fn: () => void | Promise<void>): Promise<void>;
  /** Flush enough macrotask turns for the route's async loads to land. */
  settle(turns?: number): Promise<void>;
  /** Follow an in-app hash route the way a typed URL does. */
  goto(hashPath: string): Promise<void>;
  /** Wait real time inside act (timers, debounces). */
  wait(ms: number): Promise<void>;
  text(): string;
  $(selector: string): HTMLElement | null;
  $$(selector: string): HTMLElement[];
  /** First element matching `selector` whose text matches `re`. */
  find(selector: string, re: RegExp): HTMLElement | undefined;
  click(target: HTMLElement | string, re?: RegExp): Promise<void>;
  /** Dispatch a keydown; returns whether something called preventDefault. */
  press(key: string, target?: EventTarget, init?: KeyboardEventInit): Promise<boolean>;
  /** Answer window.confirm with `fn` from now on; no argument restores "always OK". */
  confirmWith(fn?: (message: string) => boolean): void;
  close(): void;
}

export interface BootOptions {
  /** Runs before any app module is imported — the place to seed localStorage. */
  seed?: (storage: Storage) => void;
  /** Initial hash route. */
  route?: string;
}

export async function boot(options: BootOptions = {}): Promise<Harness> {
  // Other workstreams regenerate app/public while tests run; fail with a
  // clear message rather than a 404 deep inside one route.
  for (const file of ['content/roadmap.json', 'docs/HANDBOOK.md', 'docs/guides/http-fundamentals.md']) {
    assert.ok(
      existsSync(path.join(PUBLIC, file)),
      `Generated content is missing (${file}) — run \`npm run content\` first.`,
    );
  }

  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: `http://localhost/${options.route ?? ''}`,
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
  define('Element', win.Element);
  define('Node', win.Node);
  define('Event', win.Event);
  define('MouseEvent', win.MouseEvent);
  define('KeyboardEvent', win.KeyboardEvent);
  define('StorageEvent', win.StorageEvent);
  define('File', win.File);
  define('getComputedStyle', win.getComputedStyle.bind(win));
  define('requestAnimationFrame', (cb: FrameRequestCallback) => win.setTimeout(() => cb(0), 0));
  define('cancelAnimationFrame', (id: number) => win.clearTimeout(id));
  const alwaysOk = () => true;
  let answerConfirm: (message: string) => boolean = alwaysOk;
  const confirm = (message?: string) => answerConfirm(message ?? '');
  define('confirm', confirm);
  win.confirm = confirm;
  win.scrollTo = () => {};
  // React 19 checks this before allowing act().
  define('IS_REACT_ACT_ENVIRONMENT', true);

  // Serve the generated content off disk, the way the dev server would.
  define('fetch', async (input: string | URL) => {
    const url = new URL(String(input), 'http://localhost/');
    const file = path.join(PUBLIC, decodeURIComponent(url.pathname));
    if (!existsSync(file)) return new Response('not found', { status: 404 });
    return new Response(await readFile(file, 'utf8'), { status: 200 });
  });

  options.seed?.(win.localStorage);

  const { createElement, act, StrictMode } = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { HashRouter } = await import('react-router-dom');
  const progress: Progress = await import('../lib/progress.ts');
  const { default: App } = await import('../App.tsx');

  const container = win.document.getElementById('root') as unknown as HTMLElement;
  const root = createRoot(container);

  const doAct = async (fn: () => void | Promise<void>) => {
    await act(async () => {
      await fn();
    });
  };

  const settle = async (turns = 6) => {
    for (let i = 0; i < turns; i++) {
      await doAct(() => new Promise((resolve) => setTimeout(resolve, 2)));
    }
  };

  const $$ = (selector: string) => [...container.querySelectorAll<HTMLElement>(selector)];
  const find = (selector: string, re: RegExp) => $$(selector).find((el) => re.test(el.textContent ?? ''));

  const harness: Harness = {
    win,
    container,
    progress,
    act: doAct,
    settle,
    async goto(hashPath) {
      await doAct(async () => {
        win.location.hash = hashPath;
        await new Promise((resolve) => setTimeout(resolve, 2));
      });
      await settle();
    },
    async wait(ms) {
      await doAct(() => new Promise((resolve) => setTimeout(resolve, ms)));
    },
    text: () => container.textContent ?? '',
    $: (selector) => container.querySelector<HTMLElement>(selector),
    $$,
    find,
    async click(target, re) {
      const el = typeof target === 'string' ? (re ? find(target, re) : container.querySelector<HTMLElement>(target)) : target;
      assert.ok(el, `nothing to click for ${String(target)} ${re ?? ''}`);
      await doAct(() => el.click());
      await settle();
    },
    async press(key, target, init = {}) {
      let prevented = false;
      await doAct(() => {
        const event = new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
        (target ?? win.document.activeElement ?? win.document.body).dispatchEvent(event);
        prevented = event.defaultPrevented;
      });
      await settle(2);
      return prevented;
    },
    confirmWith(fn) {
      answerConfirm = fn ?? alwaysOk;
    },
    close() {
      root.unmount();
      dom.window.close();
    },
  };

  await doAct(() => {
    root.render(createElement(StrictMode, null, createElement(HashRouter, null, createElement(App))));
  });
  // The content gate parses several MB of JSON, so a fixed number of turns
  // is not enough: wait until the shell is on screen (or give up after 30 s
  // and let the test's own assertion report what did render).
  const deadline = Date.now() + 30_000;
  while (!container.querySelector('.sidebar') && Date.now() < deadline) await settle(1);
  await settle();
  return harness;
}

/** The generated decks, for tests that need real question ids. */
export async function loadDecks(): Promise<{ id: string; topic: string; questions: { id: string; level: number; tags?: string[] }[] }[]> {
  return JSON.parse(await readFile(path.join(PUBLIC, 'content', 'decks.json'), 'utf8'));
}
