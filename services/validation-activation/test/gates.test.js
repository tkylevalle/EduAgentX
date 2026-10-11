'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runValidationGates } = require('../src/gates');
const candidate = require('../../curriculum-engine/examples/ai-safety-candidate');

const copy = () => structuredClone(candidate);
const gate = (pkg, name) => runValidationGates(pkg).gates.find(item => item.name === name);

test('canonical five-module Candidate passes all six independent gates', () => {
  const result = runValidationGates(copy());
  assert.equal(result.passed, true, JSON.stringify(result.gates));
  assert.equal(result.gates.length, 6);
});

test('missing manifest fails schema gate', () => {
  const pkg = copy(); delete pkg.manifest;
  assert.equal(gate(pkg, 'schema_manifest').passed, false);
});

test('claim without a source pinpoint fails traceability', () => {
  const pkg = copy(); pkg.modules[0].claims[0].pinpoint = '';
  assert.equal(gate(pkg, 'source_traceability').passed, false);
});

test('safety-critical objective without adversarial slot fails coverage', () => {
  const pkg = copy(); pkg.objectives[3].examSlotIds = ['r4', 'a4'];
  assert.equal(gate(pkg, 'objective_coverage').passed, false);
});

test('incorrect pass threshold fails examination policy', () => {
  const pkg = copy(); pkg.examTemplate.overallPassPercent = 70;
  assert.equal(gate(pkg, 'examination_policy').passed, false);
});

test('missing rubric criteria fails rubric gate', () => {
  const pkg = copy(); pkg.rubric.criteria = [];
  assert.equal(gate(pkg, 'rubric_policy').passed, false);
});

test('missing fallback item fails readiness', () => {
  const pkg = copy(); pkg.fallbackBank.items.pop();
  assert.equal(gate(pkg, 'fallback_readiness').passed, false);
});
