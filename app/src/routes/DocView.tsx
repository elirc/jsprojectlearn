import { useEffect } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import { loadDoc } from '../lib/content.ts';
import { useAsync } from '../lib/hooks.ts';
import { renderMarkdown, tableOfContents } from '../lib/markdown.ts';
import type { Content } from '../lib/types.ts';

/**
 * Renders any markdown in the repo: the four HANDBOOKs, a track README, or an
 * authored guide from content/modules/.
 */
export default function DocView({ content, kind }: { content: Content; kind: 'doc' | 'guide' }) {
  const params = useParams();
  const location = useLocation();

  const repoPath =
    kind === 'guide' ? `guides/${params['guideId']}.md` : (params['*'] ?? 'README.md');

  const baseDir = repoPath.includes('/')
    ? repoPath.slice(0, repoPath.lastIndexOf('/'))
    : undefined;

  const state = useAsync(() => loadDoc(repoPath), [repoPath]);
  const guide =
    kind === 'guide' ? content.guides.find((g) => g.id === params['guideId']) : undefined;

  // Anchors arrive as part of the hash route, so the browser will not scroll
  // for us — do it once the document is on screen.
  useEffect(() => {
    if (state.status !== 'ready') return;
    const anchor = location.hash.replace(/^#/, '');
    const target = anchor ? document.getElementById(anchor) : null;
    if (target) target.scrollIntoView({ block: 'start' });
    else window.scrollTo(0, 0);
  }, [state.status, location.hash, repoPath]);

  if (state.status === 'loading') return <div className="page empty">Loading…</div>;
  if (state.status === 'error') {
    return (
      <div className="page">
        <div className="banner">
          <strong>Not found.</strong>
          <p style={{ margin: '6px 0 0' }}>{state.error.message}</p>
        </div>
        <p style={{ marginTop: 14 }}>
          <Link to="/">← Back to today</Link>
        </p>
      </div>
    );
  }

  const toc = tableOfContents(state.data);

  return (
    <div className="page wide">
      {guide && (
        <header className="page-head">
          <div className="eyebrow">Guide · ~{Math.max(1, Math.round(guide.words / 220))} min read</div>
        </header>
      )}
      <div className="split">
        <article
          className="prose"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(state.data, { baseDir }) }}
        />
        {toc.length > 2 && (
          <nav className="toc">
            <div className="eyebrow" style={{ marginBottom: 8 }}>
              On this page
            </div>
            {toc.map((entry) => (
              <a key={entry.id} href={`#${location.pathname}#${entry.id}`}>
                {entry.text}
              </a>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}
