import { useEffect, useRef, useState } from 'react';

/**
 * Copies `text`. Where the clipboard API is missing or refused (plain http,
 * an old browser), it selects the command next to it instead so Ctrl-C works.
 */
export default function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'selected'>('idle');
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (state === 'idle') return;
    const id = setTimeout(() => setState('idle'), 1500);
    return () => clearTimeout(id);
  }, [state]);

  const selectSibling = () => {
    const code = ref.current?.parentElement?.querySelector('code');
    const selection = window.getSelection?.();
    if (!code || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(code);
    selection.removeAllRanges();
    selection.addRange(range);
    setState('selected');
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      selectSibling();
    }
  };

  // The live region sits next to the button, not inside it: a status nested
  // in a control is announced unreliably.
  return (
    <>
      <button ref={ref} className="btn sm ghost" onClick={copy} aria-label={`Copy: ${label}`}>
        {state === 'copied' ? 'Copied ✓' : state === 'selected' ? 'Selected — Ctrl C' : 'Copy'}
      </button>
      <span className="sr-only" role="status">
        {state === 'copied' ? 'Copied to the clipboard' : ''}
      </span>
    </>
  );
}
