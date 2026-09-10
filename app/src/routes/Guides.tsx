import { Link } from 'react-router-dom';
import type { Content } from '../lib/types.ts';

/**
 * The written material that has no project attached: HTTP, SQL, auth, Docker,
 * CI, the interview playbook. These are the topics that get asked about but
 * that you cannot learn by refactoring a JavaScript file.
 */
export default function Guides({ content }: { content: Content }) {
  const words = content.guides.reduce((n, g) => n + g.words, 0);

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

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
        {content.guides.map((guide) => (
          <Link
            key={guide.id}
            to={`/guide/${guide.id}`}
            className="card"
            style={{ color: 'inherit', display: 'block' }}
          >
            <div className="spread" style={{ alignItems: 'flex-start' }}>
              <h3>{guide.title}</h3>
              <span className="pill">{Math.max(1, Math.round(guide.words / 220))} min</span>
            </div>
            <p className="faint" style={{ margin: '8px 0 12px' }}>
              {guide.blurb.slice(0, 150)}
              {guide.blurb.length > 150 ? '…' : ''}
            </p>
            <div className="faint">
              {guide.headings.slice(0, 3).join(' · ')}
              {guide.headings.length > 3 ? ' …' : ''}
            </div>
          </Link>
        ))}
      </div>

      <section className="card">
        <h2>Track handbooks</h2>
        <p className="faint" style={{ marginTop: 4 }}>
          Cover-to-cover references for each language, written to be read offline.
        </p>
        <div className="row" style={{ marginTop: 12 }}>
          <Link className="btn ghost" to="/doc/HANDBOOK.md">
            JavaScript
          </Link>
          <Link className="btn ghost" to="/doc/typescript/HANDBOOK.md">
            TypeScript
          </Link>
          <Link className="btn ghost" to="/doc/react/HANDBOOK.md">
            React
          </Link>
          <Link className="btn ghost" to="/doc/csharp/HANDBOOK.md">
            C# / .NET
          </Link>
        </div>
      </section>
    </div>
  );
}
