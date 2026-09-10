import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { TRACK_LABEL } from '../lib/content.ts';
import { useProgress } from '../lib/hooks.ts';
import type { Content, Project, TrackId } from '../lib/types.ts';
import { stepKey } from '../lib/types.ts';

const TRACKS: (TrackId | 'all')[] = ['all', 'js', 'ts', 'react', 'csharp'];

export default function Library({ content }: { content: Content }) {
  const progress = useProgress();
  const [track, setTrack] = useState<TrackId | 'all'>('all');
  const [query, setQuery] = useState('');
  const [onPathOnly, setOnPathOnly] = useState(false);

  /** Projects the roadmap actually schedules, and where. */
  const onPath = useMemo(() => {
    const map = new Map<string, { stage: string; done: boolean }>();
    for (const stage of content.roadmap.stages) {
      for (const mod of stage.modules) {
        mod.steps.forEach((step, index) => {
          if (step.kind !== 'build') return;
          map.set(step.project, {
            stage: stage.title,
            done: Boolean(progress.steps[stepKey(stage.id, mod.id, index)]),
          });
        });
      }
    }
    return map;
  }, [content.roadmap, progress.steps]);

  const filtered = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return content.projects.filter((project) => {
      if (track !== 'all' && project.track !== track) return false;
      if (onPathOnly && !onPath.has(project.id)) return false;
      if (!terms.length) return true;
      const haystack = `${project.title} ${project.name} ${project.blurb}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
  }, [content.projects, track, query, onPathOnly, onPath]);

  return (
    <div className="page wide stack stack-4">
      <header className="page-head">
        <div className="eyebrow">{content.stats.projects} projects</div>
        <h1>Project library</h1>
        <p className="lede">
          Every project is the same shape: a working-but-flawed <span className="mono">original</span>,
          a <span className="mono">refactored/</span> version, and a README explaining what changed.
          The path schedules the ones that matter for CRUD work — the rest are here when you want
          depth.
        </p>
      </header>

      <div className="row">
        <div className="tabs" style={{ border: 0, flex: '1 1 260px' }}>
          {TRACKS.map((id) => (
            <button
              key={id}
              className={`tab${track === id ? ' active' : ''}`}
              onClick={() => setTrack(id)}
            >
              {id === 'all' ? 'All' : TRACK_LABEL[id]}
              <span className="faint" style={{ marginLeft: 6 }}>
                {id === 'all'
                  ? content.projects.length
                  : content.projects.filter((p) => p.track === id).length}
              </span>
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Filter…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          style={{ maxWidth: 240 }}
        />
        <button
          className={`btn sm${onPathOnly ? ' primary' : ' ghost'}`}
          onClick={() => setOnPathOnly((v) => !v)}
        >
          On the path only
        </button>
      </div>

      <div className="faint">{filtered.length} shown</div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
        {filtered.map((project) => (
          <ProjectCard key={project.id} project={project} scheduled={onPath.get(project.id)} />
        ))}
      </div>

      {filtered.length === 0 && <div className="empty">No project matches that filter.</div>}
    </div>
  );
}

function ProjectCard({
  project,
  scheduled,
}: {
  project: Project;
  scheduled: { stage: string; done: boolean } | undefined;
}) {
  return (
    <Link to={`/project/${project.id}`} className="card" style={{ color: 'inherit', display: 'block' }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className={`pill ${project.track}`}>{TRACK_LABEL[project.track]}</span>
        <span className="faint mono">{project.name.slice(0, 2)}</span>
        {scheduled?.done && <span className="pill good">✓ done</span>}
        {scheduled && !scheduled.done && <span className="pill accent">on path</span>}
      </div>
      <h3 style={{ marginBottom: 6 }}>{project.title}</h3>
      <p className="faint" style={{ margin: 0 }}>
        {project.blurb.slice(0, 130)}
        {project.blurb.length > 130 ? '…' : ''}
      </p>
      <div className="row faint" style={{ marginTop: 12, gap: 12 }}>
        <span>{project.docs.length} docs</span>
        <span>{project.sources.length} files</span>
        {project.hasTests && <span>tests</span>}
      </div>
    </Link>
  );
}
