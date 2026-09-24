import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useContent } from '../lib/content-context.ts';
import { shouldIgnoreKey } from '../lib/hooks.ts';
import { buildSearch, hrefFor, searchRows } from '../lib/search.ts';
import type { SearchRow } from '../lib/types.ts';

/**
 * Ctrl/Cmd-K (or `/`) search across pages, the path, guides and their
 * sections, projects and decks. (react/58-command-palette is the long-form
 * version of this component.)
 *
 * The dialog is modal: focus moves into it, Tab cannot leave it, and closing
 * it puts focus back where it was.
 */
export default function CommandBar() {
  const content = useContent();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const navigate = useNavigate();

  const index = useMemo(() => buildSearch(content), [content]);
  const groups = useMemo(() => searchRows(index, query), [index, query]);
  const hits = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  const active = Math.min(cursor, Math.max(0, hits.length - 1));

  const show = () => {
    if (!open) returnTo.current = document.activeElement as HTMLElement | null;
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setQuery('');
    setCursor(0);
  };

  // Attached once; the effect event always sees the current `open`.
  const onWindowKey = useEffectEvent((event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (open) close();
      else show();
    } else if (event.key === 'Escape' && open) {
      close();
    } else if (event.key === '/' && !open && !shouldIgnoreKey(event)) {
      event.preventDefault();
      show();
    }
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => onWindowKey(event);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      return;
    }
    // Back to whatever had focus before the dialog opened (the trigger, usually).
    const target = returnTo.current;
    returnTo.current = null;
    if (target?.isConnected) target.focus();
  }, [open]);

  // Keep the highlighted row visible while arrowing through a long list.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active, open]);

  const go = (row: SearchRow) => {
    returnTo.current = null; // focus belongs to the new page now
    close();
    navigate(hrefFor(row));
  };

  const onInputKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor(Math.min(active + 1, hits.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor(Math.max(active - 1, 0));
    } else if (event.key === 'Enter') {
      const hit = hits[active];
      if (hit) go(hit);
    } else if (event.key === 'Tab') {
      // The input is the dialog's only tab stop; results are reached with arrows.
      event.preventDefault();
    }
  };

  const optionId = (row: SearchRow) => `cmd-opt-${row.kind}-${row.id}`.replace(/[^\w-]/g, '_');
  const activeRow = hits[active];

  return (
    <>
      <button className="nav-item cmd-trigger" onClick={show} aria-haspopup="dialog">
        <span className="glyph" aria-hidden="true">
          ⌕
        </span>
        Search
        <span className="kbd">Ctrl K</span>
      </button>

      {open && (
        <div className="cmd-overlay" onClick={close}>
          <div
            className="card cmd-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Search"
            onClick={(event) => event.stopPropagation()}
          >
            <input
              ref={inputRef}
              type="search"
              role="combobox"
              aria-expanded={hits.length > 0}
              aria-controls="cmd-list"
              aria-autocomplete="list"
              aria-activedescendant={activeRow ? optionId(activeRow) : undefined}
              aria-label="Search DevPath"
              placeholder="Search pages, guides, sections, projects, decks…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCursor(0);
              }}
              onKeyDown={onInputKey}
            />
            <div className="cmd-list" id="cmd-list" role="listbox" aria-label="Results" ref={listRef}>
              {groups.map((group) => (
                <div key={group.label} role="group" aria-label={group.label}>
                  <div className="search-group" aria-hidden="true">
                    {group.label}
                  </div>
                  {group.rows.map((row) => {
                    const i = hits.indexOf(row);
                    return (
                      <div
                        key={`${row.kind}:${row.id}`}
                        id={optionId(row)}
                        role="option"
                        aria-selected={i === active}
                        className="search-hit"
                        onMouseEnter={() => setCursor(i)}
                        onClick={() => go(row)}
                      >
                        <strong>{row.title}</strong>
                        <div className="faint">{row.sub}</div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {query && hits.length === 0 && <div className="empty">Nothing matches “{query}”.</div>}
            {!query && (
              <p className="faint cmd-hint">
                Search {content.stats.projects} projects, {content.guides.length} guides and their sections,{' '}
                {content.stats.modules} modules and {content.decks.length} decks. ↑↓ to move, Enter to open.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
