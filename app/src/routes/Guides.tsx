import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { HANDBOOKS } from '../lib/content.ts';
import { readingMinutes } from '../lib/format.ts';
import { useContent } from '../lib/content-context.ts';
import { useProgress } from '../lib/hooks.ts';
import { allSteps } from '../lib/selectors.ts';
import type { Guide, Stage } from '../lib/types.ts';

/**
 * The written material that has no project attached: HTTP, SQL, auth, Docker,
 * CI, the interview playbook. These are the topics that get asked about but
 * that you cannot learn by refactoring a JavaScript file.
 *
 * With nearly two hundred guides a flat grid is unusable, so they are grouped
 * by the stage that first schedules them (path order) and filterable by text.
 */

interface Placement {
  stage: Stage;
  read: boolean;
}

export default function Guides() {
  const content = useContent();
  const progress = useProgress();

  // Filters live in the URL so Back from a guide restores them.
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const hideRead = params.get('unread') === '1';
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

  /** Where each guide first appears on the path, and whether any of its steps is ticked. */
  const placement = useMemo(() => {
    const map = new Map<string, Placement>();
    for (const { stage, step, key } of allSteps(content.roadmap)) {
      if (step.kind !== 'guide') continue;
      const done = Boolean(progress.steps[key]);
      const seen = map.get(step.guide);
      if (seen) seen.read ||= done;
      else map.set(step.guide, { stage, read: done });
    }
    return map;
  }, [content.roadmap, progress.steps]);

  const groups = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = (g: Guide) => {
      if (!terms.length) return true;
      const haystack = `${g.title} ${g.blurb} ${g.headings.map((h) => h.text).join(' ')}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    };

    const byStage = new Map<string, { title: string; guides: Guide[] }>();
    for (const stage of content.roadmap.stages) byStage.set(stage.id, { title: stage.title, guides: [] });
    const offPath: Guide[] = [];

    for (const guide of content.guides) {
      if (!matches(guide)) continue;
      const where = placement.get(guide.id);
      if (hideRead && where?.read) continue;
      if (where) byStage.get(where.stage.id)?.guides.push(guide);
      else offPath.push(guide);
    }

    const list = [...byStage.entries()]
      .filter(([, g]) => g.guides.length > 0)
      .map(([id, g]) => ({ id, ...g }));
    if (offPath.length) list.push({ id: 'off-path', title: 'Not on the path', guides: offPath });
    return list;
  }, [content.guides, content.roadmap, placement, query, hideRead]);

  const words = content.guides.reduce((n, g) => n + g.words, 0);
  const readCount = [...placement.values()].filter((p) => p.read).length;
  const shown = groups.reduce((n, g) => n + g.guides.length, 0);

  return (
    <div className="page wide stack stack-4">
      <header className="page-head">
        <div className="eyebrow">
          {content.guides.length} guides · ~{Math.round(words / 220 / 60)}h of reading · {readCount} read
        </div>
        <h1>Guides</h1>
        <p className="lede">
          The parts of the job that are not a JavaScript file: how HTTP works, how to write a JOIN,
          where a token should live, what the pipeline is doing. Each one is written to answer the
          questions an interviewer asks about it.
        </p>
      </header>

      <div className="row">
        <input
          type="search"
          className="filter-input"
          placeholder="Filter guides…"
          aria-label="Filter guides"
          value={query}
          onChange={(event) => setFilter('q', event.target.value || undefined)}
        />
        <button
          className={`btn sm${hideRead ? ' primary' : ' ghost'}`}
          aria-pressed={hideRead}
          onClick={() => setFilter('unread', hideRead ? undefined : '1')}
        >
          Hide read
        </button>
        <span className="faint" aria-live="polite">
          {shown} shown
        </span>
      </div>

      {groups.length === 0 && <div className="empty">No guide matches that filter.</div>}

      {groups.map((group) => (
        <section key={group.id} className="stack stack-3" aria-labelledby={`guides-${group.id}`}>
          <h2 id={`guides-${group.id}`}>
            {group.title} <span className="faint">· {group.guides.length}</span>
          </h2>
          <div className="grid cols-320">
            {group.guides.map((guide) => (
              <Link key={guide.id} to={`/guide/${guide.id}`} className="card link">
                <div className="spread align-start">
                  <h3>{guide.title}</h3>
                  <span className="row">
                    {placement.get(guide.id)?.read && <span className="pill good">✓ Read</span>}
                    <span className="pill">{readingMinutes(guide.words)} min</span>
                  </span>
                </div>
                <p className="faint mt-2 mb-3">
                  {guide.blurb.slice(0, 150)}
                  {guide.blurb.length > 150 ? '…' : ''}
                </p>
                <div className="faint">
                  {guide.headings.slice(0, 3).map((h) => h.text).join(' · ')}
                  {guide.headings.length > 3 ? ' …' : ''}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}

      <section className="card">
        <h2>Track handbooks</h2>
        <p className="faint mt-1">
          Cover-to-cover references for each language, written to be read offline.
        </p>
        <div className="row mt-3">
          {HANDBOOKS.map((book) => (
            <Link key={book.doc} className="btn ghost" to={`/doc/${book.doc}`}>
              {book.label}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
