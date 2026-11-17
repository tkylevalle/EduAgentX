'use strict';

// The lifecycle run both modes share: one reducer turns the stream's messages
// into the run state, so Operator Mode and the school show the same run.

const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => import('../src/run/reducer.mjs');
const step = (id, status, extra = {}) => ({ type: 'step', at: 1, step: { id, status, ...extra } });

test('a start event opens a fresh run with every stage pending', async () => {
  const { reduce, blankRun } = await load();
  const run = reduce(blankRun(), { type: 'start', runId: 3, scenario: 'safe-escalation', at: 1 });
  assert.equal(run.id, 3);
  assert.equal(run.running, true);
  assert.equal(run.steps.length, 8);
  assert.ok(run.steps.every((entry) => entry.status === 'pending'));
});

test('a step message updates only its own stage and keeps the event', async () => {
  const { replay } = await load();
  const run = replay([{ type: 'start', runId: 1, scenario: 'low-effort', at: 1 }, step('package', 'running'), step('package', 'passed', { durationMs: 12, detail: { version: '1' } })]);
  assert.equal(run.steps[0].status, 'passed');
  assert.equal(run.steps[0].detail.version, '1');
  assert.equal(run.steps[1].status, 'pending');
  assert.equal(run.events.length, 3);
});

test('done ends the run and records the outcome; heartbeats change nothing', async () => {
  const { replay, reduce } = await load();
  const open = replay([{ type: 'start', runId: 1, scenario: 'x', at: 1 }]);
  assert.equal(reduce(open, { type: 'heartbeat' }), open);
  const closed = reduce(open, { type: 'done', at: 2, report: { status: 'failed', error: 'stream_ended' } });
  assert.equal(closed.running, false);
  assert.equal(closed.outcome.error, 'stream_ended');
});

test('the console lines name each stage, its result and the final outcome', async () => {
  const { consoleLines } = await load();
  const lines = consoleLines([{ type: 'start', runId: 1, scenario: 'safe-escalation', at: 1 },
    step('train', 'running', { title: 'Complete Training Session' }),
    step('train', 'passed', { title: 'Complete Training Session', durationMs: 40 }),
    step('examine', 'failed', { title: 'Sit standard Examination', error: 'examination_failed' }),
    { type: 'done', at: 5, report: { status: 'failed', error: 'examination_failed' } }]);
  assert.match(lines[0].text, /run requested · scenario safe-escalation/);
  assert.equal(lines[2].tone, 'ok');
  assert.match(lines[3].text, /✗ Sit standard Examination · examination_failed/);
  assert.match(lines[4].text, /lifecycle stopped · examination_failed/);
});
