'use strict';

// Runs the real pg store against a disposable database. Skipped unless
// MARKETPLACE_TEST_DATABASE_URL is set; never point it at a real database,
// because these tables are append-only and test rows cannot be deleted.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const { createApp } = require('../index');
const { createPgStore, applyProjectionEvent } = require('../store');

const DATABASE_URL = process.env.MARKETPLACE_TEST_DATABASE_URL;
const skip = DATABASE_URL ? false : 'MARKETPLACE_TEST_DATABASE_URL not set';
const KEY = 'pg-internal-key';
const OPERATOR = 'pg-admin';
const RUN = randomUUID().slice(0, 8);
const PACKAGE = { id: 'pkg-ai-safety', version: '1.0.0', digest: 'sha256:package-1' };

const requestBody = (patch = {}) => ({
  domain: 'ai-agent-safety-secure-tool-use', requiredObjectiveIds: ['obj-a'], minOverallPercent: 85,
  minAdversarialPercent: 75, maxCredentialAgeDays: 90, allowedAssessmentModes: ['standard'],
  requiredEnvironment: 'simulation', title: 'PG request', ...patch,
});
const issued = (agent) => ({
  eventId: `evt-issued-${agent}`, eventType: 'credential.issued', credentialId: `cred-${agent}`, agentLearnerKey: agent,
  occurredAt: '2026-10-01T00:00:00.000Z',
  credential: { configurationFingerprint: `sha256:fp-${agent}`, package: { ...PACKAGE }, overallPercent: 90,
    adversarialPercent: 80, assessmentMode: 'standard', environment: 'simulation',
    validFrom: '2026-10-01T00:00:00.000Z', validUntil: '2027-10-01T00:00:00.000Z' },
});

// Fake authoritative sources: only the store is real in this test.
const sources = {
  status: new Map(),
  verification: { async verify(c) { return { signature: 'valid', schema: 'valid', status: sources.status.get(c.credentialId) || 'active' }; } },
  registry: { async getCurrentFingerprint(key) { return `sha256:fp-${key}`; } },
  package: { async getPackage() { return { digest: PACKAGE.digest, domain: 'ai-agent-safety-secure-tool-use', objectiveIds: ['obj-a'] }; } },
  lifecycle: { async isLifecycleOrigin() { return true; } },
};

function send(server, method, urlPath, body, actor = OPERATOR) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port: server.address().port, method, path: urlPath, agent: false,
      headers: { 'x-internal-service-key': KEY, 'x-actor-subject': actor,
        ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {}) } }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} }));
    });
    req.on('error', reject);
    req.end(data);
  });
}

test('the real pg store supports the whole Marketplace flow and keeps evidence immutable', { skip }, async (t) => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  t.after(() => pool.end());
  await pool.query('CREATE SCHEMA IF NOT EXISTS marketplace_service');
  const schema = fs.readFileSync(path.resolve(__dirname, '../schema.sql'), 'utf8');
  // Twice: startup applies it on every boot.
  await pool.query(schema);
  await pool.query(schema);

  const store = createPgStore(pool);
  const server = http.createServer(createApp({ store, sources, internalKey: KEY, clock: () => '2026-10-18T00:00:00.000Z' }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const agents = [`pg-agent-b-${RUN}`, `pg-agent-a-${RUN}`];

  await t.test('create, version, open, close and inspect', async () => {
    const created = await send(server, 'POST', '/internal/capability-requests', { idempotencyKey: `c-${RUN}`, request: requestBody() });
    assert.equal(created.status, 201);
    const id = created.body.request.id;
    const replay = await send(server, 'POST', '/internal/capability-requests', { idempotencyKey: `c-${RUN}`, request: requestBody() });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.request.id, id);
    assert.equal((await send(server, 'POST', '/internal/capability-requests',
      { idempotencyKey: `c-${RUN}`, request: requestBody({ title: 'changed' }) })).status, 409);
    const v2 = await send(server, 'POST', `/internal/capability-requests/${id}/versions`,
      { idempotencyKey: `v2-${RUN}`, request: requestBody({ title: 'v2' }) });
    assert.deepEqual(v2.body.request.versions.map((v) => v.version), [1, 2]);
    assert.deepEqual(v2.body.request.versions[0], created.body.request.versions[0]);
    assert.deepEqual((await send(server, 'POST', `/internal/capability-requests/${id}/open`, { version: 2 })).body.request.state,
      { status: 'open', openVersion: 2 });
    assert.equal((await send(server, 'POST', `/internal/capability-requests/${id}/close`, {})).body.request.state.status, 'closed');
    assert.equal((await send(server, 'POST', `/internal/capability-requests/${id}/eligibility-checks`,
      { idempotencyKey: `closed-${RUN}` })).body.error, 'request_not_open');
    const read = await send(server, 'GET', `/internal/capability-requests/${id}`);
    assert.deepEqual(read.body.request.events.map((e) => e.eventType), ['opened', 'closed']);
    assert.ok((await send(server, 'GET', '/internal/capability-requests')).body.requests.some((r) => r.id === id));
  });

  await t.test('listings, projection events and a check with replay', async () => {
    for (const agent of agents) {
      assert.equal((await applyProjectionEvent(store, issued(agent))).outcome, 'applied');
      assert.equal((await applyProjectionEvent(store, issued(agent))).outcome, 'duplicate');
      assert.equal((await send(server, 'POST', '/internal/listings/publish', { idempotencyKey: `p-${agent}` }, agent)).status, 201);
    }
    const suspend = { eventId: `evt-s-${RUN}`, eventType: 'credential.suspended', credentialId: `cred-${agents[0]}`,
      agentLearnerKey: agents[0], occurredAt: '2026-10-05T00:00:00.000Z' };
    assert.equal((await applyProjectionEvent(store, suspend)).outcome, 'applied');
    assert.equal((await applyProjectionEvent(store, suspend)).outcome, 'duplicate');
    const projected = (await store.listProjection()).find((r) => r.credentialId === `cred-${agents[0]}`);
    assert.equal(projected.status, 'suspended');
    assert.equal(projected.lastEventId, `evt-s-${RUN}`);

    const listing = await send(server, 'GET', `/internal/listings/${agents[1]}`);
    assert.equal(listing.body.listing.discoverable, true);

    const id = (await send(server, 'POST', '/internal/capability-requests',
      { idempotencyKey: `c2-${RUN}`, request: requestBody() })).body.request.id;
    await send(server, 'POST', `/internal/capability-requests/${id}/open`, { version: 1 });
    sources.status.set(`cred-${agents[0]}`, 'suspended');
    const check = await send(server, 'POST', `/internal/capability-requests/${id}/eligibility-checks`, { idempotencyKey: `k-${RUN}` });
    assert.equal(check.status, 201);
    const mine = (list) => list.filter((item) => agents.includes(item.agentLearnerKey));
    assert.deepEqual(mine(check.body.eligible).map((i) => i.agentLearnerKey), [agents[1]]);
    assert.deepEqual(mine(check.body.excluded).map((i) => i.reasons.map((r) => r.code)), [['STATUS_SUSPENDED']]);
    const replay = await send(server, 'POST', `/internal/capability-requests/${id}/eligibility-checks`, { idempotencyKey: `k-${RUN}` });
    assert.equal(replay.status, 200);
    assert.deepEqual(replay.body.eligible, check.body.eligible);
    const read = await send(server, 'GET', `/internal/eligibility-checks/${check.body.check.checkId}`);
    assert.deepEqual(read.body.excluded, check.body.excluded);
  });

  await t.test('evidence tables refuse UPDATE and DELETE; only the projection can change', async () => {
    for (const sql of [
      'UPDATE marketplace_service.capability_request_versions SET digest = \'tampered\'',
      'DELETE FROM marketplace_service.capability_request_events',
      'UPDATE marketplace_service.listing_events SET event_type = \'withdrawn\'',
      'DELETE FROM marketplace_service.projection_inbox',
      'UPDATE marketplace_service.eligibility_check_results SET eligible = true, reasons = \'[]\'',
      'DELETE FROM marketplace_service.eligibility_checks',
    ]) await assert.rejects(pool.query(sql), /immutable marketplace evidence/, sql);
    await pool.query(`UPDATE marketplace_service.credential_projection SET updated_at = now() WHERE credential_id = $1`,
      [`cred-${agents[1]}`]);
  });
});
