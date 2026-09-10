import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { loadDoc, TRACK_LABEL } from '../lib/content.ts';
import { highlight, normaliseLang } from '../lib/highlight.ts';
import { useAsync } from '../lib/hooks.ts';
import { renderMarkdown } from '../lib/markdown.ts';
import type { Content } from '../lib/types.ts';

/** Docs read in a deliberate order, so the tabs are ordered too. */
const DOC_ORDER = ['LEARN.md', 'README.md', 'PRACTICE.md', 'SOLUTION.md'];
const DOC_LABEL: Record<string, string> = {
  'LEARN.md': 'Learn',
  'README.md': 'The refactor',
  'PRACTICE.md': 'Practice',
  'SOLUTION.md': 'Solutions',
};

export default function ProjectView({ content }: { content: Content }) {
  const { track, name } = useParams();
  const project = content.projects.find((p) => p.id === `${track}/${name}`);
  const [tab, setTab] = useState<string | undefined>(undefined);

  const tabs = useMemo(() => {
    if (!project) return [];
    const docs = [...project.docs].sort(
      (a, b) => docRank(a) - docRank(b) || a.localeCompare(b),
    );
    return [...docs, ...project.sources.map((s) => s.path)];
  }, [project]);

  const active = tab ?? tabs[0];

  if (!project) {
    return (
      <div className="page">
        <div className="empty">
          <h2>No such project.</h2>
          <Link to="/library">Back to the library</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page stack stack-4">
      <header className="page-head">
        <div className="row">
          <span className={`pill ${project.track}`}>{TRACK_LABEL[project.track]}</span>
          <span className="faint mono">{project.dir}</span>
          {project.hasTests && <span className="pill good">tests</span>}
        </div>
        <h1>{project.title}</h1>
        <p className="lede">{project.blurb}</p>
        <div className="banner" style={{ marginTop: 14 }}>
          <strong>Run it locally.</strong>{' '}
          <span className="mono">
            {project.track === 'csharp'
              ? `dotnet run --project ${project.dir}/refactored`
              : project.track === 'react'
                ? `open ${project.dir}/original.html`
                : `node ${project.dir}/original.js`}
          </span>
          {project.hasTests && (
            <>
              {' · tests: '}
              <span className="mono">
                {project.track === 'csharp'
                  ? `dotnet run --project ${project.dir}/refactored -- test`
                  : `node --test ${project.dir}/`}
              </span>
            </>
          )}
        </div>
      </header>

      <div className="tabs">
        {tabs.map((file) => (
          <button
            key={file}
            className={`tab${active === file ? ' active' : ''}`}
            onClick={() => setTab(file)}
          >
            {DOC_LABEL[file] ?? file}
          </button>
        ))}
      </div>

      {active && <FileView repoPath={`${project.dir}/${active}`} baseDir={project.dir} />}
    </div>
  );
}

function docRank(file: string): number {
  const index = DOC_ORDER.indexOf(file);
  return index === -1 ? DOC_ORDER.length : index;
}

export function FileView({ repoPath, baseDir }: { repoPath: string; baseDir?: string }) {
  const state = useAsync(() => loadDoc(repoPath), [repoPath]);

  if (state.status === 'loading') return <div className="empty">Loading…</div>;
  if (state.status === 'error') {
    return <div className="banner">Could not load {repoPath}: {state.error.message}</div>;
  }

  if (repoPath.endsWith('.md')) {
    return (
      <article
        className="prose"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(state.data, { baseDir }) }}
      />
    );
  }

  const ext = repoPath.split('.').pop() ?? '';
  return (
    <figure className="code">
      <figcaption>{repoPath}</figcaption>
      <pre>
        <code dangerouslySetInnerHTML={{ __html: highlight(state.data, normaliseLang(ext)) }} />
      </pre>
    </figure>
  );
}
