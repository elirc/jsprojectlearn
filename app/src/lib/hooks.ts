import { useEffect, useState, useSyncExternalStore } from 'react';
import { progressStore } from './progress.ts';
import type { ProgressState } from './progress.ts';

/** The progress store, subscribed to the React way. */
export function useProgress(): ProgressState {
  return useSyncExternalStore(progressStore.subscribe, progressStore.getSnapshot);
}

type Async<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; error: Error };

/**
 * Load-once async state with the race guard the React track spends a whole
 * project on: a stale response must never win over a newer one.
 */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[]): Async<T> {
  const [state, setState] = useState<Async<T>>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    load().then(
      (data) => {
        if (!cancelled) setState({ status: 'ready', data });
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', error: error instanceof Error ? error : new Error(String(error)) });
        }
      },
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

const THEME_KEY = 'devpath.theme';

export function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem(THEME_KEY) ?? 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* storage may be unavailable; the theme still applies for this session */
    }
  }, [theme]);

  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

/** Fires `handler` when a plain key (no modifier, not in a field) is pressed. */
export function useKey(keys: string[], handler: (key: string) => void): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      handler(event.key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keys.join('|'), handler]);
}
