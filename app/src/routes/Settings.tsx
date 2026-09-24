import { useRef, useState } from 'react';
import { THEME_NAME, useProgress, useTheme } from '../lib/hooks.ts';
import type { ThemeChoice } from '../lib/hooks.ts';
import { exportState, parseImport, replaceState, resetAll, updateSettings } from '../lib/progress.ts';
import type { ProgressState } from '../lib/progress.ts';
import { useContent } from '../lib/content-context.ts';
import Stat from '../components/Stat.tsx';

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

function summary(state: ProgressState): string {
  return (
    `${Object.keys(state.cards).length} cards, ${Object.keys(state.steps).length} steps, ` +
    `${state.sessions.length} sessions, best streak ${state.streak.longest}`
  );
}

export default function Settings() {
  const content = useContent();
  const progress = useProgress();
  const theme = useTheme();
  const [message, setMessage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const download = () => {
    const blob = new Blob([exportState()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `devpath-progress-${new Date().toISOString().slice(0, 10)}.json`;
    // Firefox and Safari need the anchor in the document, and revoking the URL
    // in the same tick can cancel the download.
    document.body.append(link);
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      link.remove();
    });
  };

  const importFile = async (file: File) => {
    if (file.size > MAX_IMPORT_BYTES) {
      setMessage('That file is too large to be a DevPath export.');
      return;
    }
    let next: ProgressState;
    try {
      next = parseImport(await file.text());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not read that file.');
      return;
    }
    const ok = confirm(
      `Replace your progress with this file?\n\nFile: ${summary(next)}\nNow: ${summary(progress)}`,
    );
    if (!ok) {
      setMessage('Import cancelled. Nothing changed.');
      return;
    }
    replaceState(next);
    setMessage(`Progress restored: ${summary(next)}.`);
  };

  return (
    <div className="page narrow stack stack-4">
      <header className="page-head">
        <h1>Settings</h1>
        <p className="lede">
          Progress is stored in this browser's localStorage. Nothing is uploaded anywhere — which
          also means clearing site data wipes it, so export a copy if you care about the streak.
        </p>
      </header>

      <section className="card stack stack-4">
        <h2>Drills</h2>

        <label className="stack stack-2">
          <span>
            Seconds per question <span className="faint">— 0 turns the timer off</span>
          </span>
          <select
            value={progress.settings.seconds}
            onChange={(event) => updateSettings({ seconds: Number(event.target.value) })}
          >
            <option value={0}>No timer</option>
            <option value={20}>20s — interview pace</option>
            <option value={30}>30s</option>
            <option value={45}>45s (default)</option>
            <option value={90}>90s — read carefully</option>
            {![0, 20, 30, 45, 90].includes(progress.settings.seconds) && (
              <option value={progress.settings.seconds}>{progress.settings.seconds}s</option>
            )}
          </select>
        </label>

        <label className="stack stack-2">
          <span>Difficulty ceiling</span>
          <select
            value={progress.settings.maxLevel}
            onChange={(event) => updateSettings({ maxLevel: Number(event.target.value) as 1 | 2 | 3 })}
          >
            <option value={1}>★ — fundamentals only</option>
            <option value={2}>★★ — up to real-code questions</option>
            <option value={3}>★★★ — everything (default)</option>
          </select>
        </label>

        <label className="stack stack-2">
          <span>
            New questions per day <span className="faint">— how many never-seen questions Today's plan adds</span>
          </span>
          <select
            value={progress.settings.newPerDay}
            onChange={(event) => updateSettings({ newPerDay: Number(event.target.value) })}
          >
            {[0, 5, 10, 15, 20].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'None — reviews only' : n === 10 ? '10 (default)' : n}
              </option>
            ))}
            {![0, 5, 10, 15, 20].includes(progress.settings.newPerDay) && (
              <option value={progress.settings.newPerDay}>{progress.settings.newPerDay}</option>
            )}
          </select>
        </label>

        <label className="row gap-2">
          <input
            type="checkbox"
            checked={progress.settings.explain}
            onChange={(event) => updateSettings({ explain: event.target.checked })}
          />
          <span>Show the explanation straight after answering</span>
        </label>
      </section>

      <section className="card stack stack-3">
        <h2>Appearance</h2>
        <label className="stack stack-2">
          <span>Theme</span>
          <select value={theme.choice} onChange={(event) => theme.setChoice(event.target.value as ThemeChoice)}>
            {(['system', 'light', 'dark'] as const).map((choice) => (
              <option key={choice} value={choice}>
                {THEME_NAME[choice]}
                {choice === 'system' ? ' (follows your OS)' : ''}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="card stack stack-3">
        <h2>Your data</h2>
        <div className="row">
          <button className="btn" onClick={download}>
            Export progress
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            aria-label="Progress file to import"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) await importFile(file);
            }}
          />
          <button
            className="btn danger"
            onClick={() => {
              if (
                confirm(
                  'Erase every tick, note, saved question and drill result? Your drill settings are kept. This cannot be undone.',
                )
              ) {
                resetAll();
                setMessage('Progress cleared.');
              }
            }}
          >
            Reset everything
          </button>
        </div>
        <p className="faint m-0" role="status">
          {message}
        </p>
      </section>

      <section className="card">
        <h2>Content</h2>
        <div className="stat-row mt-3">
          <Stat value={content.stats.projects} label="projects" />
          <Stat value={content.stats.questions} label="questions" />
          <Stat value={content.stats.guides} label="guides" />
          <Stat value={content.stats.modules} label="modules" />
        </div>
        <p className="faint mt-3">
          Built {new Date(content.stats.generatedAt).toLocaleString()}. Regenerate with{' '}
          <span className="mono">npm run content</span>.
        </p>
      </section>
    </div>
  );
}
