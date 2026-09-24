import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { TRACK_LABEL } from '../lib/content.ts';
import { useContent } from '../lib/content-context.ts';
import { useProgress } from '../lib/hooks.ts';
import type { Project, TrackId } from '../lib/types.ts';
import { stepKey } from '../lib/types.ts';

const TRACKS: (TrackId | 'all')[] = ['all', 'js', 'ts', 'react', 'csharp'];

interface Scheduled {
  level: number;
  /** Position in roadmap order, for sorting the on-path view. */
  order: number;
  done: boolean;
}

export default function Library() {
  const content = useContent();
  const progress = useProgress();

  // Filters live in the URL so Back from a project restores them.
  const [params, setParams] = useSearchParams();
  const rawTrack = params.get('track');
  const track: TrackId | 'all' = TRACKS.includes(rawTrack as TrackId) ? (rawTrack as TrackId) : 'all';
  const query = params.get('q') ?? '';
  const onPathOnly = params.get('path') === '1';

  const setFilter = (key: string, value: string | undefined) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  };

  /** Projects the roadmap actually schedules, and where. */
  const onPath = useMemo(() => {
    const map = new Map<string, Scheduled>();
    let order = 0;
    for (const stage of content.roadmap.stages) {
      for (const mod of stage.modules) {
        for (const step of mod.steps) {
          if (step.kind !== 'build' || map.has(step.project)) continue;
          map.set(step.project, {
            level: stage.level,
            order: order++,
            done: Boolean(progress.steps[stepKey(mod.id, step)]),
          });
        }
      }
    }
    return map;
  }, [content.roadmap, progress.steps]);

  const filtered = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const list = content.projects.filter((project) => {
      if (track !== 'all' && project.track !== track) return false;
      if (onPathOnly && !onPath.has(project.id)) return false;
      if (!terms.length) return true;
      const haystack = `${project.title} ${project.name} ${project.blurb}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    });
    if (onPathOnly) list.sort((a, b) => (onPath.get(a.id)?.order ?? 0) - (onPath.get(b.id)?.order ?? 0));
    return list;
  }, [content.projects, track, query, onPathOnly, onPath]);

  const filtering = track !== 'all' || query !== '' || onPathOnly;

  return (
    <div className="page wide stack stack-4">
      <header className="page-head">
        <div className="eyebrow">{content.stats.projects} projects</div>
        <h1>Project library</h1>
        <p className="lede">
          Every project is the same shape: a working-but-flawed <span className="mono">original</span>, a{' '}
          <span className="mono">refactored/</span> version, and a README explaining what changed. The path
          schedules the ones that matter for CRUD work — the rest are here when you want depth.
        </p>
      </header>

      <div className="row">
        <div className="tabs filter-tabs" role="group" aria-label="Track">
          {TRACKS.map((id) => (
            <button
              key={id}
              className={`tab${track === id ? ' active' : ''}`}
              aria-pressed={track === id}
              onClick={() => setFilter('track', id === 'all' ? undefined : id)}
            >
              {id === 'all' ? 'All' : TRACK_LABEL[id]}
              <span className="faint ml-2">
                {id === 'all' ? content.projects.length : content.projects.filter((p) => p.track === id).length}
              </span>
            </button>
          ))}
        </div>
        <input
          type="search"
          className="filter-input"
          placeholder="Filter…"
          aria-label="Filter projects"
          value={query}
          onChange={(event) => setFilter('q', event.target.value || undefined)}
        />
        <button
          className={`btn sm${onPathOnly ? ' primary' : ' ghost'}`}
          aria-pressed={onPathOnly}
          onClick={() => setFilter('path', onPathOnly ? undefined : '1')}
        >
          On the path only
        </button>
      </div>

      <div className="faint">{filtered.length} shown</div>

      <div className="grid cols-300">
        {filtered.map((project) => (
          <ProjectCard key={project.id} project={project} scheduled={onPath.get(project.id)} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="empty">
          <p>No project matches that filter.</p>
          {filtering && (
            <button className="btn sm ghost" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
              Clear filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project, scheduled }: { project: Project; scheduled: Scheduled | undefined }) {
  return (
    <Link to={`/project/${project.id}`} className="card link">
      <div className="row mb-2">
        <span className={`pill ${project.track}`}>{TRACK_LABEL[project.track]}</span>
        <span className="faint mono">#{project.number}</span>
        {scheduled?.done && <span className="pill good">✓ done</span>}
        {scheduled && !scheduled.done && <span className="pill accent">L{scheduled.level} · on path</span>}
      </div>
      <h3 className="mb-2">{project.title}</h3>
      <p className="faint m-0">
        {project.blurb.slice(0, 130)}
        {project.blurb.length > 130 ? '…' : ''}
      </p>
      <div className="row faint mt-3">
        <span>{project.docs.length} docs</span>
        <span>{project.sources.length} files</span>
        {project.hasTests && <span>tests</span>}
      </div>
    </Link>
  );
}
