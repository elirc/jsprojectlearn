import { Marked } from 'marked';
import type { Token, Tokens } from 'marked';
import { highlight } from './highlight.ts';

/**
 * Markdown for repo documents.
 *
 * Three things beyond plain rendering:
 *  - code fences go through our highlighter,
 *  - links are rewritten so that a relative link inside a project README
 *    navigates the app instead of 404ing against the dev server,
 *  - heading ids and the table of contents come from ONE slugger, so a TOC
 *    entry always lands on its heading.
 *
 * Raw HTML inside markdown passes through untouched. Every document rendered
 * here is authored in this repo, so that is a deliberate trust decision.
 */

export interface RenderOptions {
  /** Repo-relative directory the document was loaded from, e.g. "react/03-key-prop". */
  baseDir?: string;
  /**
   * The app route showing this document, e.g. "/doc/typescript/HANDBOOK.md".
   * Under HashRouter a bare "#section" link would otherwise be read as the
   * route "/section" and land on NotFound.
   */
  routePath?: string;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

const decodeEntities = (html: string): string =>
  html.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);

/** Plain text of rendered inline HTML: tags dropped, entities decoded. */
const plainText = (html: string): string => decodeEntities(html.replace(/<[^>]+>/g, ''));

export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');

/** A per-document slugger: repeated headings get -2, -3, … like GitHub. */
export function createSlugger(): (text: string) => string {
  const used = new Map<string, number>();
  return (text) => {
    const base = slugify(text);
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return n === 0 ? base : `${base}-${n + 1}`;
  };
}

const escapeAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function createMarked(options: RenderOptions): Marked {
  const marked = new Marked({ gfm: true, breaks: false });
  const slug = createSlugger();

  marked.use({
    renderer: {
      code({ text, lang }) {
        const label = (lang ?? '').split(/\s+/)[0] ?? '';
        return (
          `<figure class="code"><figcaption>${escapeAttr(label) || 'code'}</figcaption>` +
          `<pre><code>${highlight(text, label)}</code></pre></figure>`
        );
      },
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        return `<h${depth} id="${escapeAttr(slug(plainText(text)))}">${text}</h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        const resolved = resolveHref(href, options);
        const external = /^https?:/i.test(resolved);
        const attrs = [
          `href="${escapeAttr(resolved)}"`,
          title ? `title="${escapeAttr(title)}"` : '',
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
export function resolveHref(href: string, options: RenderOptions = {}): string {
  if (!href) return '#';
  if (href.startsWith('#')) return options.routePath ? `#${options.routePath}${href}` : href;
  if (/^(https?:|mailto:)/i.test(href)) return href;

  const [rawPath = '', hash = ''] = href.split('#');
  const joined = options.baseDir ? normalise(`${options.baseDir}/${rawPath}`) : normalise(rawPath);
  const suffix = hash ? `#${hash}` : '';

  // A directory-ish link that matches a project folder becomes an app route.
  const project = joined.replace(/\/+$/, '');
  const match = /^(?:(react|typescript|csharp)\/)?(\d{2}-[a-z0-9-]+)$/.exec(project);
  if (match) {
    const track = { react: 'react', typescript: 'ts', csharp: 'csharp' }[match[1] ?? ''] ?? 'js';
    return `#/project/${track}/${match[2]}${suffix}`;
  }
  // Guides are authored in content/modules/ but shipped under docs/guides/,
  // so a repo-relative link to one would 404 as a doc: open the guide route.
  const guide = /^content\/modules\/([a-z0-9-]+)\.md$/.exec(joined);
  if (guide) return `#/guide/${guide[1]}${suffix}`;
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

export interface Heading {
  id: string;
  text: string;
  depth: number;
}

/**
 * Every heading in document order, with the id the renderer will give it.
 * Walks the same lexer output the renderer sees so the dedupe counters agree.
 */
export function headings(markdown: string): Heading[] {
  const marked = new Marked({ gfm: true, breaks: false });
  const slug = createSlugger();
  const out: Heading[] = [];
  const visit = (tokens: Token[]) => {
    for (const token of tokens) {
      if (token.type === 'heading') {
        const heading = token as Tokens.Heading;
        const text = plainText(marked.parseInline(heading.text, { async: false }));
        out.push({ id: slug(text), text, depth: heading.depth });
      } else if (token.type === 'list') {
        for (const item of (token as Tokens.List).items) visit(item.tokens);
      } else if (token.type === 'blockquote') {
        visit((token as Tokens.Blockquote).tokens);
      }
    }
  };
  visit(marked.lexer(markdown));
  return out;
}

/** Table of contents from the H2s, for the sidebar of long guides. */
export function tableOfContents(markdown: string): { id: string; text: string }[] {
  return headings(markdown)
    .filter((h) => h.depth === 2)
    .map(({ id, text }) => ({ id, text }));
}

/** Every heading id in a document — used by the content build to validate anchors. */
export function headingIds(markdown: string): Set<string> {
  return new Set(headings(markdown).map((h) => h.id));
}
