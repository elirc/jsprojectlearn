/** Small formatting helpers shared by several routes. */

export const pct = (ratio: number): number => Math.round(ratio * 100);

export const readingMinutes = (words: number): number => Math.max(1, Math.round(words / 220));

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/**
 * Question text is plain text with the odd `code span` in backticks. This is
 * the whole renderer for it: escape everything, then turn ```x``` and `x` into
 * <code>. No other markdown — a question stem should never grow a heading.
 * Unmatched backticks are left as they are.
 */
export function inlineCode(text: string): string {
  return escapeHtml(text).replace(
    /```([\s\S]+?)```|`([^`\n]+?)`/g,
    (_, fenced: string | undefined, span: string | undefined) =>
      `<code>${(fenced ?? span ?? '').trim()}</code>`,
  );
}

/** "3 Sep" style dates for lists. */
export const shortDate = (at: number): string =>
  new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
