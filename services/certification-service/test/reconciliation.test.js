'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryStore } = require('../store');
const { createApp } = require('../index');
const http = require('node:http');
test('credential reconciliation reveals only IDs/counts and requires Gateway admin permission', async t => {
  const store = createMemoryStore(), id = '00000000-0000-4000-8000-000000000001';
  await store.issue({ evidence: { examinationId: id, decidedAt: '2026-11-01T00:00:00Z' }, commandKey: 'one', commandDigest: 'one',
    createCredential: () => ({ credentialId: 'credential-one', compactJws: 'MUST_NOT_EXPORT', credential: { privatePrompt: 'MUST_NOT_EXPORT' }, issuedAt: '2026-11-01T00:00:00Z' }) });
  const app = createApp({ store, internalKey: 'fixture-key', examinationEvidence: async () => null });
  const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const call = async headers => { const r = await fetch(`http://127.0.0.1:${server.address().port}/internal/reconciliation/credentials?examinationId=${id}`, { headers }); return { status: r.status, body: await r.json() }; };
  const headers = { 'x-internal-service-key': 'fixture-key', 'x-actor-role': 'gateway', 'x-actor-subject': 'operator' };
  const admin = { ...headers, 'x-reconciliation-role': 'admin' };
  for (const invalid of [{ 'x-actor-role': 'gateway', 'x-actor-subject': 'operator', 'x-reconciliation-role': 'admin' },
    { ...admin, 'x-internal-service-key': 'wrong' }, { ...admin, 'x-actor-role': 'agent' }])
    assert.equal((await call(invalid)).status, 403);
  assert.equal((await call(headers)).status, 403);
  const result = await call(admin);
  assert.equal(result.status, 200); assert.equal(result.body.count, 1);
  assert.deepEqual(result.body.credentialIds, ['credential-one']);
  assert.ok(!JSON.stringify(result.body).includes('MUST_NOT_EXPORT'));
  assert.deepEqual(Object.keys(result.body).sort(), ['apiVersion', 'correlationId', 'count', 'credentialIds']);
  for (const query of ['', '?examinationId=invalid', `?examinationId=${id}&extra=bad`, `?examinationId=${id}&examinationId=${id}`]) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/internal/reconciliation/credentials${query}`, { headers: admin });
    assert.equal(response.status, 400);
  }
});
