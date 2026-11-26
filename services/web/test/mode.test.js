'use strict';

// The mode switch: School and Operator are two views of one system, and a
// switch lands on the page that shows the same thing.

const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../src/mode.mjs');

test('the hash names the mode; an empty hash uses the stored mode, School by default', async () => {
  const { parseHash } = await load();
  assert.deepEqual(parseHash('#/school/exam'), { mode: 'school', part: 'exam' });
  assert.deepEqual(parseHash('#/credentials'), { mode: 'operator', part: 'credentials' });
  assert.deepEqual(parseHash('', null), { mode: 'school', part: '' });
  assert.deepEqual(parseHash('', 'operator'), { mode: 'operator', part: '' });
});

test('a switch lands on the page that shows the same thing', async () => {
  const { switchMode } = await load();
  assert.equal(switchMode({ mode: 'school', part: 'classroom' }, null).hash, '#/curriculum');
  assert.equal(switchMode({ mode: 'school', part: 'hall' }, null).hash, '#/credentials');
  assert.equal(switchMode({ mode: 'operator', part: 'curriculum' }, null).hash, '#/school/classroom');
  assert.equal(switchMode({ mode: 'operator', part: 'verify' }, null).hash, '#/school/hall');
});

test('every Operator page has a room, and the overview is the campus', async () => {
  const { switchMode } = await load();
  const room = (page) => switchMode({ mode: 'operator', part: page }, null).hash;
  assert.equal(room('overview'), '#/school/hub');
  assert.equal(room('lab'), '#/school/gate');
  assert.equal(room('governance'), '#/school/library');
  assert.equal(room('attention'), '#/school/staff');
  assert.equal(room('labelling'), '#/school/staff');
  assert.equal(room('system'), '#/school/workshop');
  assert.equal(room('evidence'), '#/school/workshop');
  assert.equal(room('marketplace'), '#/school/careers');
});

test('a room that two pages share returns to the page the visitor came from', async () => {
  const { switchMode } = await load();
  const there = switchMode({ mode: 'operator', part: 'evidence' }, null);
  assert.equal(there.hash, '#/school/workshop');
  assert.equal(switchMode({ mode: 'school', part: 'workshop' }, there.last).hash, '#/evidence');
  assert.equal(switchMode({ mode: 'school', part: 'workshop' }, null).hash, '#/system');
});

test('after a move inside a mode, the switch follows the new position', async () => {
  const { switchMode } = await load();
  const there = switchMode({ mode: 'operator', part: 'system' }, null);
  assert.equal(switchMode({ mode: 'school', part: 'office' }, there.last).hash, '#/credentials');
  assert.equal(switchMode({ mode: 'school', part: 'careers' }, there.last).hash, '#/marketplace');
});

test('an unknown room or an empty part is the campus, and the campus is the overview', async () => {
  const { switchMode } = await load();
  assert.equal(switchMode({ mode: 'school', part: 'nowhere' }, null).hash, '#/overview');
  assert.equal(switchMode({ mode: 'school', part: '' }, null).hash, '#/overview');
  assert.equal(switchMode({ mode: 'operator', part: '' }, null).hash, '#/school/hub');
  assert.equal(switchMode({ mode: 'operator', part: 'no-such-page' }, null).hash, '#/school/hub');
});
