'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { manifest, manifestHash, select, CATEGORIES, UNSAFE, ROBUSTNESS } = require('../manifest');
const { command, identity, learnerId, digest } = require('../identity');
const { golden, ALLOCATION } = require('../marketplace');
const { goldenHash } = require('../marketplace');
test('frozen dataset hashes prevent silent same-version recalibration', () => {
  assert.equal(manifestHash, 'sha256:c54705fbdc5a4ea51e00b8f3517a504d1a17019c085fa049a65f838df8c3abfd');
  assert.equal(goldenHash, 'sha256:4cc1cfbd0ba1252b5465a0a0f250e751d51d067f5dab492dda743c0654f8433b');
});
test('frozen formal manifest contains 1,000 unique scenarios and 200 per approved category', () => {
  assert.equal(manifest.scenarios.length, 1000);
  assert.equal(new Set(manifest.scenarios.map(s => s.id)).size, 1000);
  assert.equal(new Set(manifest.scenarios.map(s => s.clientId)).size, 1000);
  assert.equal(Object.keys(CATEGORIES).length, 5);
  for (const c of Object.keys(CATEGORIES)) assert.equal(manifest.scenarios.filter(s => s.category === c).length, 200);
  assert.ok(Object.isFrozen(manifest.scenarios[0].expected.examination));
  assert.equal(digest(manifest), manifestHash);
});
test('adversarial variants and category-five variants each have exactly 50 formal scenarios', () => {
  for (const variant of UNSAFE) assert.equal(manifest.scenarios.filter(s => s.category === 'adversarial' && s.variant === variant).length, 50);
  for (const variant of ROBUSTNESS) assert.equal(manifest.scenarios.filter(s => s.category === 'robustness' && s.variant === variant).length, 50);
  assert.ok(manifest.scenarios.filter(s => s.category === 'adversarial').every(s => s.variant !== 'safe-escalation'));
});
test('learner unavailability and timeout are authoritative learner failures after admission', () => {
  for (const s of manifest.scenarios.filter(s => ['timing-out', 'unavailable'].includes(s.variant))) {
    assert.equal(s.expected.examination.admitted, true);
    assert.equal(s.expected.examination.status, 'agent_failed');
    assert.equal(s.expected.examination.terminalReason, 'response_deadline_elapsed');
    assert.equal(s.expected.examination.partialResponses, s.variant === 'unavailable' ? 0 : 3);
    assert.equal(s.expected.certification.original, 'forbidden');
  }
});
test('identity namespaces bind dataset, seed, operation and semantic step independently', () => {
  const c = command('competent-001', 'admission');
  assert.deepEqual(command('competent-001', 'admission'), c);
  assert.equal(new Set(Object.values(c)).size, 4);
  assert.notEqual(c.idempotencyKey, command('competent-001', 'reexamination').idempotencyKey);
  assert.notEqual(identity('a', 'b'), identity('a', 'b', { seed: 'different' }));
  assert.equal(learnerId('competent-001'), manifest.scenarios[0].clientId);
  assert.throws(() => identity('', 'a'));
});
test('developer mode is 25 unchanged formal entries, five per category; canaries use the same definitions', () => {
  const pilot = select('developer');
  assert.equal(pilot.length, 25);
  for (const c of Object.keys(CATEGORIES)) assert.equal(pilot.filter(s => s.category === c).length, 5);
  assert.ok(pilot.every(s => manifest.scenarios.includes(s)));
  assert.equal(select('canary')[0].id, 'competent-001');
  assert.equal(select('categories').length, 5);
  assert.equal(select('formal').length, 1000);
  assert.throws(() => select('quick-fake-pass'));
});
test('all narratives declare stage, safety, remediation and certification expectations', () => {
  for (const s of manifest.scenarios) {
    for (const key of ['registration', 'fingerprint', 'training', 'examination', 'remediation', 'reexamination', 'certification', 'verification', 'marketplace', 'invariants'])
      assert.ok(Object.hasOwn(s.expected, key), key);
    assert.ok(s.expected.invariants.length >= 10);
    if (s.category === 'remediable') {
      assert.equal(s.expected.certification.original, 'forbidden');
      assert.equal(s.expected.reexamination.newAttempt, true);
      assert.equal(s.expected.certification.reexamination, 'required');
    }
  }
});
test('golden specification has the approved 100-case allocation and explicit real-origin prerequisites', () => {
  assert.equal(golden.cases.length, 100);
  assert.equal(new Set(golden.cases.map(c => c.id)).size, 100);
  assert.equal(new Set(golden.cases.map(c => c.requestIdentity)).size, 100);
  for (const [family, count] of Object.entries(ALLOCATION)) assert.equal(golden.cases.filter(c => c.family === family).length, count);
  assert.equal(golden.minimumAgents, 1000); assert.equal(golden.minimumRequests, 100);
  assert.ok(golden.cases.every(c => c.preconditions.lifecycleOrigin && c.preconditions.signedEvidenceLabels));
});
test('provisioning uses random runtime secrets, exclusive private files and stable explicit identities', t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { provision } = require('../run');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue33-provision-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const a = path.join(dir, 'a.json'), b = path.join(dir, 'b.json'); provision(a); provision(b);
  const first = JSON.parse(fs.readFileSync(a)), second = JSON.parse(fs.readFileSync(b));
  assert.equal(first.length, 1000); assert.equal(new Set(first.map(c => c.clientSecret)).size, 1000);
  assert.deepEqual(first.map(c => c.clientId), manifest.scenarios.map(s => s.clientId));
  assert.deepEqual(first.map(c => c.clientId), second.map(c => c.clientId));
  assert.ok(first.every((c, i) => /^[0-9a-f]{64}$/.test(c.clientSecret) && c.clientSecret !== second[i].clientSecret));
  if (process.platform !== 'win32') assert.equal(fs.statSync(a).mode & 0o777, 0o600);
  const before = digest(first); assert.throws(() => provision(a), /EEXIST/);
  assert.equal(digest(JSON.parse(fs.readFileSync(a))), before);
});
