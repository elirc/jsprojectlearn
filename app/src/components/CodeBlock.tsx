import { useMemo } from 'react';
import { highlight } from '../lib/highlight.ts';

/**
 * A highlighted code figure. Memoised because drill screens re-render on
 * every progress commit and the highlighter is a regex pass over the source.
 */
export default function CodeBlock({ code, lang, caption }: { code: string; lang?: string; caption?: string }) {
  const html = useMemo(() => highlight(code, lang ?? ''), [code, lang]);
  return (
    <figure className="code">
      <figcaption>{caption ?? lang ?? 'code'}</figcaption>
      <pre>
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </figure>
  );
}
