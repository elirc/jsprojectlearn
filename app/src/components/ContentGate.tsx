import { useState } from 'react';
import type { ReactNode } from 'react';
import { loadContent } from '../lib/content.ts';
import { useAsync } from '../lib/hooks.ts';
import { ContentContext } from '../lib/content-context.ts';

/**
 * The app is useless without its generated content, so the whole tree waits on
 * one load rather than every route fetching for itself.
 */
export function ContentGate({ children }: { children: ReactNode }) {
  const [attempt, setAttempt] = useState(0);
  const state = useAsync(`content#${attempt}`, loadContent);

  if (state.status === 'loading') {
    return <div className="empty boot">Loading…</div>;
  }

  if (state.status === 'error') {
    // Browsers refuse fetch() from file://, so opening dist/index.html straight
    // off disk fails here even though the content is right there.
    const offDisk = typeof location !== 'undefined' && location.protocol === 'file:';
    return (
      <div className="page">
        <div className="banner" role="alert">
          <strong>{offDisk ? 'This page needs a web server.' : 'Content is missing.'}</strong>
          <p className="mt-1">{state.error.message}</p>
          <p className="mt-1 faint">
            {offDisk ? (
              <>
                Serve <code className="mono">dist/</code> with <code className="mono">npm run preview</code>{' '}
                or any static server instead of opening the file directly.
              </>
            ) : (
              <>
                From the repo root: <code className="mono">npm run content</code>, then retry.
              </>
            )}
          </p>
          <button className="btn sm mt-2" onClick={() => setAttempt((n) => n + 1)}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  return <ContentContext value={state.data}>{children}</ContentContext>;
}
