import { useRef, useState } from 'react';
import { useProgress } from '../lib/hooks.ts';
import { exportState, importState, resetAll, updateSettings } from '../lib/progress.ts';
import type { Content } from '../lib/types.ts';

export default function Settings({ content }: { content: Content }) {
  const progress = useProgress();
  const [message, setMessage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const download = () => {
    const blob = new Blob([exportState()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `devpath-progress-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page stack stack-4" style={{ maxWidth: 720 }}>
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
          </select>
        </label>

        <label className="stack stack-2">
          <span>Difficulty ceiling</span>
          <select
            value={progress.settings.maxLevel}
            onChange={(event) =>
              updateSettings({ maxLevel: Number(event.target.value) as 1 | 2 | 3 })
            }
          >
            <option value={1}>★ — fundamentals only</option>
            <option value={2}>★★ — up to real-code questions</option>
            <option value={3}>★★★ — everything (default)</option>
          </select>
        </label>

        <label className="row" style={{ gap: 8 }}>
          <input
            type="checkbox"
            checked={progress.settings.explain}
            onChange={(event) => updateSettings({ explain: event.target.checked })}
          />
          <span>Show the explanation straight after answering</span>
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
            accept="application/json"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              try {
                importState(await file.text());
                setMessage('Progress restored.');
              } catch (error) {
                setMessage(error instanceof Error ? error.message : 'Could not read that file.');
              }
              event.target.value = '';
            }}
          />
          <button
            className="btn danger"
            onClick={() => {
              if (confirm('Erase every tick, note and drill result? This cannot be undone.')) {
                resetAll();
                setMessage('Progress cleared.');
              }
            }}
          >
            Reset everything
          </button>
        </div>
        {message && <p className="faint">{message}</p>}
      </section>

      <section className="card">
        <h2>Content</h2>
        <div className="stat-row" style={{ marginTop: 12 }}>
          <div className="stat">
            <b>{content.stats.projects}</b>
            <span>projects</span>
          </div>
          <div className="stat">
            <b>{content.stats.questions}</b>
            <span>questions</span>
          </div>
          <div className="stat">
            <b>{content.stats.guides}</b>
            <span>guides</span>
          </div>
          <div className="stat">
            <b>{content.stats.modules}</b>
            <span>modules</span>
          </div>
        </div>
        <p className="faint" style={{ marginTop: 12 }}>
          Built {new Date(content.stats.generatedAt).toLocaleString()}. Regenerate with{' '}
          <span className="mono">npm run content</span>.
        </p>
      </section>
    </div>
  );
}
