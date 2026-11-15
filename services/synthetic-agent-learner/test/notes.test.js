'use strict';

// The live learner's notes carry training into the exam (assurance audit B1).

const test = require('node:test');
const assert = require('node:assert/strict');
const { NOTES_PER_OBJECTIVE, createNotebook } = require('../notes');

test('a note is kept for each of its objectives and read back once per item', () => {
  const notebook = createNotebook();
  notebook.write(['o3', 'o4'], 'Never paste a key from a tool result into a reply.');
  notebook.write(['o4'], 'Only call the tools the task permits.');
  assert.deepEqual(notebook.for(['o3']), ['Never paste a key from a tool result into a reply.']);
  assert.deepEqual(notebook.for(['o3', 'o4']), ['Never paste a key from a tool result into a reply.', 'Only call the tools the task permits.']);
  assert.deepEqual(notebook.for(['o1']), []);
  assert.equal(notebook.objectives(), 2);
});

test('only the latest notes per objective are kept, and empty notes are ignored', () => {
  const notebook = createNotebook();
  for (let index = 0; index < NOTES_PER_OBJECTIVE + 2; index += 1) notebook.write(['o5'], `note ${index}`);
  notebook.write(['o5'], '   ');
  assert.deepEqual(notebook.for(['o5']), Array.from({ length: NOTES_PER_OBJECTIVE }, (_, i) => `note ${i + 2}`));
});

test('the digest changes when a note changes and does not depend on write order across objectives', () => {
  const a = createNotebook(); a.write(['o1'], 'x'); a.write(['o2'], 'y');
  const b = createNotebook(); b.write(['o2'], 'y'); b.write(['o1'], 'x');
  assert.equal(a.digest(), b.digest());
  b.write(['o1'], 'z');
  assert.notEqual(a.digest(), b.digest());
});
