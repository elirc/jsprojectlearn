import { useEffect, useMemo } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import StepBar, { usePathSteps } from '../components/StepBar.tsx';
import { loadDoc } from '../lib/content.ts';
import { readingMinutes } from '../lib/format.ts';
import { useAsync } from '../lib/hooks.ts';
import { renderMarkdown, tableOfContents } from '../lib/markdown.ts';
import { useContent } from '../lib/content-context.ts';

/**
 * Renders any markdown in the repo: the four HANDBOOKs, a track README, or an
 * authored guide from content/modules/.
 */
export default function DocView({ kind }: { kind: 'doc' | 'guide' }) {
  const content = useContent();
  const params = useParams();
  const location = useLocation();

  const repoPath =
    kind === 'guide' ? `guides/${params['guideId']}.md` : (params['*'] ?? 'README.md');
  const routePath = kind === 'guide' ? `/guide/${params['guideId']}` : `/doc/${repoPath}`;
  const baseDir = repoPath.includes('/') ? repoPath.slice(0, repoPath.lastIndexOf('/')) : undefined;

  const state = useAsync(repoPath, () => loadDoc(repoPath));
  const guide = kind === 'guide' ? content.guides.find((g) => g.id === params['guideId']) : undefined;
  const data = state.status === 'ready' ? state.data : undefined;
  const pathSteps = usePathSteps(
    kind === 'guide'
      ? { kind: 'guide', guide: params['guideId'] ?? '' }
      : { kind: 'read', doc: repoPath, anchor: location.hash || undefined },
  );

  const html = useMemo(
    () => (data === undefined ? '' : renderMarkdown(data, { baseDir, routePath })),
    [data, baseDir, routePath],
  );
  const toc = useMemo(() => (data === undefined ? [] : tableOfContents(data)), [data]);

  // Anchors arrive as part of the hash route, so the browser will not scroll
  // for us — do it once THIS document is on screen (useAsync never hands back
  // the previous document under a new path).
  useEffect(() => {
    if (data === undefined) return;
    const anchor = decodeURIComponent(location.hash.replace(/^#/, ''));
    const target = anchor ? document.getElementById(anchor) : null;
    if (target) target.scrollIntoView?.({ block: 'start' });
    else window.scrollTo?.(0, 0);
  }, [data, location.hash]);

  if (state.status === 'loading') return <div className="page empty">Loading…</div>;
  if (state.status === 'error') {
    return (
      <div className="page">
        <div className="banner" role="alert">
          <strong>Not found.</strong>
          <p className="mt-1 m-0">{state.error.message}</p>
        </div>
        <p className="mt-3">
          {kind === 'guide' ? <Link to="/guides">← All guides</Link> : <Link to="/">← Back to today</Link>}
        </p>
      </div>
    );
  }

  return (
    <div className="page wide">
      {guide && (
        <header className="page-head">
          <div className="eyebrow">Guide · ~{readingMinutes(guide.words)} min read</div>
        </header>
      )}
      <StepBar steps={pathSteps} />
      <div className="split">
        <div className="min-w-0">
          <article className="prose" dangerouslySetInnerHTML={{ __html: html }} />
          <StepBar steps={pathSteps} variant="end" />
        </div>
        {toc.length > 2 && (
          <nav className="toc" aria-label="On this page">
            <div className="eyebrow mb-2">On this page</div>
            {toc.map((entry) => (
              <a key={entry.id} href={`#${location.pathname}${location.search}#${entry.id}`}>
                {entry.text}
              </a>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}
