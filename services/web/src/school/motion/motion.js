import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// The school's motion kit. Every moving part uses these hooks, so reduced
// motion, a hidden tab and a resize are handled in one place.

const REDUCED = '(prefers-reduced-motion: reduce)';

/** True when the visitor asked the system for less motion. Follows a change of the setting. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia?.(REDUCED).matches === true);
  useEffect(() => {
    const query = window.matchMedia?.(REDUCED);
    if (!query) return undefined;
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * The size of an element in CSS pixels, kept current.
 * @param {{ current: HTMLElement|null }} ref
 * @returns {{ w: number, h: number }}
 */
export function useSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const read = () => setSize((now) => {
      const next = { w: node.clientWidth, h: node.clientHeight };
      return now.w === next.w && now.h === next.h ? now : next;
    });
    read();
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/**
 * Calls `onFrame(now)` on every animation frame while `active`. The browser
 * stops the frames by itself while the tab is hidden.
 * @param {(now: number) => void} onFrame
 * @param {boolean} active
 */
export function useFrames(onFrame, active = true) {
  const latest = useRef(onFrame);
  latest.current = onFrame;
  useEffect(() => {
    if (!active) return undefined;
    let id = requestAnimationFrame(function tick(now) {
      latest.current(now);
      id = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
  }, [active]);
}

/**
 * The pointer's place over the window, from -1 to 1 on each axis, eased so a
 * layer that follows it drifts and does not jump. Read `.current` in a frame.
 * @returns {{ current: { x: number, y: number, tx: number, ty: number } }}
 */
export function usePointer() {
  const pointer = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  useEffect(() => {
    const onMove = (event) => {
      if (event.pointerType === 'touch') return;
      pointer.current.tx = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.current.ty = (event.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);
  return pointer;
}

// The share of the remaining distance a drifting value covers in one frame.
const DRIFT = 0.07;
// Closer than this to the real pointer, the eased one stops, so an idle page does no work.
const SETTLED = 0.0005;

/** The eased pointer as the stage last moved it. The dust reads it; it must not read styles in a frame. */
export const pointerNow = { x: 0, y: 0 };

/** Moves the eased pointer one frame towards the real one. */
export function driftPointer(pointer) {
  const p = pointer.current;
  p.x = Math.abs(p.tx - p.x) < SETTLED ? p.tx : p.x + (p.tx - p.x) * DRIFT;
  p.y = Math.abs(p.ty - p.y) < SETTLED ? p.ty : p.y + (p.ty - p.y) * DRIFT;
  pointerNow.x = p.x;
  pointerNow.y = p.y;
  return p;
}
