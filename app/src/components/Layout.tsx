import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useMemo } from 'react';
import { allQuestions } from '../lib/content.ts';
import { useKey, useProgress, useTheme } from '../lib/hooks.ts';
import { overallCompletion } from '../lib/selectors.ts';
import type { Content } from '../lib/types.ts';
import CommandBar from './CommandBar.tsx';

const NAV = [
  { to: '/', glyph: '◆', label: 'Today', end: true },
  { to: '/path', glyph: '△', label: 'The path' },
  { to: '/drill', glyph: '⚡', label: 'Drills' },
  { to: '/library', glyph: '▦', label: 'Projects' },
  { to: '/guides', glyph: '◉', label: 'Guides' },
  { to: '/progress', glyph: '◴', label: 'Progress' },
];

export default function Layout({ content }: { content: Content }) {
  const progress = useProgress();
  const [theme, toggleTheme] = useTheme();
  const navigate = useNavigate();

  const dueCount = useMemo(() => {
    const now = Date.now();
    return allQuestions(content).filter((q) => {
      const card = progress.cards[q.id];
      return card === undefined || card.due <= now;
    }).length;
  }, [content, progress.cards]);

  const overall = overallCompletion(content.roadmap, progress);

  useKey(['/'], () => navigate('/library'));

  return (
    <div className="shell">
      <aside className="sidebar">
        <NavLink to="/" className="brand">
          <span className="brand-mark">D</span>
          <span className="brand-text">
            <strong>DevPath</strong>
            <span>noob → mid-level</span>
          </span>
        </NavLink>

        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <span className="glyph" aria-hidden="true">
              {item.glyph}
            </span>
            {item.label}
            {item.to === '/drill' && dueCount > 0 && (
              <span className="count hot">{dueCount > 999 ? '999+' : dueCount}</span>
            )}
            {item.to === '/path' && (
              <span className="count">{Math.round(overall.ratio * 100)}%</span>
            )}
          </NavLink>
        ))}

        <div className="nav-group">Reference</div>
        <NavLink to="/doc/HANDBOOK.md" className="nav-item">
          <span className="glyph" aria-hidden="true">
            {'≡'}
          </span>
          JS handbook
        </NavLink>
        <NavLink to="/doc/react/HANDBOOK.md" className="nav-item">
          <span className="glyph" aria-hidden="true">
            {'≡'}
          </span>
          React handbook
        </NavLink>
        <NavLink to="/doc/typescript/HANDBOOK.md" className="nav-item">
          <span className="glyph" aria-hidden="true">
            {'≡'}
          </span>
          TS handbook
        </NavLink>
        <NavLink to="/doc/csharp/HANDBOOK.md" className="nav-item">
          <span className="glyph" aria-hidden="true">
            {'≡'}
          </span>
          C# handbook
        </NavLink>

        <div className="sidebar-foot">
          <button className="btn sm ghost" onClick={toggleTheme} title="Toggle theme">
            {theme === 'dark' ? '◑ Light' : '◐ Dark'}
          </button>
          <NavLink to="/settings" className="btn sm ghost">
            Settings
          </NavLink>
        </div>
      </aside>

      <main className="main">
        <CommandBar content={content} />
        <Outlet />
      </main>
    </div>
  );
}
