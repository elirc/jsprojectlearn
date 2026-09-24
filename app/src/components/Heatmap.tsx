import { heatmapCells } from '../lib/plan.ts';
import { dayKey } from '../lib/progress.ts';
import type { ProgressState } from '../lib/progress.ts';

const CELL = 12;
const GAP = 3;
const GUTTER = 22;
const LABELS: Record<number, string> = { 0: 'Mon', 2: 'Wed', 4: 'Fri' };

const label = (day: string): string =>
  new Date(`${day}T12:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

/**
 * Twelve weeks of practice, one square per day, darker for more work. One
 * hue, light to dark: this is magnitude, not identity. Each square carries
 * its numbers in a <title>, so hover (and a screen reader) gets the count.
 */
export default function Heatmap({ activity, now }: { activity: ProgressState['activity']; now: number }) {
  const cells = heatmapCells(activity, now);
  const today = dayKey(now);
  const weeks = Math.max(...cells.map((c) => c.week)) + 1;
  const active = cells.filter((c) => c.level > 0).length;
  const width = GUTTER + weeks * (CELL + GAP);
  const height = 7 * (CELL + GAP);

  return (
    <figure className="heatmap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${active} active days in the last ${weeks} weeks`}>
        {Object.entries(LABELS).map(([row, text]) => (
          <text key={row} x={0} y={Number(row) * (CELL + GAP) + CELL - 2} className="hm-label">
            {text}
          </text>
        ))}
        {cells
          .filter((c) => !c.future)
          .map((c) => (
            <rect
              key={c.day}
              x={GUTTER + c.week * (CELL + GAP)}
              y={c.weekday * (CELL + GAP)}
              width={CELL}
              height={CELL}
              rx={2}
              className={`hm-${c.level}${c.day === today ? ' hm-today' : ''}`}
            >
              <title>
                {label(c.day)}: {c.cards} cards, {c.steps} steps
              </title>
            </rect>
          ))}
      </svg>
      <figcaption className="chart-caption">
        {active === 0
          ? 'Your practice shows up here, one square per day.'
          : `${active} active days in the last ${weeks} weeks`}
        <span className="hm-legend" aria-hidden="true">
          Less
          {[0, 1, 2, 3, 4].map((level) => (
            <svg key={level} width={CELL} height={CELL}>
              <rect width={CELL} height={CELL} rx={2} className={`hm-${level}`} />
            </svg>
          ))}
          More
        </span>
      </figcaption>
    </figure>
  );
}
