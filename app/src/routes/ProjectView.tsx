import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import CodeBlock from '../components/CodeBlock.tsx';
import CopyButton from '../components/CopyButton.tsx';
import StepBar, { usePathSteps } from '../components/StepBar.tsx';
import { loadDoc, runCommands, TRACK_LABEL } from '../lib/content.ts';
import { normaliseLang } from '../lib/highlight.ts';
import { useAsync } from '../lib/hooks.ts';
import { renderMarkdown } from '../lib/markdown.ts';
import { useContent } from '../lib/content-context.ts';

/** Docs read in a deliberate order, so the tabs are ordered too. */
const DOC_ORDER = ['LEARN.md', 'README.md', 'PRACTICE.md', 'SOLUTION.md'];
const DOC_LABEL: Record<string, string> = {
  'LEARN.md': 'Learn',
  'README.md': 'The refactor',
  'PRACTICE.md': 'Practice',
  'SOLUTION.md': 'Solutions',
};

export default function ProjectView() {
  const content = useContent();
  const { track, name } = useParams();
  const project = content.projects.find((p) => p.id === `${track}/${name}`);
  const [tab, setTab] = useState<string | undefined>(undefined);
  const pathSteps = usePathSteps(project ? { kind: 'build', project: project.id } : undefined);

  const tabs = useMemo(() => {
    if (!project) return [];
    const docs = [...project.docs].sort((a, b) => docRank(a) - docRank(b) || a.localeCompare(b));
    return [...docs, ...project.sources.map((s) => s.path)];
  }, [project]);

  // A tab this project doesn't have (state carried over from another
  // project) must fall back to the first one rather than 404.
  const active = tab && tabs.includes(tab) ? tab : tabs[0];

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

  const commands = runCommands(project);

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
        {commands.length > 0 && (
          <div className="banner run-it mt-3">
            <strong>Run it locally</strong>
            <span className="faint"> — from the repo root</span>
            {commands.map((command) => (
              <div key={command.label} className="cmd">
                <span className="cmd-label">{command.label}</span>
                <code className="mono">{command.cmd}</code>
                <CopyButton text={command.cmd} label={command.label} />
              </div>
            ))}
          </div>
        )}
      </header>

      <StepBar steps={pathSteps} />

      <div className="tabs" role="tablist" aria-label="Project files">
        {tabs.map((file) => (
          <button
            key={file}
            role="tab"
            aria-selected={active === file}
            className={`tab${active === file ? ' active' : ''}`}
            onClick={() => setTab(file)}
          >
            {DOC_LABEL[file] ?? file}
          </button>
        ))}
      </div>

      {active && (
        <div role="tabpanel">
          <FileView
            repoPath={`${project.dir}/${active}`}
            baseDir={project.dir}
            routePath={`/project/${project.id}`}
          />
        </div>
      )}
    </div>
  );
}

function docRank(file: string): number {
  const index = DOC_ORDER.indexOf(file);
  return index === -1 ? DOC_ORDER.length : index;
}

export function FileView({
  repoPath,
  baseDir,
  routePath,
}: {
  repoPath: string;
  baseDir?: string;
  routePath?: string;
}) {
  const state = useAsync(repoPath, () => loadDoc(repoPath));
  const data = state.status === 'ready' ? state.data : undefined;
  const html = useMemo(
    () => (data !== undefined && repoPath.endsWith('.md') ? renderMarkdown(data, { baseDir, routePath }) : ''),
    [data, repoPath, baseDir, routePath],
  );

  if (state.status === 'loading') return <div className="empty">Loading…</div>;
  if (state.status === 'error') {
    return (
      <div className="banner">
        Could not load {repoPath}: {state.error.message}
      </div>
    );
  }

  if (repoPath.endsWith('.md')) {
    return <article className="prose" dangerouslySetInnerHTML={{ __html: html }} />;
  }

  const ext = repoPath.split('.').pop() ?? '';
  return <CodeBlock code={state.data} lang={normaliseLang(ext)} caption={repoPath} />;
}
