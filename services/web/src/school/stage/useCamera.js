import { useEffect, useRef } from 'react';
import { tween } from '../campus.mjs';
import { driftPointer, useFrames, usePointer } from '../motion/motion.js';

// How far the pointer moves each depth, in screen pixels at the edge of the
// window. A nearer layer moves more. Measured by eye against the room plates:
// above about 30 px the front furniture separates from its floor shadow.
export const DEPTH = { backdrop: 8, world: 16, props: 46 };
// The stage scrolls this much slower than the page, so it reads as further away.
const SCROLL_LAG = 0.16;
// On arrival the camera starts this much further away and pushes in.
const ARRIVAL = { pull: 0.86, ms: 1500 };

/**
 * Drives the world's transform from one frame loop: the camera move to a new
 * view, the pointer parallax and the scroll parallax. Nothing here causes a
 * React render; the loop writes the transform and three CSS variables.
 *
 * --px, --py: the eased pointer, -1 to 1 (on the scope element, so layers outside the stage can use them).
 * --inv: 1 / the camera's scale (on the world), for labels that must not scale.
 *
 * @param {{ scope: { current: HTMLElement|null }, world: { current: HTMLElement|null },
 *   target: { x: number, y: number, scale: number }, size: { w: number, h: number },
 *   move: { ms: number, lift: number }, reduced: boolean }} options
 */
export function useCamera({ scope, world, target, size, move, reduced }) {
  const pointer = usePointer();
  const cam = useRef(null);
  const flight = useRef(null);
  const sized = useRef(size);

  useEffect(() => {
    if (!size.w || !size.h) return;
    // A resize and reduced motion go straight to the view.
    const resized = sized.current.w !== size.w || sized.current.h !== size.h;
    sized.current = size;
    if (!cam.current && !reduced) {
      const scale = target.scale * ARRIVAL.pull;
      cam.current = { scale, x: size.w / 2 - ((size.w / 2 - target.x) / target.scale) * scale, y: size.h / 2 - ((size.h / 2 - target.y) / target.scale) * scale };
      flight.current = { from: cam.current, to: target, start: performance.now(), ms: ARRIVAL.ms, lift: 0 };
      return;
    }
    // A resize in the middle of a move (a scrollbar appears) keeps the move and changes where it ends.
    if (resized && flight.current && !reduced) {
      flight.current = { ...flight.current, to: target };
      return;
    }
    if (!cam.current || resized || reduced || move.ms === 0) {
      cam.current = target;
      flight.current = null;
      return;
    }
    flight.current = { from: cam.current, to: target, start: performance.now(), ms: move.ms, lift: move.lift };
  }, [target.x, target.y, target.scale, size.w, size.h, reduced]);

  useFrames((now) => {
    const node = world.current;
    if (!node || !cam.current) return;
    const fly = flight.current;
    if (fly) {
      const t = Math.min(1, (now - fly.start) / fly.ms);
      cam.current = tween(fly.from, fly.to, t, size, fly.lift);
      if (t >= 1) flight.current = null;
    }
    const p = reduced ? { x: 0, y: 0 } : driftPointer(pointer);
    const lag = reduced ? 0 : Math.min(window.scrollY, size.h) * SCROLL_LAG;
    const { x, y, scale } = cam.current;
    node.style.transform = `translate3d(${(x - p.x * DEPTH.world).toFixed(2)}px, ${(y - p.y * DEPTH.world * 0.5 + lag).toFixed(2)}px, 0) scale(${scale.toFixed(5)})`;
    node.style.setProperty('--inv', (1 / scale).toFixed(4));
    scope.current?.style.setProperty('--px', p.x.toFixed(4));
    scope.current?.style.setProperty('--py', p.y.toFixed(4));
  });
}
