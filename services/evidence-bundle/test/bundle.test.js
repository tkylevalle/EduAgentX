'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBundle, renderHTML, BUNDLE_VERSION, RETENTION } = require('../src/bundle');
const { redact, REDACT_MARKER } = require('../src/redactor');

const sampleInput = {
  buildEnv: { nodeVersion: '20.0.0', platform: 'linux', privateKey: 'SECRET_KEY' },
  contracts: [{ service: 'grading-service', endpoint: 'POST /grade', expectedAnswer: 'secret answer' }],
  packages: [{ id: 'pkg-001', version: '1.0.0', digest: 'abc123' }],
  policies: [{ id: 'rubric-v1', passThreshold: 0.80, signingKey: 'key-material' }],
  datasets: [{ id: 'labelled-100', count: 100, rawAnswer: 'raw answer text' }],
  kpis: { grading: { evidence: 'MET', value: 0.85, target: 0.80 } },
  incidents: [{ id: 'inc-001', scope: 'grading', resolved: true }],
  demonstrations: [{ scenario: 'safe_pass', result: 'PASS', token: 'secret-token' }],
  costs: { totalApiCalls: 0, credential: 'billing-key' },
  limitations: ['LLM grader not yet integrated'],
};

// ── Redaction tests ────────────────────────────────────────────────

test('redacts privateKey', () => {
  const result = redact({ privateKey: 'secret' });
  assert.strictEqual(result.privateKey, REDACT_MARKER);
});

test('redacts expectedAnswer', () => {
  const result = redact({ expectedAnswer: 'the answer' });
  assert.strictEqual(result.expectedAnswer, REDACT_MARKER);
});

test('redacts token in nested object', () => {
  const result = redact({ demo: { scenario: 'x', token: 'abc' } });
  assert.strictEqual(result.demo.token, REDACT_MARKER);
  assert.strictEqual(result.demo.scenario, 'x');
});

test('redacts rawAnswer in array', () => {
  const result = redact([{ rawAnswer: 'secret', count: 100 }]);
  assert.strictEqual(result[0].rawAnswer, REDACT_MARKER);
  assert.strictEqual(result[0].count, 100);
});

test('does not redact non-sensitive keys', () => {
  const result = redact({ id: 'pkg-001', version: '1.0.0', digest: 'abc' });
  assert.strictEqual(result.id, 'pkg-001');
  assert.strictEqual(result.version, '1.0.0');
});

test('redacts signingKey', () => {
  const result = redact({ signingKey: 'key-material' });
  assert.strictEqual(result.signingKey, REDACT_MARKER);
});

test('redacts credential', () => {
  const result = redact({ credential: 'billing-key' });
  assert.strictEqual(result.credential, REDACT_MARKER);
});

// ── Bundle structure tests ─────────────────────────────────────────

test('bundle contains all required sections', () => {
  const bundle = buildBundle(sampleInput);
  for (const key of ['buildEnv', 'contracts', 'packages', 'policies', 'datasets', 'kpis', 'incidents', 'demonstrations', 'costs', 'limitations']) {
    assert.ok(key in bundle.sections, `missing section: ${key}`);
  }
});

test('bundle has version, generatedAt, retention, digests, bundleDigest', () => {
  const bundle = buildBundle(sampleInput);
  assert.strictEqual(bundle.bundleVersion, BUNDLE_VERSION);
  assert.ok(typeof bundle.generatedAt === 'string');
  assert.deepStrictEqual(bundle.retention, RETENTION);
  assert.ok(typeof bundle.bundleDigest === 'string' && bundle.bundleDigest.length === 64);
  assert.ok(typeof bundle.digests === 'object');
});

test('sensitive material is redacted in bundle', () => {
  const bundle = buildBundle(sampleInput);
  const json = JSON.stringify(bundle);
  assert.ok(!json.includes('SECRET_KEY'), 'privateKey should be redacted');
  assert.ok(!json.includes('secret answer'), 'expectedAnswer should be redacted');
  assert.ok(!json.includes('raw answer text'), 'rawAnswer should be redacted');
  assert.ok(!json.includes('key-material'), 'signingKey should be redacted');
  assert.ok(!json.includes('secret-token'), 'token should be redacted');
  assert.ok(!json.includes('billing-key'), 'credential should be redacted');
});

test('each section has a digest', () => {
  const bundle = buildBundle(sampleInput);
  for (const key of Object.keys(bundle.sections)) {
    assert.ok(bundle.digests[key], `missing digest for section: ${key}`);
    assert.strictEqual(bundle.digests[key].length, 64);
  }
});

test('HTML bundle contains EduAgentX and bundle digest', () => {
  const bundle = buildBundle(sampleInput);
  const html = renderHTML(bundle);
  assert.ok(html.includes('EduAgentX Evidence Bundle'));
  assert.ok(html.includes(bundle.bundleDigest));
  assert.ok(html.includes('<!DOCTYPE html>'));
});

test('HTML bundle is responsive at 390px', () => {
  const bundle = buildBundle({});
  const html = renderHTML(bundle);
  assert.ok(html.includes('max-width:390px') || html.includes('max-width: 390px'));
});

test('empty input produces valid bundle', () => {
  const bundle = buildBundle({});
  assert.ok(bundle.bundleDigest);
  assert.ok(bundle.generatedAt);
  assert.strictEqual(bundle.bundleVersion, BUNDLE_VERSION);
});
