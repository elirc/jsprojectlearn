import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { HANDBOOKS } from '../lib/content.ts';
import { readingMinutes } from '../lib/format.ts';
import { useContent } from '../lib/content-context.ts';
import { useProgress } from '../lib/hooks.ts';
import { stepsForTarget } from '../lib/selectors.ts';

/**
 * The written material that has no project attached: HTTP, SQL, auth, Docker,
 * CI, the interview playbook. These are the topics that get asked about but
 * that you cannot learn by refactoring a JavaScript file.
 */
export default function Guides() {
  const content = useContent();
  const progress = useProgress();
  const words = content.guides.reduce((n, g) => n + g.words, 0);
  // A guide is read once any path step pointing at it is ticked.
  const read = useMemo(
    () =>
      new Set(
        content.guides
          .filter((g) =>
            stepsForTarget(content.roadmap, { kind: 'guide', guide: g.id }).some((s) => progress.steps[s.key]),
          )
          .map((g) => g.id),
      ),
    [content.guides, content.roadmap, progress.steps],
  );

  return (
    <div className="page wide stack stack-4">
      <header className="page-head">
        <div className="eyebrow">
          {content.guides.length} guides · ~{Math.round(words / 220 / 60)}h of reading
        </div>
        <h1>Guides</h1>
        <p className="lede">
          The parts of the job that are not a JavaScript file: how HTTP works, how to write a JOIN,
          where a token should live, what the pipeline is doing. Each one is written to answer the
          questions an interviewer asks about it.
        </p>
      </header>

      <div className="grid cols-320">
        {content.guides.map((guide) => (
          <Link
            key={guide.id}
            to={`/guide/${guide.id}`}
            className="card link"
          >
            <div className="spread align-start">
              <h3>{guide.title}</h3>
              <span className="row">
                {read.has(guide.id) && <span className="pill good">✓ Read</span>}
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
