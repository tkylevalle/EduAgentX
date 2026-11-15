'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGate } = require('../src/gate');

test('a check passes only when its body completes without throwing', async () => {
  const gate = createGate('demo');
  await gate.check('ok', 'Completes', async () => ({ seen: 1 }));
  await gate.check('broken', 'Throws', async () => { assert.equal(1, 2); });
  const result = gate.result();
  assert.deepEqual(result.checks.map((check) => check.status), ['PASS', 'FAIL']);
  assert.equal(result.status, 'FAIL');
  assert.equal(result.exitCode, 1);
  assert.match(result.checks[1].error, /Expected values to be strictly equal/);
});

test('a check that was not run makes the gate INCOMPLETE, never PASS', async () => {
  const gate = createGate('demo');
  await gate.check('ok', 'Completes', async () => ({}));
  gate.notRun('faults', 'Needs a grading outage', 'grading-service fault injection is not automated');
  const result = gate.result();
  assert.equal(result.status, 'INCOMPLETE');
  assert.equal(result.exitCode, 2);
});

test('a gate with no checks does not pass', () => {
  assert.equal(createGate('empty').result().status, 'INCOMPLETE');
});

test('a gate passes only when every check passed', async () => {
  const gate = createGate('demo');
  await gate.check('a', 'A', async () => ({}));
  await gate.check('b', 'B', async () => ({}));
  const result = gate.result();
  assert.equal(result.status, 'PASS');
  assert.equal(result.exitCode, 0);
});

test('a check that depends on a failed check is recorded as not run, with the reason', async () => {
  const gate = createGate('demo');
  await gate.check('first', 'First', async () => { throw new Error('boom'); });
  await gate.check('second', 'Second', async () => ({}), { needs: ['first'] });
  const second = gate.result().checks[1];
  assert.equal(second.status, 'NOT_RUN');
  assert.match(second.reason, /first/);
});
