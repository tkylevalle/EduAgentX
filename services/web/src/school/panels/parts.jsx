import { TriangleAlert } from 'lucide-react';
import { CountUp, Skeleton } from '../../ui.jsx';

/** One block of a room's panel. `span` is its width out of 12 columns. */
export function Card({ span = 12, title, aside, tone, className = '', children }) {
  return (
    <section className={`s-card ${className}`} data-span={span} data-tone={tone || undefined}>
      {(title || aside) && (
        <header className="s-card-head">
          {title && <h2 className="s-h">{title}</h2>}
          {aside}
        </header>
      )}
      {children}
    </section>
  );
}

/** A big number with its name. `value` null means the record did not load. */
export function Fact({ value, name, unit, decimals = 0 }) {
  return (
    <div className="s-fact">
      <strong className="s-fact-value">
        {value === null || value === undefined ? '—' : typeof value === 'number' ? <CountUp value={value} decimals={decimals} /> : value}
        {unit && value !== null && value !== undefined && <small>{unit}</small>}
      </strong>
      <span className="s-fact-name">{name}</span>
    </div>
  );
}

/** A call to the platform failed. Says what is missing and the platform's reason. */
export function Problem({ what, error }) {
  return (
    <p className="s-problem" role="alert">
      <TriangleAlert size={15} /> {what} did not load{error ? `: ${String(error).replaceAll('_', ' ')}` : ''}
    </p>
  );
}

export function Wait({ rows = 3 }) {
  return (
    <div className="s-wait" aria-busy="true">
      {Array.from({ length: rows }, (_, index) => <Skeleton key={index} height={18} width={`${92 - index * 14}%`} />)}
    </div>
  );
}

/** A score bar with an optional pass line. */
export function Bar({ name, percent, line, bad = false }) {
  const known = Number.isFinite(percent);
  return (
    <div className="s-bar-row" data-bad={bad || undefined}>
      <span className="s-bar-name">{name}</span>
      <span className="s-bar-track">
        <span className="s-bar-fill" style={{ width: `${known ? Math.max(1, percent) : 0}%` }} />
        {Number.isFinite(line) && <span className="s-bar-line" style={{ left: `${line}%` }} title={`Pass line ${line}%`} />}
      </span>
      <span className="s-bar-value">{known ? `${Number(percent).toFixed(percent % 1 ? 1 : 0)}%` : '—'}</span>
    </div>
  );
}
