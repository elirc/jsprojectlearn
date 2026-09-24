import type { ReactNode } from 'react';

/** One number with its caption, as used in every .stat-row. */
export default function Stat({ value, label }: { value: ReactNode; label: ReactNode }) {
  return (
    <div className="stat">
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}
