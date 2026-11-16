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

test('a page with no room opens the school gate, and switching back returns to that page', async () => {
  const { switchMode } = await load();
  const there = switchMode({ mode: 'operator', part: 'system' }, null);
  assert.equal(there.hash, '#/school/gate');
  assert.equal(switchMode({ mode: 'school', part: 'gate' }, there.last).hash, '#/system');
});

test('after a move inside a mode, the switch follows the new position', async () => {
  const { switchMode } = await load();
  const there = switchMode({ mode: 'operator', part: 'system' }, null);
  assert.equal(switchMode({ mode: 'school', part: 'office' }, there.last).hash, '#/credentials');
});

test('an unknown room or an empty part is treated as the first one', async () => {
  const { switchMode } = await load();
  assert.equal(switchMode({ mode: 'school', part: 'nowhere' }, null).hash, '#/lab');
  assert.equal(switchMode({ mode: 'operator', part: '' }, null).hash, '#/school/gate');
});
