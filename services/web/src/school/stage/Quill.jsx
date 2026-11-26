import { useEffect, useRef, useState } from 'react';
import { sheetCell } from '../campus.mjs';
import { useFrames } from '../motion/motion.js';
import { art, QUILL } from './geometry.js';

// Quill, the student: a 3D model rendered to sprite sheets, one sheet per pose.
// The frames play at 12 a second, like a stop-motion puppet.

const sheet = (pose, cap) => art(`quill/${pose}${cap ? '-cap' : ''}.webp`);
const loaded = new Set();

/** Resolves when the sheet is decoded, so a pose never shows half loaded. */
function ready(url) {
  if (loaded.has(url)) return Promise.resolve();
  const image = new Image();
  image.src = url;
  return image.decode().then(() => { loaded.add(url); });
}

/** The pose on screen: the requested one as soon as its sheet is decoded, the previous one until then. */
function useLoadedPose(pose, cap) {
  const [shown, setShown] = useState({ pose: 'idle', cap: false });
  useEffect(() => {
    let alive = true;
    const withCap = cap && QUILL.poses[pose]?.cap === true;
    const sheets = [sheet(pose, false), ...(withCap ? [sheet(pose, true)] : [])];
    Promise.all(sheets.map(ready))
      .then(() => alive && setShown({ pose, cap: withCap }))
      // A sheet that fails to load keeps the previous pose on screen.
      .catch(() => {});
    return () => { alive = false; };
  }, [pose, cap]);
  return shown;
}

function position(frameNumber, frames) {
  const cell = sheetCell(frameNumber, QUILL.cols, frames);
  return `${(cell.x / (cell.cols - 1)) * 100}% ${cell.rows > 1 ? (cell.y / (cell.rows - 1)) * 100 : 0}%`;
}

/**
 * @param {{ pose: string, cap?: boolean, flip?: boolean, still?: boolean }} props
 * cap: wears the graduation cap. flip: faces left. still: shows the first frame only.
 */
export default function Quill({ pose, cap = false, flip = false, still = false }) {
  const shown = useLoadedPose(QUILL.poses[pose] ? pose : 'idle', cap);
  const { frames, fps } = QUILL.poses[shown.pose];
  const body = useRef(null);
  const hat = useRef(null);
  const start = useRef(0);
  const last = useRef(-1);

  useEffect(() => { start.current = performance.now(); last.current = -1; }, [shown.pose]);
  useFrames((now) => {
    const frameNumber = still ? 0 : Math.floor(((now - start.current) * fps) / 1000);
    if (frameNumber === last.current) return;
    last.current = frameNumber;
    const at = position(frameNumber, frames);
    if (body.current) body.current.style.backgroundPosition = at;
    if (hat.current) hat.current.style.backgroundPosition = at;
  });

  const size = `${QUILL.cols * 100}% ${Math.ceil(frames / QUILL.cols) * 100}%`;
  return (
    <div className="quill" data-pose={shown.pose} data-flip={flip || undefined}>
      <div ref={body} className="quill-sheet" style={{ backgroundImage: `url(${sheet(shown.pose, false)})`, backgroundSize: size }} />
      {shown.cap && <div ref={hat} className="quill-sheet" style={{ backgroundImage: `url(${sheet(shown.pose, true)})`, backgroundSize: size }} />}
    </div>
  );
}
