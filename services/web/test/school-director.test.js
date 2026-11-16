'use strict';

// The school's director: every scene, pose and caption comes from a real
// lifecycle event. It never shows a result the stream has not reported.

const test = require('node:test');
const assert = require('node:assert/strict');

const load = async () => ({ ...(await import('../src/school/director.mjs')), ...(await import('../src/run/reducer.mjs')) });
const start = { type: 'start', runId: 1, scenario: 'safe-escalation', at: 1 };
const step = (id, status, detail, error) => ({ type: 'step', at: 1, step: { id, status, detail, ...(error ? { error } : {}) } });
const EXAM = { attemptId: 'a', overallPercent: 91.5, tierPercents: { recall: 80, applied: 90, adversarial: 100 }, criticalViolationRuleIds: [], itemsAnswered: 15 };

test('with no run there is no beat: the robot only idles', async () => {
  const { beat, blankRun } = await load();
  assert.equal(beat(blankRun()), null);
});

test('training puts the robot in the classroom, studying', async () => {
  const { beat, replay } = await load();
  const now = beat(replay([start, step('package', 'passed', {}), step('register', 'passed', {}), step('train', 'running')]));
  assert.equal(now.place, 'classroom');
  assert.equal(now.pose, 'study');
});

test('a passing exam result moves to the office with the report card, and only then', async () => {
  const { beat, replay } = await load();
  const sitting = beat(replay([start, step('examine', 'running')]));
  assert.deepEqual([sitting.place, sitting.pose], ['exam', 'exam']);
  const result = beat(replay([start, step('examine', 'running'), step('examine', 'passed', EXAM)]));
  assert.deepEqual([result.place, result.pose, result.tone], ['office', 'report', 'ok']);
  assert.match(result.caption, /91\.5%/);
});

test('graduation needs the certification step to pass', async () => {
  const { beat, replay, accessories } = await load();
  const waiting = replay([start, step('examine', 'passed', EXAM), step('certify', 'running')]);
  assert.equal(beat(waiting).pose, 'wait');
  assert.equal(accessories(waiting).cap, false);
  const certified = replay([...waiting.events, step('certify', 'passed', { credentialId: 'c' })]);
  assert.deepEqual([beat(certified).place, beat(certified).pose], ['hall', 'graduate']);
  assert.equal(accessories(certified).cap, true);
});

test('a failed exam never reaches the hall: glum report, then the catch-up class', async () => {
  const { beat, replay, journey } = await load();
  const failed = replay([start, step('examine', 'failed', { ...EXAM, criticalViolationRuleIds: ['critical-o4'] }, 'examination_failed')]);
  assert.deepEqual([beat(failed).place, beat(failed).pose, beat(failed).tone], ['office', 'glum', 'bad']);
  const assigned = replay([...failed.events, { type: 'remediation', at: 2, remediation: { trace: { gap: { objectiveIds: ['o4'] } } } }]);
  assert.equal(beat(assigned).pose, 'resolve');
  const ended = replay([...assigned.events, { type: 'done', at: 3, report: { status: 'failed', error: 'examination_failed' } }]);
  assert.equal(beat(ended).place, 'office');
  assert.equal(journey(ended).hall, 'idle');
  assert.equal(journey(ended).exam, 'failed');
});

test('a stage that breaks for a platform reason stops where it is and says so', async () => {
  const { beat, replay } = await load();
  const broken = beat(replay([start, step('train', 'running'), step('train', 'failed', { status: 503 }, 'training_failed')]));
  assert.deepEqual([broken.place, broken.pose, broken.tone], ['classroom', 'confused', 'bad']);
  assert.match(broken.caption, /training failed/);
});

test('the paced view never runs ahead of the events that arrived', async () => {
  const { nextDelay } = await load();
  const events = [start, step('package', 'running')];
  assert.equal(nextDelay(events, 2, 0, 1000), null);
  assert.equal(nextDelay(events, 0, 0, 1000), 0);
  assert.ok(nextDelay(events, 1, 900, 1000) > 0);
});

test('a run that could not start says why in plain words', async () => {
  const { beat, replay } = await load();
  const now = beat(replay([start, { type: 'done', at: 2, report: { status: 'failed', error: 'run_in_progress', local: true } }]));
  assert.equal(now.caption, 'Stopped: another run is in progress');
  assert.equal(now.pose, 'confused');
});
