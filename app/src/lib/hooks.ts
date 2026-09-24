import { useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react';
import { progressStore } from './progress.ts';
import type { ProgressState } from './progress.ts';

/** The progress store, subscribed to the React way. */
export function useProgress(): ProgressState {
  return useSyncExternalStore(progressStore.subscribe, progressStore.getSnapshot);
}

export type Async<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'error'; error: Error };

/**
 * Async state keyed by `key`, with the race guard the React track spends a
 * whole project on: a stale response must never win over a newer one.
 *
 * The result is stored together with the key it was loaded for, so the render
 * after a key change sees "loading" rather than the previous key's data.
 */
export function useAsync<T>(key: string, load: () => Promise<T>): Async<T> {
  const [stored, setStored] = useState<{ key: string; state: Async<T> } | undefined>(undefined);
  const run = useEffectEvent(load);

  useEffect(() => {
    let cancelled = false;
    run().then(
      (data) => {
        if (!cancelled) setStored({ key, state: { status: 'ready', data } });
      },
      (error: unknown) => {
        if (!cancelled) {
          const err = error instanceof Error ? error : new Error(String(error));
          setStored({ key, state: { status: 'error', error: err } });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key]);

  return stored?.key === key ? stored.state : { status: 'loading' };
}

/** A clock that ticks every `ms`, for counts that depend on "now" (due cards). */
export function useNow(ms = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export const reduceMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ------------------------------------------------------------------ theme

export type ThemeChoice = 'system' | 'light' | 'dark';
export const THEME_KEY = 'devpath.theme';
const THEME_ORDER: ThemeChoice[] = ['system', 'light', 'dark'];

export const THEME_LABEL: Record<ThemeChoice, string> = {
  system: '◐ System',
  light: '○ Light',
  dark: '● Dark',
};

/** The same choices without the glyph, for places that show plain text. */
export const THEME_NAME: Record<ThemeChoice, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

function storedTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

const systemPrefersLight = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches;

/**
 * 'system' follows the OS and keeps following it while the app is open; the
 * resolved value is what lands on <html data-theme>, so the CSS only ever
 * sees light or dark. index.html applies the same rule before first paint.
 */
export function useTheme(): {
  choice: ThemeChoice;
  resolved: 'light' | 'dark';
  setChoice: (choice: ThemeChoice) => void;
  cycle: () => void;
} {
  const [choice, setChoiceState] = useState<ThemeChoice>(storedTheme);
  const [prefersLight, setPrefersLight] = useState(systemPrefersLight);

  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const query = matchMedia('(prefers-color-scheme: light)');
    const onChange = () => setPrefersLight(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // Another hook instance (Settings vs the sidebar) changed the choice.
  useEffect(() => {
    const onTheme = () => setChoiceState(storedTheme());
    window.addEventListener('devpath-theme', onTheme);
    return () => window.removeEventListener('devpath-theme', onTheme);
  }, []);

  const resolved = choice === 'system' ? (prefersLight ? 'light' : 'dark') : choice;

  useEffect(() => {
    document.documentElement.dataset['theme'] = resolved;
  }, [resolved]);

  const setChoice = (next: ThemeChoice) => {
    try {
      if (next === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      /* storage may be unavailable; the theme still applies for this session */
    }
    setChoiceState(next);
    window.dispatchEvent(new Event('devpath-theme'));
  };

  const cycle = () => {
    const at = THEME_ORDER.indexOf(choice);
    setChoice(THEME_ORDER[(at + 1) % THEME_ORDER.length] ?? 'system');
  };

  return { choice, resolved, setChoice, cycle };
}

// -------------------------------------------------------------- keyboard

/** Elements that already do something with Enter/Space when focused. */
// <main tabIndex={-1}> takes focus on every route change but does nothing
// with Enter itself, so it must not block the page's shortcuts.
const ACTIVATABLE =
  'button, a[href], [role="button"], [role="link"], [role="radio"], summary, [tabindex]:not([tabindex="-1"])';

/**
 * Should a page-level shortcut ignore this key event? Exported for tests.
 *
 * Never steal keys from a field; never steal Enter/Space from a focused
 * control (that is how keyboard users click things); and stay out of the way
 * while a modal dialog is open.
 */
export function shouldIgnoreKey(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return true;
  const raw = event.target as HTMLElement | null;
  const target = raw && typeof raw.closest === 'function' ? raw : null;
  if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) {
    return true;
  }
  if ((event.key === 'Enter' || event.key === ' ') && target?.closest(ACTIVATABLE)) return true;
  if (document.querySelector('[aria-modal="true"]')) return true;
  return false;
}

/**
 * Fires `handler` when one of `keys` is pressed and nothing else should own
 * it. The listener is attached once per key set; the latest handler is read
 * through an effect event, so inline arrows don't churn the subscription.
 */
export function useKey(keys: readonly string[], handler: (key: string) => void): void {
  const onKey = useEffectEvent(handler);
  const signature = keys.join('\n');

  useEffect(() => {
    const wanted = new Set(signature.split('\n'));
    const listener = (event: KeyboardEvent) => {
      if (!wanted.has(event.key) || shouldIgnoreKey(event)) return;
      event.preventDefault();
      onKey(event.key);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [signature]);
}
