/**
 * The thin bar used everywhere, with progressbar semantics so a screen reader
 * hears "Values, variables: 40%" instead of nothing. The width is the one
 * inline style the design system allows: it is data, not decoration.
 */
export default function ProgressBar({
  percent,
  label,
  good = false,
  className = '',
}: {
  percent: number;
  label: string;
  good?: boolean;
  className?: string;
}) {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <span
      className={`bar${className ? ` ${className}` : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
    >
      <i style={{ width: `${value}%` }} className={good ? 'good' : undefined} />
    </span>
  );
}
