import { useEffect, useRef } from 'react';
import { pointerNow, useFrames } from '../motion/motion.js';

// The air of the stage: dust in the lamp light, and paper confetti when a
// student graduates. One canvas over the room, drawn about 30 times a second.

const MOTES = 54;
const CONFETTI = 110;
const FRAME_MS = 32;
// The lamp is up and to the left of the stage; dust is brightest in its beam.
const LAMP = { x: 0.3, y: -0.1, reach: 0.95 };
const CONFETTI_COLOURS = ['#FDAE12', '#EE8B94', '#5FA88F', '#F2E9D5', '#C8352B'];
// A confetto falls out of the frame in about four seconds; after that the list is cleared.
const CONFETTI_LIFE_MS = 5200;

const random = (min, max) => min + Math.random() * (max - min);

function newMote() {
  return { x: Math.random(), y: Math.random(), depth: random(0.25, 1), vx: random(-0.004, 0.009), vy: random(-0.006, 0.002), phase: random(0, 6.28) };
}

function newConfetto(index) {
  return {
    x: random(0.18, 0.82), y: random(-0.5, -0.02), vx: random(-0.05, 0.05), vy: random(0.16, 0.34), spin: random(-7, 7), turn: random(0, 6.28),
    w: random(5, 10), h: random(8, 15), colour: CONFETTI_COLOURS[index % CONFETTI_COLOURS.length],
  };
}

function drawMotes(ctx, motes, w, h, seconds, shift) {
  ctx.globalCompositeOperation = 'lighter';
  for (const mote of motes) {
    mote.x = (mote.x + mote.vx * seconds + 1) % 1;
    mote.y = (mote.y + mote.vy * seconds + 1) % 1;
    mote.phase += seconds * 0.9;
    const lit = Math.max(0, 1 - Math.hypot(mote.x - LAMP.x, mote.y - LAMP.y) / LAMP.reach);
    const alpha = (0.05 + 0.4 * mote.depth) * lit * (0.65 + 0.35 * Math.sin(mote.phase));
    if (alpha < 0.01) continue;
    ctx.fillStyle = `rgba(255, 226, 178, ${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(mote.x * w - shift.x * 34 * mote.depth, mote.y * h - shift.y * 14 * mote.depth, 0.5 + mote.depth * 1.7, 0, 6.2832);
    ctx.fill();
  }
}

function drawConfetti(ctx, pieces, w, h, seconds) {
  ctx.globalCompositeOperation = 'source-over';
  for (const piece of pieces) {
    piece.x += (piece.vx + Math.sin(piece.turn * 0.7) * 0.03) * seconds;
    piece.y += piece.vy * seconds;
    piece.turn += piece.spin * seconds;
    ctx.save();
    ctx.translate(piece.x * w, piece.y * h);
    ctx.rotate(piece.turn);
    // The narrowing width reads as the paper turning over.
    ctx.scale(Math.cos(piece.turn * 1.3), 1);
    ctx.fillStyle = piece.colour;
    ctx.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h);
    ctx.restore();
  }
}

/**
 * @param {{ party: boolean, reduced: boolean }} props
 * party: a student has just graduated; confetti falls once each time this turns on.
 */
export default function Dust({ party, reduced }) {
  const canvas = useRef(null);
  const motes = useRef(Array.from({ length: MOTES }, newMote));
  const confetti = useRef({ pieces: [], until: 0 });
  const last = useRef(0);

  useEffect(() => {
    if (!party || reduced) { confetti.current = { pieces: [], until: 0 }; return; }
    confetti.current = { pieces: Array.from({ length: CONFETTI }, (_, index) => newConfetto(index)), until: performance.now() + CONFETTI_LIFE_MS };
  }, [party, reduced]);

  useFrames((now) => {
    const node = canvas.current;
    if (!node || now - last.current < FRAME_MS) return;
    const seconds = Math.min(0.1, (now - (last.current || now)) / 1000);
    last.current = now;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const w = node.clientWidth;
    const h = node.clientHeight;
    if (node.width !== Math.round(w * ratio) || node.height !== Math.round(h * ratio)) { node.width = Math.round(w * ratio); node.height = Math.round(h * ratio); }
    const ctx = node.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawMotes(ctx, motes.current, w, h, seconds, pointerNow);
    if (now > confetti.current.until) confetti.current.pieces = [];
    else drawConfetti(ctx, confetti.current.pieces, w, h, seconds);
  }, !reduced);

  return <canvas ref={canvas} className="stage-air" aria-hidden="true" />;
}
