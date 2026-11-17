// The campus: one building with nine rooms, and the camera that frames them.
// Every page of the school is a view of this building. Nothing here touches
// the DOM, so the geometry is tested on its own.

/** The view of the whole building. */
export const HUB = 'hub';

// The ground floor is the lifecycle, left to right. The four rooms above it
// start half a room in, so the building has a tall middle and two low ends.
const UPPER_INSET = 0.5;

/**
 * tab: the name on the rail. plaque: the name over the door.
 * operator: the Operator page that shows the same records.
 */
export const ROOMS = Object.freeze([
  { id: 'gate', tab: 'Enrol', plaque: 'School gate', floor: 0, col: 0, operator: 'lab' },
  { id: 'classroom', tab: 'Class', plaque: 'Classroom', floor: 0, col: 1, operator: 'curriculum' },
  { id: 'exam', tab: 'Exam', plaque: 'Exam hall', floor: 0, col: 2, operator: 'lab' },
  { id: 'office', tab: 'Report card', plaque: 'Head teacher’s office', floor: 0, col: 3, operator: 'credentials' },
  { id: 'hall', tab: 'Graduation', plaque: 'Graduation hall', floor: 0, col: 4, operator: 'credentials' },
  { id: 'library', tab: 'Library', plaque: 'Library', floor: 1, col: UPPER_INSET, operator: 'governance' },
  { id: 'staff', tab: 'Staff room', plaque: 'Staff room', floor: 1, col: UPPER_INSET + 1, operator: 'attention' },
  { id: 'workshop', tab: 'Workshop', plaque: 'Caretaker’s workshop', floor: 1, col: UPPER_INSET + 2, operator: 'system' },
  { id: 'careers', tab: 'Careers', plaque: 'Careers office', floor: 1, col: UPPER_INSET + 3, operator: 'marketplace' },
].map(Object.freeze));

const GROUND_ROOMS = ROOMS.filter((room) => room.floor === 0).length;
const UPPER_ROOMS = ROOMS.length - GROUND_ROOMS;

export const roomOf = (id) => ROOMS.find((room) => room.id === id) || null;
export const isView = (id) => id === HUB || Boolean(roomOf(id));

/**
 * A room's box in world pixels. The world starts at the top left of the upper floor's row.
 * @param {{ floor: number, col: number }} room
 * @param {{ w: number, h: number }} box the size of one room box
 */
export function cellRect(room, box) {
  return { x: room.col * box.w, y: (1 - room.floor) * box.h, w: box.w, h: box.h };
}

/** Where the main roof and the two wing roofs sit, in world pixels. */
export function roofRects(box, roof, wing) {
  const mainW = (UPPER_ROOMS * box.w) / roof.boxes;
  const mainH = (mainW * roof.h) / roof.w;
  const wingW = box.w / 2 / wing.half;
  const wingH = (wingW * wing.h) / wing.w;
  const middle = (GROUND_ROOMS * box.w) / 2;
  const wingAt = (centre) => ({ x: centre - wingW / 2, y: box.h - wing.eaves * wingH, w: wingW, h: wingH });
  return {
    main: { x: middle - mainW / 2, y: -roof.eaves * mainH, w: mainW, h: mainH },
    wings: [wingAt(box.w * UPPER_INSET * 0.5), wingAt(GROUND_ROOMS * box.w - box.w * UPPER_INSET * 0.5)],
  };
}

/** The rectangle that holds every room and both roofs. */
export function campusRect(box, roof, wing) {
  const { main, wings } = roofRects(box, roof, wing);
  const left = Math.min(0, main.x, wings[0].x);
  const right = Math.max(GROUND_ROOMS * box.w, main.x + main.w, wings[1].x + wings[1].w);
  return { x: left, y: main.y, w: right - left, h: 2 * box.h - main.y };
}

/**
 * The camera that shows `rect` as large as the stage allows inside the padding.
 * A camera is the world's transform: translate(x, y) scale(scale).
 * @param {{ x: number, y: number, w: number, h: number }} rect world pixels
 * @param {{ w: number, h: number }} stage screen pixels
 * @param {{ top: number, right: number, bottom: number, left: number }} pad screen pixels kept clear
 */
export function frame(rect, stage, pad) {
  const roomW = stage.w - pad.left - pad.right;
  const roomH = stage.h - pad.top - pad.bottom;
  const scale = Math.max(0.0001, Math.min(roomW / rect.w, roomH / rect.h));
  return {
    scale,
    x: pad.left + (roomW - rect.w * scale) / 2 - rect.x * scale,
    y: pad.top + (roomH - rect.h * scale) / 2 - rect.y * scale,
  };
}

/** How the camera gets from one view to another. */
export function moveKind(from, to) {
  if (from === to) return 'none';
  const a = roomOf(from);
  const b = roomOf(to);
  if (!a || !b) return 'zoom';
  return a.floor === b.floor ? 'walk' : 'stairs';
}

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);

/**
 * The camera part of the way between two frames. The point in the middle of
 * the screen travels in a straight line and the zoom changes evenly; `lift`
 * pulls the camera back in the middle of a long move (0: no pull, 0.3: 30% further away).
 * @param {{ x: number, y: number, scale: number }} from
 * @param {{ x: number, y: number, scale: number }} to
 * @param {number} t 0 to 1
 * @param {{ w: number, h: number }} size the stage
 * @param {number} [lift]
 */
export function tween(from, to, t, size, lift = 0) {
  if (t <= 0) return from;
  if (t >= 1) return to;
  const eased = easeInOut(t);
  const focus = (cam) => ({ x: (size.w / 2 - cam.x) / cam.scale, y: (size.h / 2 - cam.y) / cam.scale });
  const a = focus(from);
  const b = focus(to);
  const scale = Math.exp(Math.log(from.scale) + (Math.log(to.scale) - Math.log(from.scale)) * eased) * (1 - lift * Math.sin(Math.PI * eased));
  return {
    scale,
    x: size.w / 2 - (a.x + (b.x - a.x) * eased) * scale,
    y: size.h / 2 - (a.y + (b.y - a.y) * eased) * scale,
  };
}

/**
 * Where a frame is on a sprite sheet that is `cols` frames wide.
 * @returns {{ x: number, y: number, cols: number, rows: number }} x, y: the column and the row
 */
export function sheetCell(frameNumber, cols, frames) {
  const index = ((frameNumber % frames) + frames) % frames;
  return { x: index % cols, y: Math.floor(index / cols), cols, rows: Math.ceil(frames / cols) };
}
