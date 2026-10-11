'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src');
const candidate = require('../../curriculum-engine/examples/ai-safety-candidate');

function fakePackageDb(activePackage) {
  const packages = new Map([[activePackage.id, structuredClone(activePackage)]]);
  const evidence = new Map([[activePackage.id, []]]);
  const checks = new Map();
  const scopeEvents = new Map();
  const key = (id, version) => `${id}@${version}`;
  return {
    packages,
    async seedPackage(pkg) { packages.set(pkg.id, { ...structuredClone(pkg), state: 'Candidate' }); evidence.set(pkg.id, []); },
    async getPackage(id) { return structuredClone(packages.get(id) || null); },
    async getActivePackage() { return structuredClone([...packages.values()].find((pkg) => pkg.state === 'Active') || null); },
    async listPackages() { return [...packages.values()].map(({ id, version, digest, state }) => ({ id, version, digest, state })); },
    async appendEvidence(id, entry) { evidence.get(id).push(structuredClone(entry)); },
    async getEvidence(id) { return structuredClone(evidence.get(id) || []); },
    async appendFreshnessCheck(id, version, record) { const k = key(id, version); checks.set(k, [...(checks.get(k) || []), structuredClone(record)]); },
    async getFreshnessChecks(id, version) { return structuredClone(checks.get(key(id, version)) || []); },
    async appendScopeEvent(id, version, event) { const k = key(id, version); scopeEvents.set(k, [...(scopeEvents.get(k) || []), structuredClone(event)]); },
    async getScopedQuarantines(id, version) {
      const latest = new Map();
      for (const event of scopeEvents.get(key(id, version)) || []) latest.set(`${event.scopeType}:${event.scopeId}`, event);
      return [...latest.values()].filter((event) => event.event === 'quarantined').map((event) => ({ scopeType: event.scopeType, scopeId: event.scopeId, evidence: event.evidence }));
    },
    async setPackageState(id, state) { packages.get(id).state = state; },
  };
}

async function withServer(fn) {
  const pkg = structuredClone(candidate);
  pkg.id = pkg.manifest.packageId;
  pkg.version = pkg.manifest.version;
  pkg.state = 'Active';
  pkg.digest = 'd'.repeat(64);
  const packageDb = fakePackageDb(pkg);
  const app = createApp({ packageDb, internalKey: 'test-key', now: () => new Date('2026-10-11T12:00:00.000Z') });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}`, packageDb); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

const headers = { 'content-type': 'application/json', 'x-internal-service-key': 'test-key', 'x-actor-subject': 'reviewer-1' };
const freshCheck = (changeKind, contentSha256, extra = {}) => ({ sourceId: 'nist-rmf', evidence: {
  observedAt: '2026-10-11T12:00:00.000Z', evidenceUrl: 'https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf',
  snapshotReference: 'capture-2026-10-11', contentSha256, changeKind, summary: `Detected ${changeKind} source update`, ...extra,
} });

test('freshness endpoint defaults to 30 days, creates a separate Candidate on substantive change, and preserves active', async () => {
  await withServer(async (baseUrl, store) => {
    const active = [...store.packages.values()][0];
    const due = await fetch(`${baseUrl}/packages/${active.id}/freshness`).then((res) => res.json());
    assert.equal(due.intervalDays, 30);
    assert.equal(due.sources.every((source) => source.due), true);

    const response = await fetch(`${baseUrl}/packages/${active.id}/freshness-checks`, {
      method: 'POST', headers, body: JSON.stringify(freshCheck('material', 'b'.repeat(64))),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.classification, 'Substantive');
    assert.notEqual(result.candidatePackage.packageId, active.id);
    assert.equal((await store.getPackage(active.id)).state, 'Active');
    assert.equal((await store.getPackage(result.candidatePackage.packageId)).state, 'Candidate');
  });
});

test('critical source correction quarantines the smallest validated scope and exposes a certification block', async () => {
  await withServer(async (baseUrl, store) => {
    const active = [...store.packages.values()][0];
    const response = await fetch(`${baseUrl}/packages/${active.id}/freshness-checks`, {
      method: 'POST', headers,
      body: JSON.stringify({ ...freshCheck('critical', 'c'.repeat(64)), scope: { type: 'delivery_item', id: 'm1-lesson-1' } }),
    });
    assert.equal(response.status, 202);
    const result = await response.json();
    assert.equal(result.classification, 'Critical');
    const activeView = await fetch(`${baseUrl}/packages/active`).then((res) => res.json());
    assert.equal(activeView.certificationBlocked, true);
    assert.deepEqual(activeView.quarantinedScopes.map(({ scopeType, scopeId }) => [scopeType, scopeId]), [['delivery_item', 'm1-lesson-1']]);
    const candidatePkg = await store.getPackage(result.candidatePackage.packageId);
    assert.equal(candidatePkg.state, 'Candidate');
  });
});

test('fallback selection requires prior passing validation, complete pinned bank, and an explicit outage reason', async () => {
  await withServer(async (baseUrl, store) => {
    const active = [...store.packages.values()][0];
    const selectionUrl = `${baseUrl}/fallback/select`;
    const payload = { package_id: active.id, reason: 'standard_generation_unavailable' };
    const refused = await fetch(selectionUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
    assert.equal(refused.status, 409);
    assert.equal((await refused.json()).error, 'fallback_not_prevalidated');

    await store.appendEvidence(active.id, { event: 'validation_run', result: { passed: true } });
    const selectedResponse = await fetch(selectionUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
    assert.equal(selectedResponse.status, 200);
    const selected = await selectedResponse.json();
    assert.equal(selected.mode, 'fallback');
    assert.equal(selected.items.length, 15);
    assert.equal(selected.items.some((item) => Object.hasOwn(item, 'expectedAnswer')), false);

    const partial = await fetch(`${baseUrl}/fallback/score`, { method: 'POST', headers,
      body: JSON.stringify({ package_id: active.id, attemptId: selected.attemptId, responses: [] }) });
    assert.equal(partial.status, 422);
  });
});
