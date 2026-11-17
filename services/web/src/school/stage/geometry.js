import manifest from '../art/manifest.json';
import { campusRect, cellRect, roofRects, ROOMS } from '../campus.mjs';

// The measurements of the rendered art, in world pixels. One world pixel is
// one pixel of the 1920 x 1080 reference frame the rooms were rendered for.

const ORIGIN = manifest.rooms.box;
const [REF_W, REF_H] = manifest.plate;
const WIDE = manifest.rooms.wide;

/** The size of one room box. */
export const BOX = { w: ORIGIN.w, h: ORIGIN.h };
export const WORLD = { w: 5 * BOX.w, h: 2 * BOX.h };
export const CAMPUS = campusRect(BOX, manifest.roof, manifest.wing);
export const ROOFS = roofRects(BOX, manifest.roof, manifest.wing);
export const CELLS = Object.fromEntries(ROOMS.map((room) => [room.id, cellRect(room, BOX)]));

/** The full room plate, measured from the top left of its box. The plate is wider than the box. */
export const PLATE = {
  left: -(REF_W * (WIDE - 1)) / 2 - ORIGIN.x, top: -(REF_H * (WIDE - 1)) / 2 - ORIGIN.y, width: REF_W * WIDE, height: REF_H * WIDE,
};

/** The robot's sprite frame, measured from the top left of a room box. */
export const QUILL = {
  size: manifest.quill.platePx,
  left: manifest.quill.center[0] - ORIGIN.x - manifest.quill.platePx / 2,
  top: manifest.quill.center[1] - ORIGIN.y - manifest.quill.platePx / 2,
  cols: manifest.quill.cols,
  poses: manifest.quill.poses,
};

/** A surface of a room (a board, a clock face, a lamp) as a CSS box inside the room, or null. */
export function anchor(room, key) {
  const spot = manifest.rooms.anchors[room]?.[key];
  if (!spot) return null;
  return { left: spot.x - spot.w / 2 - ORIGIN.x, top: spot.y - spot.h / 2 - ORIGIN.y, width: spot.w, height: spot.h };
}

/** The tower clock's face as a CSS box inside the main roof image. */
export const ROOF_CLOCK = (() => {
  const { clock } = manifest.roof;
  const { main } = ROOFS;
  return { left: (clock.x - clock.w / 2) * main.w, top: (clock.y - clock.h / 2) * main.h, width: clock.w * main.w, height: clock.h * main.h };
})();

export const art = (path) => `/school/${path}`;
