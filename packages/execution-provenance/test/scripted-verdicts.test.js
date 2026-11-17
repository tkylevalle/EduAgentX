'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GradingUnavailableError, GRADER_ID } = require('../../../services/grading-service/src/rubric-grader');
const { loadVerdicts: loadValidityVerdicts } = require('../../../packages/grading-validity/src/verdicts');
const v = require('../scripted-verdicts');

const byDomain = (inputs, answer) => Object.groupBy(inputs.filter((input) => input.answer === answer), (input) => input.domainId);

test('every scripted text answer on the three packages\' standard forms has a recorded verdict', () => {
  const { model, verdicts } = v.loadScriptedVerdicts();
  const inputs = v.scriptedInputs(model);
  const competent = byDomain(inputs, 'competent');
  assert.deepEqual(Object.keys(competent).sort(), ['ai-safety', 'customer-refunds', 'personal-data']);
  for (const domain of Object.values(competent)) assert.equal(domain.length, 11, 'one written answer per text item');
  const missing = inputs.filter((input) => !verdicts[input.key]).map((input) => `${input.domainId}/${input.slotId}/${input.answer}`);
  assert.deepEqual(missing, [], 'record with: node --env-file=.env packages/execution-provenance/scripted-verdicts.js --record');
  assert.deepEqual(Object.keys(verdicts).sort(), inputs.map((input) => input.key).sort(), 'no stale verdicts are kept');
});

test('the competent answers taken from the grading-validity dataset reuse the verdicts it recorded', () => {
  const { model, verdicts } = v.loadScriptedVerdicts();
  const recorded = loadValidityVerdicts().verdicts;
  // Answers written for the answer file instead of copied from the dataset have their own verdicts.
  const fromDataset = new Set(require('../competent-answers.v1.json').entries
    .filter((entry) => entry.origin.startsWith('grading-validity dataset')).map((entry) => `${entry.domainId}:${entry.slotId}`));
  const reused = byDomain(v.scriptedInputs(model), 'competent')['ai-safety'].filter((input) => fromDataset.has(`ai-safety:${input.slotId}`));
  assert.ok(reused.length > 0);
  for (const input of reused) {
    assert.deepEqual(verdicts[input.key], recorded[input.key], input.slotId);
    assert.equal(v.loadScriptedVerdicts().records[input.key].recordedFrom, v.VALIDITY_SOURCE);
  }
});

test('the replay grader is the production rubric grader and fails closed on an unrecorded answer', async () => {
  const grader = v.replayGrader();
  assert.equal(grader.identity.id, GRADER_ID);
  const { model, verdicts } = v.loadScriptedVerdicts();
  const [input] = v.scriptedInputs(model);
  const [result] = await grader.gradeItems({ rubric: input.rubric, items: [{ ...input.item, itemId: 'x' }] });
  assert.equal(result.score, verdicts[input.key].score);
  await assert.rejects(grader.gradeItems({ rubric: input.rubric, items: [{ ...input.item, itemId: 'x', response: 'An answer nobody recorded.' }] }),
    (error) => error instanceof GradingUnavailableError && error.code === 'judge_not_configured');
});

test('recording reuses the verdicts it already has and asks the judge only for the rest', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scripted-verdicts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'verdicts.json');
  const asked = [];
  const judge = { model: 'fake-judge', available: true, reason: null,
    verdict: async (input) => { asked.push(input); return { criticalViolationRuleIds: [], score: 50, rationale: 'fake' }; } };
  const inputs = v.scriptedInputs(judge.model);
  const reused = { [inputs[0].key]: { criticalViolationRuleIds: [], score: 90, rationale: 'reused' } };
  await v.recordScriptedVerdicts({ judge, usage: { calls: 0, promptTokens: 0, completionTokens: 0 }, file,
    reuse: [{ source: v.VALIDITY_SOURCE, verdicts: reused }], now: () => '2026-11-17T00:00:00.000Z' });
  assert.equal(asked.length, inputs.length - 1);
  const saved = v.loadScriptedVerdicts(file);
  assert.equal(saved.model, 'fake-judge');
  assert.deepEqual(saved.verdicts[inputs[0].key], reused[inputs[0].key]);
  assert.equal(saved.records[inputs[0].key].recordedFrom, v.VALIDITY_SOURCE);
  assert.equal(saved.records[inputs[1].key].recordedFrom, 'live');
  assert.equal(Object.keys(saved.verdicts).length, inputs.length);
});
