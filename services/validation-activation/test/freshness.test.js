'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyFreshness, DEFAULT_FRESHNESS_DAYS, isDue, verifySnapshot } = require('../src/freshness');

const source = { id: 'src-1', canonicalUrl: 'https://example.test/source', snapshotUrl: 'https://example.test/source.pdf',
  edition: '1', contentSha256: 'a'.repeat(64) };
const evidence = (overrides = {}) => ({ observedAt: '2026-10-11T08:00:00.000Z', evidenceUrl: source.snapshotUrl,
  snapshotReference: 'sha256:captured-snapshot-1', contentSha256: source.contentSha256, changeKind: 'unchanged', summary: 'Checked official snapshot', ...overrides });

test('freshness checks default to a 30-day interval and are due when no prior check exists', () => {
  assert.equal(DEFAULT_FRESHNESS_DAYS, 30);
  assert.equal(isDue(null, new Date('2026-10-11T00:00:00Z')), true);
  assert.equal(isDue('2026-10-01T00:00:00Z', new Date('2026-10-11T00:00:00Z')), false);
  assert.equal(isDue('2026-09-11T00:00:00Z', new Date('2026-10-11T00:00:00Z')), true);
});

test('source hash equality classifies No Change and changed evidence maps to the approved classifications', () => {
  assert.equal(classifyFreshness(source, evidence()).classification, 'No Change');
  const mapping = { watch: 'Watch', editorial: 'Patch', material: 'Substantive', critical: 'Critical' };
  for (const [changeKind, classification] of Object.entries(mapping)) {
    const result = classifyFreshness(source, evidence({ contentSha256: 'b'.repeat(64), changeKind }));
    assert.equal(result.classification, classification);
    assert.equal(result.evidence.previousContentSha256, source.contentSha256);
    assert.equal(result.evidence.observedContentSha256, 'b'.repeat(64));
  }
});

test('source checks reject mismatched URLs, invalid hashes, and a false no-change classification', () => {
  assert.ok(classifyFreshness(source, evidence({ evidenceUrl: 'https://untrusted.test/source' })).errors.length);
  assert.ok(classifyFreshness(source, evidence({ contentSha256: 'not-a-hash', changeKind: 'material' })).errors.length);
  assert.ok(classifyFreshness(source, evidence({ contentSha256: 'b'.repeat(64), changeKind: 'unchanged' })).errors.length);
});

test('snapshot verification compares bytes against a SHA-256 digest', () => {
  const bytes = Buffer.from('captured source');
  const digest = require('node:crypto').createHash('sha256').update(bytes).digest('hex');
  assert.equal(verifySnapshot(bytes, digest), true);
  assert.equal(verifySnapshot(bytes, '0'.repeat(64)), false);
});
