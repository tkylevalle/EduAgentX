'use strict';

// The campus: nine rooms in one building, and the camera that frames them.

const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../src/school/campus.mjs');
const BOX = { w: 1000, h: 600 };

test('the ground floor is the lifecycle, left to right, and four rooms sit above it', async () => {
  const { ROOMS } = await load();
  const ground = ROOMS.filter((room) => room.floor === 0).sort((a, b) => a.col - b.col).map((room) => room.id);
  const upper = ROOMS.filter((room) => room.floor === 1).sort((a, b) => a.col - b.col).map((room) => room.id);
  assert.deepEqual(ground, ['gate', 'classroom', 'exam', 'office', 'hall']);
  assert.deepEqual(upper, ['library', 'staff', 'workshop', 'careers']);
});

test('a room has its place in the building; the upper floor starts half a room in', async () => {
  const { cellRect, roomOf } = await load();
  assert.deepEqual(cellRect(roomOf('gate'), BOX), { x: 0, y: 600, w: 1000, h: 600 });
  assert.deepEqual(cellRect(roomOf('hall'), BOX), { x: 4000, y: 600, w: 1000, h: 600 });
  assert.deepEqual(cellRect(roomOf('library'), BOX), { x: 500, y: 0, w: 1000, h: 600 });
});

test('the campus rectangle holds every room and both roofs', async () => {
  const { campusRect } = await load();
  const roof = { w: 3000, h: 600, boxes: 0.8, eaves: 0.9 };
  const wing = { w: 1000, h: 400, half: 0.5, eaves: 0.75 };
  const all = campusRect(BOX, roof, wing);
  // The main roof is 4 rooms / 0.8 = 5000 wide and 1000 tall; its eaves are on the top of the upper floor.
  assert.equal(all.y, -900);
  assert.equal(all.y + all.h, 1200);
  assert.ok(all.x <= 0 && all.x + all.w >= 5000);
});

test('the camera centres a rectangle inside the padding and never crops it', async () => {
  const { frame } = await load();
  const cam = frame({ x: 1000, y: 600, w: 1000, h: 600 }, { w: 1200, h: 500 }, { top: 50, right: 0, bottom: 50, left: 0 });
  assert.equal(cam.scale, 400 / 600);
  // The rectangle is 666.67 wide on screen, so it starts at (1200 - 666.67) / 2.
  assert.ok(Math.abs(cam.x + 1000 * cam.scale - (1200 - 1000 * cam.scale) / 2) < 1e-9);
  assert.equal(cam.y + 600 * cam.scale, 50);
});

test('a move is a walk next door, the stairs to another floor, or a zoom to or from the campus', async () => {
  const { moveKind } = await load();
  assert.equal(moveKind('gate', 'classroom'), 'walk');
  assert.equal(moveKind('office', 'hall'), 'walk');
  assert.equal(moveKind('exam', 'gate'), 'walk');
  assert.equal(moveKind('exam', 'library'), 'stairs');
  assert.equal(moveKind('hub', 'exam'), 'zoom');
  assert.equal(moveKind('careers', 'hub'), 'zoom');
  assert.equal(moveKind('exam', 'exam'), 'none');
});

test('the camera tween starts and ends exactly on its two frames and pulls back in between', async () => {
  const { tween } = await load();
  const from = { x: 0, y: 0, scale: 1 };
  const to = { x: -800, y: 100, scale: 1 };
  const size = { w: 1000, h: 500 };
  assert.deepEqual(tween(from, to, 0, size, 0.3), from);
  assert.deepEqual(tween(from, to, 1, size, 0.3), to);
  const mid = tween(from, to, 0.5, size, 0.3);
  assert.ok(mid.scale < 1, 'the camera is further away half way');
  // Half way, the point in the middle of the screen is half way between the two focus points.
  const focus = (cam) => (size.w / 2 - cam.x) / cam.scale;
  assert.ok(Math.abs(focus(mid) - (focus(from) + focus(to)) / 2) < 1e-9);
});

test('a sprite frame maps to its cell of the sheet', async () => {
  const { sheetCell } = await load();
  assert.deepEqual(sheetCell(0, 4, 24), { x: 0, y: 0, cols: 4, rows: 6 });
  assert.deepEqual(sheetCell(5, 4, 12), { x: 1, y: 1, cols: 4, rows: 3 });
  assert.deepEqual(sheetCell(13, 4, 12), { x: 1, y: 0, cols: 4, rows: 3 }, 'the frame number wraps');
});
