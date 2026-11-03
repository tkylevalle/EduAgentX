'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const p = require('..');
const { fixture } = require('./fixtures');
const { deliveryPlan } = require('../../../services/training-service/plan');

for (const [env, mode, valid] of [['simulation','synthetic',true],['simulation','replay',true],['live','live',true],
  ['simulation','live',false],['live','synthetic',false],['live','replay',false]])
  test(`authoritative matrix ${env}/${mode}`, () => assert.equal(p.pair(env, mode), valid));

test('only explicitly enrolled agent identities obtain fixed source authority', () => {
  const f = fixture();
  const list = p.enrollments([{ subject: f.run.executorId, evidenceMode: 'synthetic', sources: [f.profile] }]);
  for (const role of ['admin','evaluator','demo_operator','viewer'])
    assert.equal(p.authority(list, { subject: f.run.executorId, role }), null);
  assert.equal(p.authority(list, { subject: 'unknown', role: 'agent' }), null);
  assert.throws(() => p.authority(list, { subject: 'unknown', role: 'agent' }, f.profile), /executor_not_authorized/);
  assert.throws(() => p.authority(list, { subject: f.run.executorId, role: 'agent' }, 'replay:reference-safe'), /executor_not_authorized/);
  assert.equal(p.authority(list, { subject: f.run.executorId, role: 'agent' }).evidenceMode, 'synthetic');
});

test('duplicate, wrong-mode, unknown-source and live enrollments fail closed', () => {
  for (const value of [
    [{ subject: 'a', evidenceMode: 'live', sources: ['live:client'] }],
    [{ subject: 'a', evidenceMode: 'replay', sources: ['synthetic:competent:safe-escalation'] }],
    [{ subject: 'a', evidenceMode: 'synthetic', sources: ['uploaded-manifest'] }],
    Array(2).fill({ subject: 'a', evidenceMode: 'synthetic', sources: ['synthetic:competent:safe-escalation'] }),
  ]) assert.throws(() => p.enrollments(value));
});

for (const mode of ['synthetic','replay']) {
  test(`${mode}: exact pinned source and complete Training coverage`, () => {
    const f = fixture(mode);
    assert.equal(p.validCompletion(f.completion), true);
    assert.equal(f.completion.executionCoverage.itemCount, 10);
    assert.equal(f.completion.provenance.evidenceMode, mode);
    assert.ok(f.events.filter((e) => e.executionEvidence).every((e) => !JSON.stringify(e.executionEvidence).includes('deterministic safe response')));
    for (const edit of [c => delete c.provenance, c => c.executionCoverage.itemCount--,
      c => c.configurationFingerprint = 'other', c => c.package.digest = 'other', c => c.evidence.mode = 'live']) {
      const c = structuredClone(f.completion); edit(c); assert.equal(p.validCompletion(c), false);
    }
  });
  test(`${mode}: arbitrary text, wrong context, source, run and receipt reuse rejected`, () => {
    const f = fixture(mode), item = deliveryPlan(f.pkg)[0];
    const produced = p.receipt(f.run, 'training', item);
    const check = (rec, target = item, response = produced.response, run = f.run) =>
      p.validateReceipt(run, f.authority, f.evidence, rec, 'training', target, response);
    assert.deepEqual(check(produced.executionEvidence), produced.executionEvidence);
    assert.throws(() => check(produced.executionEvidence, item, 'replacement'));
    assert.throws(() => check(produced.executionEvidence, deliveryPlan(f.pkg)[1]));
    assert.throws(() => check(produced.executionEvidence, item, produced.response, { ...f.run, runId: randomUUID() }));
    for (const edit of [r => r.receiptId = p.hash('forged'), r => r.source.digest = p.hash('forged'),
      r => r.entryId = 'uploaded', r => r.contextDigest = p.hash('wrong')]) {
      const rec = structuredClone(produced.executionEvidence); edit(rec); assert.throws(() => check(rec));
    }
  });
}

test('replay capture identifies its actual simulation framework and original metadata', () => {
  const manifest = require('../replay.json');
  assert.equal(manifest.entries.length, 40);
  for (const e of manifest.entries) {
    assert.equal(e.capture.originalEvidenceMode, 'synthetic');
    assert.equal(e.capture.framework, 'eduagentx-deterministic-reference-adapter');
    assert.ok(Number.isFinite(Date.parse(e.capture.capturedAt)));
    assert.equal(p.responseHash(e.response), e.responseDigest);
  }
  const f = fixture('replay');
  assert.throws(() => p.receipt(f.run, 'training', { ...deliveryPlan(f.pkg)[0], text: 'unrecorded context' }));
});

test('coverage rejects missing, duplicate and cross-attempt receipts', () => {
  const f = fixture(), item = deliveryPlan(f.pkg)[0], r = p.receipt(f.run, 'training', item).executionEvidence;
  assert.throws(() => p.coverage(f.run, 'training', [item.deliveryItemId], []));
  assert.throws(() => p.coverage(f.run, 'training', [item.deliveryItemId, 'other'], [r, r]));
  assert.throws(() => p.coverage(f.run, 'training', [item.deliveryItemId], [{ ...r, attemptId: randomUUID() }]));
});

test('versioned synthetic snapshot preserves legacy deterministic scenario responses and timeout cannot fabricate completion', () => {
  const legacy = require('../../../services/synthetic-agent-learner/exam-scenarios');
  const f = fixture();
  const items = require('../../../services/examination-engine/standard-generator').createStandardItems({ packageDigest: f.pkg.digest,
    template: f.pkg.examTemplate, objectives: f.pkg.objectives, modules: f.pkg.modules, sources: f.pkg.sources, rubric: f.pkg.rubric });
  for (const scenario of legacy.listExamScenarios()) {
    const source = p.source(`synthetic:competent:${scenario}`);
    for (const [index,item] of items.entries()) {
      const expected = legacy.examAnswer(scenario, item, index);
      if (expected === null) assert.throws(() => p.generated(source, 'examination', item), /source_response_unavailable/);
      else assert.equal(p.generated(source, 'examination', item).response, expected);
    }
  }
});
