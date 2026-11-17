import { useEffect, useMemo, useRef, useState } from 'react';
import { frame, HUB, moveKind, roomOf, ROOMS } from '../campus.mjs';
import { useReducedMotion, useSize } from '../motion/motion.js';
import { art, CAMPUS, CELLS, PLATE, QUILL, ROOF_CLOCK, ROOFS, WORLD } from './geometry.js';
import { useCamera } from './useCamera.js';
import RoomOverlays, { Hands } from './overlays.jsx';
import Quill from './Quill.jsx';
import Dust from './Dust.jsx';
import './stage.css';

// The school is one building. The stage is a camera on it: the campus view
// shows all of it, a room view moves in on one room. The robot is in the
// building, between each room's back and front plates.

// Time to walk into the next room, and the extra time for each further room.
const WALK_MS = 1300;
const WALK_EXTRA_MS = 260;
// A move to another floor, and the zoom between the campus and a room.
const STAIRS_MS = 1500;
const ZOOM_MS = 1150;
// On the way to another floor the camera pulls back by this share.
const STAIRS_LIFT = 0.22;
// A run's moves are paced to be watched. When the visitor asks for a room, the same move takes this share of the time.
const VISITOR_PACE = 0.6;
// The robot is out of sight for this part of a move it cannot walk.
const HIDE_MS = 180;
const SEATED = new Set(['study', 'exam']);
// Rooms with the robot's desk in the middle. When the robot is not sitting at it,
// the desk is drawn empty and the robot stands to its left (world pixels).
const DESK_ROOMS = new Set(['classroom', 'exam']);
// Where the robot stands when it is not at the middle of a room (world pixels). In the office the middle is
// in front of the shelf, and the trophy on it looked like a hat.
const STAND_ASIDE = { classroom: -470, exam: -470, office: -330 };
// Screen pixels kept clear around the framed view: the door plaque above, the caption below.
const ROOM_PAD = { top: 46, right: 14, bottom: 30, left: 14 };
const HUB_PAD = { top: 8, right: 18, bottom: 22, left: 18 };

const walkMs = (from, to) => WALK_MS + (Math.abs(roomOf(to).col - roomOf(from).col) - 1) * WALK_EXTRA_MS;

function moveOf(from, to, pace) {
  const kind = moveKind(from, to);
  if (kind === 'walk') return { ms: walkMs(from, to) * pace, lift: 0 };
  if (kind === 'stairs') return { ms: STAIRS_MS * pace, lift: STAIRS_LIFT };
  return { ms: kind === 'zoom' ? ZOOM_MS * pace : 0, lift: 0 };
}

/**
 * Where the robot stands. It walks to a room on the same floor; to another
 * floor it goes out of sight, and comes back in the new room.
 */
function useQuillPlace(room, reduced, pace) {
  const [at, setAt] = useState({ room, from: room, facing: 1, walking: false, hidden: false, ms: 0 });
  useEffect(() => {
    if (at.room === room) return undefined;
    if (reduced) { setAt({ room, from: room, facing: 1, walking: false, hidden: false, ms: 0 }); return undefined; }
    if (moveKind(at.room, room) === 'walk') {
      const ms = walkMs(at.room, room) * pace;
      setAt({ room, from: at.room, facing: roomOf(room).col > roomOf(at.room).col ? 1 : -1, walking: true, hidden: false, ms });
      const timer = setTimeout(() => setAt((now) => ({ ...now, from: room, walking: false })), ms);
      return () => clearTimeout(timer);
    }
    setAt((now) => ({ ...now, hidden: true, ms: 0 }));
    const jump = setTimeout(() => setAt({ room, from: room, facing: 1, walking: false, hidden: true, ms: 0 }), HIDE_MS);
    const back = setTimeout(() => setAt((now) => ({ ...now, hidden: false })), STAIRS_MS * pace * 0.6);
    return () => { clearTimeout(jump); clearTimeout(back); };
  }, [room, reduced]);
  return at;
}

// The pictures a room change needs: both plates of every room, and the two sheets the robot uses between rooms.
const LATER_ART = [...ROOMS.flatMap((room) => [`rooms/${room.id}-back.webp`, `rooms/${room.id}-front.webp`]), 'quill/walk.webp', 'quill/walk-cap.webp'];

const PRELOAD_AFTER_MS = 2500;

/** Fetches the art of the other rooms once the first view is up, so a room opens without a wait. */
function usePreloadedArt() {
  useEffect(() => {
    // After the first view has had time to load and paint: this art must not compete with it.
    const timer = setTimeout(() => LATER_ART.forEach((path) => { const image = new Image(); image.decoding = 'async'; image.src = art(path); }), PRELOAD_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
}


function Roofs() {
  return (
    <>
      {ROOFS.wings.map((wing, index) => <img key={index} className="roof" alt="" src={art('rooms/wing.webp')} style={{ left: wing.x, top: wing.y, width: wing.w, height: wing.h }} />)}
      <div className="roof" style={{ left: ROOFS.main.x, top: ROOFS.main.y, width: ROOFS.main.w, height: ROOFS.main.h }}>
        <img alt="" src={art('rooms/roof.webp')} />
        <Hands box={ROOF_CLOCK} />
      </div>
    </>
  );
}

/** One room: its picture, its live boards, and the desk when the robot is not sitting at it. */
function Cell({ room, near, deskFree, children }) {
  const cell = CELLS[room.id];
  return (
    <div className="cell" data-room={room.id} style={{ left: cell.x, top: cell.y, width: cell.w, height: cell.h }}>
      <img className="cell-thumb" alt="" src={art(`rooms/${room.id}-thumb.webp`)} />
      {near && <img className="plate" alt="" src={art(`rooms/${room.id}-back.webp`)} style={PLATE} decoding="async" />}
      {children}
      {deskFree && <img className="cell-desk" alt="" src={art('quill/desk.webp')} style={{ left: QUILL.left, top: QUILL.top, width: QUILL.size, height: QUILL.size }} />}
    </div>
  );
}

/**
 * @param {{ view: string, quillRoom: string, pose: string, look: object, facts: object, data: object,
 *   health: Array<object>|null, tags: Record<string, string|null>, locked: boolean, onGo: (view: string) => void,
 *   scope: { current: HTMLElement|null }, children?: import('react').ReactNode }} props
 * view: 'hub' or a room. quillRoom: the room the robot is in. tags: one short live fact per room, for the campus view.
 * locked: a run is playing, so the camera follows it. scope: the element that receives the pointer variables.
 */
export default function Stage({ view, quillRoom, pose, look, facts, data, health, tags, locked, onGo, scope, children }) {
  const stage = useRef(null);
  const world = useRef(null);
  const size = useSize(stage);
  const reduced = useReducedMotion();
  const lastView = useRef(view);
  const pace = locked ? 1 : VISITOR_PACE;
  const move = moveOf(lastView.current, view, pace);
  useEffect(() => { lastView.current = view; }, [view]);

  const target = useMemo(() => frame(view === HUB ? CAMPUS : CELLS[view], size, view === HUB ? HUB_PAD : ROOM_PAD), [view, size]);
  useCamera({ scope, world, target, size, move, reduced });

  const quill = useQuillPlace(quillRoom, reduced, pace);
  usePreloadedArt();
  const seated = !quill.walking && SEATED.has(pose);
  const shownPose = quill.walking ? 'walk' : pose;
  const quillCell = CELLS[quill.room];
  const aside = !seated && !quill.walking ? STAND_ASIDE[quill.room] || 0 : 0;
  const near = (id) => id === view || id === quill.room || id === quill.from;
  // While the robot walks, every room on its way is lit, so it is never in the dark.
  const onTheWay = (id) => {
    const [here, from, to] = [roomOf(id), roomOf(quill.from), roomOf(quill.room)];
    return here.floor === to.floor && here.col >= Math.min(from.col, to.col) && here.col <= Math.max(from.col, to.col);
  };
  const lit = (id) => id === view || (quill.walking && onTheWay(id));
  const room = roomOf(view);

  return (
    <div ref={stage} className="scene" data-view={view === HUB ? 'hub' : 'room'} data-room={view}>
      <div className="stage-backdrop" aria-hidden="true" />
      <div ref={world} className="world" style={{ width: WORLD.w, height: WORLD.h }}>
        <Roofs />
        {ROOMS.map((entry) => (
          <Cell key={entry.id} room={entry} near={near(entry.id)} deskFree={DESK_ROOMS.has(entry.id) && !(seated && quill.room === entry.id)}>
            <RoomOverlays id={entry.id} pkg={data.pkg} facts={facts} data={data} health={health} look={look} />
          </Cell>
        ))}
        <div className="quill-at" data-hidden={quill.hidden || undefined}
          style={{ transform: `translate3d(${quillCell.x + QUILL.left + aside}px, ${quillCell.y + QUILL.top}px, 0)`, '--walk': `${quill.ms}ms`, width: QUILL.size, height: QUILL.size }}>
          <Quill pose={shownPose} cap={look.cap} flip={quill.walking && quill.facing < 0} still={reduced} />
        </div>
        <div className="fronts">
          {ROOMS.filter((entry) => near(entry.id)).map((entry) => (
            <img key={entry.id} className="plate" alt="" src={art(`rooms/${entry.id}-front.webp`)} decoding="async"
              style={{ ...PLATE, left: CELLS[entry.id].x + PLATE.left, top: CELLS[entry.id].y + PLATE.top }} />
          ))}
        </div>
        {ROOMS.map((entry) => {
          const cell = CELLS[entry.id];
          return (
            <button key={entry.id} type="button" className="cell-door" data-lit={lit(entry.id) || undefined} disabled={locked || entry.id === view} tabIndex={-1}
              style={{ left: cell.x, top: cell.y, width: cell.w, height: cell.h }} aria-label={`Go to the ${entry.plaque}`} onClick={() => onGo(entry.id)}>
              <span className="door-tag"><strong>{entry.plaque}</strong>{tags[entry.id] && <em>{tags[entry.id]}</em>}</span>
            </button>
          );
        })}
      </div>
      <div className="stage-light" aria-hidden="true" />
      <Dust party={facts.party && view === 'hall'} reduced={reduced} />
      {room ? <h1 key={room.id} className="plaque">{room.plaque}</h1> : <h1 className="sr-only">The campus</h1>}
      {children}
    </div>
  );
}
