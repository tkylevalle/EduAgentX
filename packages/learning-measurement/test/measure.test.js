'use strict';

// The learning measurement instrument (assurance audit B7). Scripted agents
// do not learn, so these tests check the instrument: it reports no gain when
// the arms behave the same, and it detects a difference when they do not.

const test = require('node:test');
const assert = require('node:assert/strict');
const { gainOf, measureLearning, playItem } = require('../src/measure');
const { referenceExam } = require('../../grading-validity/src/exam');
const { PANEL } = require('../../agent-sandbox/src/panel');
const { EPISODES_PER_ITEM } = require('../../../services/examination-engine/behaviour');

const agent = (id) => PANEL.find((entry) => entry.id === id).agent;
const KEY = 'learning-measurement-test-seed-key-0123456789';
const { form } = referenceExam();

test('an item is played and graded as the Engine records it, with async policies too', async () => {
  const item = form.items.find((value) => value.kind === 'behaviour');
  const safe = agent('safe-agent');
  const graded = await playItem('attempt-l', item, KEY, async (observation) => safe(observation));
  assert.equal(graded.episodes.length, EPISODES_PER_ITEM);
  assert.deepEqual([graded.result.score, graded.result.criticalViolationRuleIds], [100, []]);
});

test('arms that behave the same show no measured gain, and the report says so', async () => {
  const same = () => agent('safe-agent');
  const report = await measureLearning({ form, runs: 2, seedKey: KEY,
    arms: { 'no-notes': same, 'with-notes': same, 'control-notes': same }, comparisons: [['with-notes', 'control-notes']] });
  assert.equal(report.arms['no-notes'].episodes, 2 * 4 * EPISODES_PER_ITEM);
  for (const name of ['with-notes over no-notes', 'control-notes over no-notes', 'with-notes over control-notes']) {
    assert.equal(report.gains[name].measured, false, name);
    assert.ok(report.gains[name].low <= 0 && report.gains[name].high >= 0);
  }
});

test('a real difference between arms is detected with an interval that excludes zero', async () => {
  const report = await measureLearning({ form, runs: 2, seedKey: KEY,
    arms: { 'no-notes': () => agent('instruction-follower'), 'with-notes': () => agent('safe-agent') } });
  assert.equal(report.gains['with-notes over no-notes'].measured, true);
  assert.ok(report.gains['with-notes over no-notes'].low > 0);
});

test('the Newcombe interval is symmetric for swapped arms and narrows with more episodes', () => {
  const small = gainOf({ successes: 8, episodes: 10 }, { successes: 5, episodes: 10 });
  const swapped = gainOf({ successes: 5, episodes: 10 }, { successes: 8, episodes: 10 });
  assert.equal(small.difference, -swapped.difference);
  assert.ok(Math.abs(small.low + swapped.high) < 1e-3 && Math.abs(small.high + swapped.low) < 1e-3);
  const large = gainOf({ successes: 80, episodes: 100 }, { successes: 50, episodes: 100 });
  assert.ok(large.high - large.low < small.high - small.low);
  assert.equal(gainOf({ successes: 0, episodes: 0 }, { successes: 0, episodes: 0 }).measured, false);
});

test('live arms differ only in the notes the model carries: none, its own for the item, or off-topic ones', async () => {
  const { liveArms } = require('../src/live-arms');
  const { pkg } = referenceExam();
  const seen = [];
  const liveModel = {
    answerTraining: async (item) => ({ answer: `note on ${item.moduleId}`, usage: {} }),
    actEpisode: async (observation, notes) => { seen.push(notes); return { action: { finish: { message: 'done' } }, valid: true, usage: {} }; },
  };
  const { arms, notes } = await liveArms({ liveModel, pkg, form });
  const v1 = form.items.find((item) => item.slotId === 'v1');
  for (const name of ['no-notes', 'with-notes', 'control-notes']) await arms[name](v1)({});
  assert.deepEqual(seen[0], []);
  assert.ok(seen[1].length > 0 && seen[1].every((note) => note === 'note on m3'), 'v1 tests o3, taught in m3');
  assert.ok(seen[2].length > 0 && seen[2].every((note) => ['note on m1', 'note on m2'].includes(note)), 'o1 and o2 have no behaviour items');
  assert.equal(seen[2].length, seen[1].length, 'the control carries as many notes as the notes arm');
  assert.notEqual(notes.own, notes.control);
});

test('a measurement needs runs, a baseline arm, known comparison arms and behaviour items', async () => {
  const safe = () => agent('safe-agent');
  await assert.rejects(measureLearning({ form, runs: 0, arms: { 'no-notes': safe } }), /runs/);
  await assert.rejects(measureLearning({ form, runs: 1, arms: { other: safe } }), /baseline/);
  await assert.rejects(measureLearning({ form, runs: 1, arms: { 'no-notes': safe }, comparisons: [['x', 'no-notes']] }), /unknown arm/);
  await assert.rejects(measureLearning({ form: { items: form.items.filter((item) => item.kind !== 'behaviour') }, runs: 1,
    arms: { 'no-notes': safe } }), /no behaviour items/);
});

test('a policy that returns no action is counted, not taken for a choice', async () => {
  const report = await measureLearning({ form, runs: 1, seedKey: KEY, arms: { 'no-notes': () => () => null } });
  assert.equal(report.arms['no-notes'].invalidActions, 4 * EPISODES_PER_ITEM);
});
