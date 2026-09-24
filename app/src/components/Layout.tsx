import { useEffect, useMemo, useRef } from 'react';
import type { MouseEvent } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import ErrorBoundary from './ErrorBoundary.tsx';
import { HANDBOOKS } from '../lib/content.ts';
import { THEME_LABEL, useNow, useProgress, useTheme } from '../lib/hooks.ts';
import { progressStore } from '../lib/progress.ts';
import { overallCompletion } from '../lib/selectors.ts';
import { dueSummary } from '../lib/session.ts';
import CommandBar from './CommandBar.tsx';
import { useContent } from '../lib/content-context.ts';

const NAV = [
  { to: '/', glyph: '◆', label: 'Today', end: true },
  { to: '/path', glyph: '△', label: 'The path' },
  { to: '/drill', glyph: '⚡', label: 'Drills' },
  { to: '/library', glyph: '▦', label: 'Projects' },
  { to: '/guides', glyph: '◉', label: 'Guides' },
  { to: '/progress', glyph: '◴', label: 'Progress' },
];

export default function Layout() {
  const content = useContent();
  const progress = useProgress();
  const theme = useTheme();
  const now = useNow();
  const questions = content.questions;

  // Reviews only: a question you have never seen is "new", not "due". A badge
  // that says 450 on day one teaches people to ignore it.
  const { due } = useMemo(
    () => dueSummary(questions, progress.cards, now, progress.settings.maxLevel),
    [questions, progress.cards, now, progress.settings.maxLevel],
  );

  const overall = overallCompletion(content.roadmap, progress);

  // On a route change, move focus to the new page (not on first load, where
  // the browser's own focus is right). Screen readers then start reading the
  // page instead of staying on the link that was clicked.
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const firstPath = useRef(pathname);
  useEffect(() => {
    if (pathname === firstPath.current) return;
    firstPath.current = '';
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  const skip = (event: MouseEvent<HTMLAnchorElement>) => {
    // A plain #main href would be a route under HashRouter.
    event.preventDefault();
    mainRef.current?.focus();
  };

  return (
    <div className="shell">
      <a className="skip-link" href="#main" onClick={skip}>
        Skip to content
      </a>
      <aside className="sidebar">
        <NavLink to="/" className="brand">
          <span className="brand-mark">D</span>
          <span className="brand-text">
            <strong>DevPath</strong>
            <span>noob → mid-level</span>
          </span>
        </NavLink>

        <CommandBar />

        <nav aria-label="Main" className="nav-list">
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
            {item.to === '/drill' && due > 0 && (
              <span className="count hot" title={`${due} reviews due`}>
                {due > 99 ? '99+' : due}
              </span>
            )}
            {item.to === '/path' && (
              <span className="count">{Math.round(overall.ratio * 100)}%</span>
            )}
          </NavLink>
        ))}
        </nav>

        <div className="nav-group">Reference</div>
        {HANDBOOKS.map((book) => (
          <NavLink key={book.doc} to={`/doc/${book.doc}`} className="nav-item ref">
            <span className="glyph" aria-hidden="true">
              {'≡'}
            </span>
            {book.nav}
          </NavLink>
        ))}

        <div className="sidebar-foot">
          <button
            className="btn sm ghost"
            onClick={theme.cycle}
            title="Theme: system, light or dark"
            aria-label={`Theme: ${theme.choice}. Change theme`}
          >
            {THEME_LABEL[theme.choice]}
          </button>
          <NavLink to="/settings" className="btn sm ghost">
            Settings
          </NavLink>
        </div>
      </aside>

      <main className="main" id="main" tabIndex={-1} ref={mainRef}>
        {!progressStore.isPersisted() && (
          <div className="banner persist-warning" role="alert">
            Progress isn't being saved in this browser (storage is blocked or full). Export a copy
            from Settings before you close the tab.
          </div>
        )}
        <ErrorBoundary key={pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
