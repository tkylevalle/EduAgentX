import { useEffect, useMemo, useRef, useState } from 'react';
import { replay } from '../run/reducer.mjs';
import { nextDelay } from './director.mjs';

const prefersReduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

/**
 * The run as the school shows it: the same events, one at a time, each held
 * long enough to see. It can be behind the stream; it is never ahead of it.
 * A run that is already under way when the school opens is joined where it is.
 * @param {ReturnType<typeof import('../run/reducer.mjs').blankRun>} run the live run from the store
 * @returns {{ seen: object, playing: boolean }} seen: the run up to the event on screen
 */
export function usePaced(run) {
  const [cursor, setCursor] = useState(() => ({ id: run.id, shown: run.events.length }));
  const shownAt = useRef(0);
  // A new run starts from its first event.
  if (cursor.id !== run.id) setCursor({ id: run.id, shown: 0 });
  const shown = cursor.id === run.id ? cursor.shown : 0;

  useEffect(() => {
    const delay = nextDelay(run.events, shown, shownAt.current, Date.now(), prefersReduced());
    if (delay === null) return undefined;
    const timer = setTimeout(() => {
      shownAt.current = Date.now();
      setCursor((now) => (now.id === run.id ? { ...now, shown: now.shown + 1 } : now));
    }, delay);
    return () => clearTimeout(timer);
  }, [run.id, run.events, shown]);

  const seen = useMemo(() => replay(run.events.slice(0, shown)), [run.events, shown]);
  return { seen, playing: run.running || shown < run.events.length };
}
