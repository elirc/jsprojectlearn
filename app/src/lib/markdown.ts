import { Marked } from 'marked';
import { highlight } from './highlight.ts';

/**
 * Markdown for repo documents.
 *
 * Two things beyond plain rendering:
 *  - code fences go through our highlighter,
 *  - links are rewritten so that a relative link inside a project README
 *    navigates the app instead of 404ing against the dev server.
 */

export interface RenderOptions {
  /** Repo-relative directory the document was loaded from, e.g. "react/03-key-prop". */
  baseDir?: string;
}

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

function createMarked(options: RenderOptions): Marked {
  const marked = new Marked({ gfm: true, breaks: false });

  marked.use({
    renderer: {
      code({ text, lang }) {
        const label = (lang ?? '').split(/\s+/)[0] ?? '';
        return (
          `<figure class="code"><figcaption>${label || 'code'}</figcaption>` +
          `<pre><code>${highlight(text, label)}</code></pre></figure>`
        );
      },
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const id = slugify(text.replace(/<[^>]+>/g, ''));
        return `<h${depth} id="${id}">${text}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const resolved = resolveHref(href, options.baseDir);
        const external = /^https?:/i.test(resolved);
        const attrs = [
          `href="${resolved}"`,
          title ? `title="${title}"` : '',
          external ? 'target="_blank" rel="noreferrer noopener"' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return `<a ${attrs}>${text}</a>`;
      },
    },
  });

  return marked;
}

/**
 * A link like `../41-lru-cache/` inside js/27-memoize/README.md should open
 * that project in the app. Anything we cannot resolve is left alone.
 */
function resolveHref(href: string, baseDir?: string): string {
  if (!href) return '#';
  if (/^(https?:|mailto:|#)/i.test(href)) return href;

  const [rawPath = '', hash = ''] = href.split('#');
  const joined = baseDir ? normalise(`${baseDir}/${rawPath}`) : normalise(rawPath);
  const suffix = hash ? `#${hash}` : '';

  // A directory-ish link that matches a project folder becomes an app route.
  const project = joined.replace(/\/+$/, '');
  const match = /^(?:(react|typescript|csharp)\/)?(\d{2}-[a-z0-9-]+)$/.exec(project);
  if (match) {
    const track = { react: 'react', typescript: 'ts', csharp: 'csharp' }[match[1] ?? ''] ?? 'js';
    return `#/project/${track}/${match[2]}${suffix}`;
  }
  if (/\.md$/i.test(joined)) return `#/doc/${joined}${suffix}`;
  return `#/doc/${joined}${suffix}`;
}

function normalise(pathish: string): string {
  const parts: string[] = [];
  for (const segment of pathish.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
}

export function renderMarkdown(markdown: string, options: RenderOptions = {}): string {
  return createMarked(options).parse(markdown, { async: false });
}

/** Table of contents from the H2s, for the sidebar of long guides. */
export function tableOfContents(markdown: string): { id: string; text: string }[] {
  return [...markdown.matchAll(/^##\s+(.+)$/gm)].map((m) => {
    const text = (m[1] ?? '').trim();
    return { id: slugify(text), text };
  });
}
