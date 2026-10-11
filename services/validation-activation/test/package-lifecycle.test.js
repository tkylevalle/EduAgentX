'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sha256, validatePackage } = require('../../curriculum-engine/model');
const active = require('../../curriculum-engine/examples/ai-safety-candidate');
const { createRefreshCandidate, selectFallback, validateScope } = require('../src/package-lifecycle');

test('refresh candidate gets a separate identity, pins the observed source, and leaves active package unchanged', () => {
  const pkg = structuredClone(active);
  pkg.id = 'ai-safety-active';
  pkg.version = pkg.manifest.version;
  pkg.state = 'Active';
  pkg.manifest.packageId = pkg.id;
  const originalHash = pkg.sources[0].contentSha256;
  const candidate = createRefreshCandidate(pkg, {
    sourceId: 'nist-rmf', observedContentSha256: 'b'.repeat(64), observedAt: '2026-10-11T10:00:00.000Z',
    snapshotReference: 'sha256:reviewed-source-snapshot', observedEdition: 'revision 2',
  });

  assert.notEqual(candidate.id, pkg.id);
  assert.equal(candidate.state, 'Candidate');
  assert.deepEqual(candidate.manifest.predecessor, { packageId: pkg.id, version: pkg.version });
  assert.equal(candidate.sources[0].contentSha256, 'b'.repeat(64));
  assert.equal(pkg.sources[0].contentSha256, originalHash);
  assert.equal(candidate.manifest.sourcePins[0].sha256, sha256(candidate.sources[0]));
  assert.equal(candidate.manifest.fallbackBankPin.sha256, sha256(candidate.fallbackBank));
  assert.ok(validatePackage(candidate).some((error) => error.path === 'sources[0]'), 'updated source needs the official baseline and human review before activation');
});

test('quarantine scope must resolve to a single exact package artifact', () => {
  assert.equal(validateScope(active, { type: 'delivery_item', id: 'm1-lesson-1' }), null);
  assert.equal(validateScope(active, { type: 'module', id: 'missing-module' }), 'module:missing-module is not present in this package');
  assert.match(validateScope(active, { type: 'package', id: active.manifest.packageId }), /exact source, module, objective/);
});

test('fallback selection requires an Active, prevalidated, source-linked pinned bank and fails closed on quarantine', () => {
  const pkg = structuredClone(active);
  pkg.state = 'Active';
  const validationEvidence = [{ event: 'validation_run', result: { passed: true, gates: [{ name: 'fallback_readiness', passed: true }] } }];
  assert.equal(selectFallback(pkg, { validationEvidence, reason: 'standard_generation_unavailable' }).bank.items.length, 15);
  assert.equal(selectFallback(pkg, { validationEvidence: [], reason: 'standard_generation_unavailable' }).error, 'fallback_not_prevalidated');
  assert.equal(selectFallback({ ...pkg, state: 'Candidate' }, { validationEvidence, reason: 'standard_generation_unavailable' }).error,
    'fallback_requires_active_package');
  assert.equal(selectFallback(pkg, { validationEvidence, reason: 'source_unavailable' }).error, 'fallback_selection_reason_required');
  assert.equal(selectFallback(pkg, { validationEvidence, reason: 'standard_generation_unavailable',
    quarantinedScopes: [{ scopeType: 'objective', scopeId: 'o4' }] }).error, 'fallback_scope_quarantined');

  const incomplete = structuredClone(pkg);
  incomplete.fallbackBank.items.pop();
  assert.equal(selectFallback(incomplete, { validationEvidence, reason: 'standard_generation_unavailable' }).error, 'fallback_not_selectable');
});
