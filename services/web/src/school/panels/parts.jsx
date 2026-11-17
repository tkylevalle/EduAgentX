import { TriangleAlert } from 'lucide-react';
import { CountUp } from '../../ui.jsx';
import { art } from '../stage/geometry.js';

// The school's shared surfaces. A room's records lie on the table as paper:
// a sheet, a manila file card, or a slate for what is happening right now.

/** What holds a paper down, and the cut-out that draws it. */
const FASTENERS = { clip: 'paperclip', pin: 'pin', tape: 'tape', tack: 'tack', binder: 'clip' };

/**
 * One paper on the table. `span` is its width out of 12 columns.
 * @param {{ span?: number, title?: import('react').ReactNode, aside?: import('react').ReactNode, tone?: 'ok'|'bad'|'live',
 *   kind?: 'sheet'|'manila'|'slate', fix?: keyof typeof FASTENERS, className?: string, children?: import('react').ReactNode }} props
 */
export function Card({ span = 12, title, aside, tone, kind = 'sheet', fix, className = '', children }) {
  return (
    <section className={`sheet ${className}`} data-span={span} data-tone={tone || undefined} data-kind={tone === 'live' ? 'slate' : kind}>
      {fix && <img className="fix" data-fix={fix} src={art(`ui/${FASTENERS[fix]}.webp`)} alt="" />}
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
      <TriangleAlert size={16} /> {what} did not load{error ? `: ${String(error).replaceAll('_', ' ')}` : ''}
    </p>
  );
}

/** A record is on its way: ruled lines where the writing will be. */
export function Wait({ rows = 3 }) {
  return (
    <div className="s-wait" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, index) => <i key={index} style={{ width: `${92 - index * 14}%`, '--i': index }} />)}
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

/** An examiner's ring in red pen, drawn around what it wraps. */
export function Ring({ children, tone = 'pen' }) {
  return (
    <span className="ring" data-tone={tone}>
      {children}
      <svg viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true">
        <path d="M22 54 C 14 22, 70 6, 118 8 C 168 10, 194 30, 188 56 C 182 84, 120 96, 76 92 C 36 88, 10 74, 16 46 C 20 30, 40 16, 64 12" />
      </svg>
    </span>
  );
}
