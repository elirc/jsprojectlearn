import type { ReactNode } from 'react';
import { loadContent } from '../lib/content.ts';
import { useAsync } from '../lib/hooks.ts';
import type { Content } from '../lib/types.ts';

/**
 * The app is useless without its generated content, so the whole tree waits on
 * one load rather than every route fetching for itself.
 */
export function ContentGate({ children }: { children: (content: Content) => ReactNode }) {
  const state = useAsync(loadContent, []);

  if (state.status === 'loading') {
    return (
      <div className="empty" style={{ paddingTop: '25vh' }}>
        Loading…
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="page">
        <div className="banner">
          <strong>Content is missing.</strong>
          <p style={{ margin: '8px 0 0' }}>{state.error.message}</p>
          <p style={{ margin: '8px 0 0' }} className="faint">
            From the repo root: <code className="mono">npm run content</code>, then reload.
          </p>
        </div>
      </div>
    );
  }

  return <>{children(state.data)}</>;
}
