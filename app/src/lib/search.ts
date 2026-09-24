/**
 * The Ctrl-K index: the shipped rows (projects, decks, modules) plus rows
 * built here from content the app already has — pages, stages, guides and
 * guide sections. A few hundred rows; scoring all of them per keystroke is
 * cheaper than any index structure would be.
 */

import type { Content, SearchRow } from './types.ts';

export const PAGES: { title: string; href: string }[] = [
  { title: 'Today', href: '/' },
  { title: 'The path', href: '/path' },
  { title: 'Drills', href: '/drill' },
  { title: 'Projects', href: '/library' },
  { title: 'Guides', href: '/guides' },
  { title: 'Progress', href: '/progress' },
  { title: 'Settings', href: '/settings' },
];

export function buildSearch(content: Content): SearchRow[] {
  const rows: SearchRow[] = PAGES.map((page) => ({
    kind: 'page',
    id: page.href,
    title: page.title,
    sub: 'Page',
    text: '',
  }));
  for (const stage of content.roadmap.stages) {
    rows.push({
      kind: 'stage',
      id: stage.id,
      title: `Level ${stage.level} · ${stage.title}`,
      sub: stage.tagline,
      text: stage.goal,
    });
  }
  for (const guide of content.guides) {
    rows.push({
      kind: 'guide',
      id: guide.id,
      title: guide.title,
      sub: guide.blurb,
      text: guide.headings.map((h) => h.text).join(' '),
    });
    for (const heading of guide.headings) {
      rows.push({
        kind: 'heading',
        id: `${guide.id}#${heading.id}`,
        title: heading.text,
        sub: `in ${guide.title}`,
        text: '',
      });
    }
  }
  return [...rows, ...content.search];
}

export function hrefFor(row: SearchRow): string {
  switch (row.kind) {
    case 'page':
      return row.id;
    case 'project':
      return `/project/${row.id}`;
    case 'deck':
      return `/drill/${row.id}`;
    case 'stage':
      return `/path/${row.id}`;
    case 'guide':
      return `/guide/${row.id}`;
    case 'heading':
      return `/guide/${row.id}`;
    case 'module': {
      // Shipped module rows are "stage/module": open the stage, land on the module.
      const [stage, module] = row.id.split('/');
      return `/path/${stage}#${module}`;
    }
  }
}

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

/** Display order of the result groups. */
export const GROUPS: { label: string; kinds: SearchRow['kind'][] }[] = [
  { label: 'Pages', kinds: ['page'] },
  { label: 'Path', kinds: ['stage', 'module'] },
  { label: 'Guides', kinds: ['guide'] },
  { label: 'Sections', kinds: ['heading'] },
  { label: 'Projects', kinds: ['project'] },
  { label: 'Decks', kinds: ['deck'] },
];

const CAP: Partial<Record<SearchRow['kind'], number>> = { heading: 5 };
const PER_KIND = 8;
const TOTAL = 14;

/**
 * Best hits, capped per kind so 200 guide sections can't bury the one
 * project you meant, then grouped in display order.
 */
export function searchRows(rows: SearchRow[], query: string): { label: string; rows: SearchRow[] }[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const perKind = new Map<string, number>();
  const hits: SearchRow[] = [];
  const ranked = rows
    .map((row) => ({ row, points: score(row, terms) }))
    .filter((hit) => hit.points >= 0)
    .sort((a, b) => b.points - a.points);
  for (const { row } of ranked) {
    const used = perKind.get(row.kind) ?? 0;
    if (used >= (CAP[row.kind] ?? PER_KIND)) continue;
    perKind.set(row.kind, used + 1);
    hits.push(row);
    if (hits.length >= TOTAL) break;
  }
  return GROUPS.map((group) => ({ label: group.label, rows: hits.filter((row) => group.kinds.includes(row.kind)) })).filter(
    (group) => group.rows.length > 0,
  );
}
