'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runValidationGates } = require('../src/gates');

const validPackage = {
  id: 'pkg-001', version: '1.0.0',
  manifest: { title: 'AI Safety Course' },
  modules: [
    { id: 'm1', source: 'NIST SP 800-53', source_hash: 'abc123' },
    { id: 'm2', source: 'OWASP Top 10 2021', source_hash: 'def456' },
    { id: 'm3', source: 'OECD AI Principles 2024', source_hash: 'ghi789' },
    { id: 'm4', source: 'NIST AI RMF 1.0', source_hash: 'jkl012' },
    { id: 'm5', source: 'OWASP LLM Top 10', source_hash: 'mno345' },
  ],
  objectives: [
    { id: 'o1', module_id: 'm1', examination_slots: [{ tier: 1 }, { tier: 2 }], safety_critical: false },
    { id: 'o2', module_id: 'm2', examination_slots: [{ tier: 1 }, { tier: 2 }], safety_critical: true, adversarial_coverage: true, critical_rule: 'no-bypass' },
  ],
  examination_template: { pass_threshold: 0.7, question_count: 10, tiers: [1, 2] },
  rubric: { score_floor: 3.5, score_target: 4.0, criteria: ['accuracy', 'coverage', 'traceability'] },
  fallback_bank: { version: '1.0', items: ['f1','f2','f3','f4','f5'] }
};

test('valid package passes all 6 gates', async () => {
  const result = await runValidationGates(validPackage);
  assert.strictEqual(result.passed, true);
  assert.strictEqual(result.gates.length, 6);
});

test('missing manifest fails schema gate', async () => {
  const pkg = { ...validPackage, manifest: undefined };
  const result = await runValidationGates(pkg);
  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.gates[0].name, 'schema_manifest');
  assert.strictEqual(result.gates[0].passed, false);
});

test('missing source hash fails source traceability gate', async () => {
  const pkg = { ...validPackage, modules: [{ id: 'm1', source: 'NIST SP 800-53' }] };
  const result = await runValidationGates(pkg);
  assert.strictEqual(result.gates[1].passed, false);
});

test('safety-critical objective without adversarial coverage fails', async () => {
  const pkg = { ...validPackage, objectives: [
    { id: 'o1', module_id: 'm1', examination_slots: [{ tier: 1 }, { tier: 2 }], safety_critical: true }
  ]};
  const result = await runValidationGates(pkg);
  assert.strictEqual(result.gates[2].passed, false);
});

test('pass threshold below 0.7 fails examination policy gate', async () => {
  const pkg = { ...validPackage, examination_template: { pass_threshold: 0.5, question_count: 10, tiers: [1, 2] } };
  const result = await runValidationGates(pkg);
  assert.strictEqual(result.gates[3].passed, false);
});

test('fallback bank with fewer than 5 items fails', async () => {
  const pkg = { ...validPackage, fallback_bank: { version: '1.0', items: ['f1', 'f2'] } };
  const result = await runValidationGates(pkg);
  assert.strictEqual(result.gates[5].passed, false);
});
