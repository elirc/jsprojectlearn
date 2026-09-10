import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Content, SearchRow } from '../lib/types.ts';

/**
 * Ctrl/Cmd-K search across projects, modules and decks.
 *
 * The whole index is a few hundred rows, so scoring every row on every
 * keystroke is cheaper than any index structure would be — and much easier to
 * read. (react/58-command-palette is the long-form version of this component.)
 */

function score(row: SearchRow, terms: string[]): number {
  const title = row.title.toLowerCase();
  const haystack = `${title} ${row.sub} ${row.text}`.toLowerCase();
  let total = 0;
  for (const term of terms) {
    if (title.startsWith(term)) total += 6;
    else if (title.includes(term)) total += 4;
    else if (haystack.includes(term)) total += 1;
    else return -1;
  }
  return total;
}

function hrefFor(row: SearchRow): string {
  if (row.kind === 'project') return `/project/${row.id}`;
  if (row.kind === 'deck') return `/drill/${row.id}`;
  return `/path/${row.id.split('/')[0]}`;
}

const KIND_LABEL: Record<SearchRow['kind'], string> = {
  project: 'Project',
  deck: 'Deck',
  module: 'Module',
};

export default function CommandBar({ content }: { content: Content }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((wasOpen) => !wasOpen);
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else {
      setQuery('');
      setCursor(0);
    }
  }, [open]);

  const hits = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return content.search
      .map((row) => ({ row, points: score(row, terms) }))
      .filter((hit) => hit.points >= 0)
      .sort((a, b) => b.points - a.points)
      .slice(0, 12)
      .map((hit) => hit.row);
  }, [content.search, query]);

  if (!open) {
    return (
      <div className="row" style={{ padding: '14px 32px 0', justifyContent: 'flex-end' }}>
        <button className="btn sm ghost" onClick={() => setOpen(true)}>
          Search <span className="kbd">Ctrl K</span>
        </button>
      </div>
    );
  }

  const go = (row: SearchRow) => {
    navigate(hrefFor(row));
    setOpen(false);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgb(0 0 0 / 0.45)',
        zIndex: 50,
        display: 'grid',
        placeItems: 'start center',
        paddingTop: '12vh',
      }}
      onClick={() => setOpen(false)}
    >
      <div
        className="card"
        style={{ width: 'min(620px, 92vw)', padding: 10 }}
        onClick={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="search"
          placeholder="Search projects, modules, decks…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setCursor((c) => Math.min(c + 1, hits.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
            } else if (event.key === 'Enter') {
              const hit = hits[cursor];
              if (hit) go(hit);
            }
          }}
        />
        <div style={{ marginTop: 8, maxHeight: '52vh', overflowY: 'auto' }}>
          {hits.map((row, index) => (
            <button
              key={`${row.kind}:${row.id}`}
              className="search-hit"
              style={{
                width: '100%',
                textAlign: 'left',
                border: index === cursor ? '1px solid var(--accent)' : '1px solid transparent',
                background: index === cursor ? 'var(--bg-inset)' : 'transparent',
                cursor: 'pointer',
              }}
              onMouseEnter={() => setCursor(index)}
              onClick={() => go(row)}
            >
              <div className="spread">
                <strong style={{ fontSize: 14 }}>{row.title}</strong>
                <span className="pill">{KIND_LABEL[row.kind]}</span>
              </div>
              <div className="faint">{row.sub}</div>
            </button>
          ))}
          {query && hits.length === 0 && <div className="empty">Nothing matches “{query}”.</div>}
          {!query && (
            <div className="faint" style={{ padding: '10px 12px' }}>
              Type to search {content.stats.projects} projects, {content.stats.modules} modules and{' '}
              {content.stats.questions} questions.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
