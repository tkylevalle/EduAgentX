'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryStore } = require('../store');
const { createApp } = require('../index');
const http = require('node:http');
test('matching reconciliation uses exact actor/key and only returns safe IDs and lane appearances', async t => {
  const store = createMemoryStore();
  await store.transaction('fixture', tx => tx.insertMatch({ resultId: 'result-one', requestId: 'req', requestVersion: 1,
    actor: 'operator', idempotencyKey: 'one', policyVersion: 'MATCH-POLICY-1.0.0',
    eligibleMatches: [{ agentLearnerKey: 'agent', privatePrompt: 'MUST_NOT_EXPORT' }], nearMatches: [], compactJws: 'MUST_NOT_EXPORT' }));
  const app = createApp({ store, internalKey: 'fixture-key', sources: { registry: {}, verification: {}, package: {}, lifecycle: {} } });
  const server = http.createServer(app); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const call = async (role, key = 'fixture-key') => { const r = await fetch(`http://127.0.0.1:${server.address().port}/internal/reconciliation/matches?actor=operator&idempotencyKey=one`,
    { headers: { ...(key === null ? {} : { 'x-internal-service-key': key }), 'x-actor-subject': 'reader', 'x-actor-role': role } }); return { status: r.status, body: await r.json() }; };
  assert.equal((await call('admin', null)).status, 401);
  assert.equal((await call('admin', 'wrong')).status, 401);
  assert.equal((await call('agent')).status, 403);
  const result = await call('admin'); assert.equal(result.status, 200);
  assert.equal(result.body.count, 1); assert.deepEqual(result.body.appearances, [{ resultId: 'result-one', agentLearnerKey: 'agent', lane: 'eligibleMatches' }]);
  assert.ok(!JSON.stringify(result.body).includes('MUST_NOT_EXPORT'));
  assert.deepEqual(Object.keys(result.body).sort(), ['apiVersion', 'appearances', 'correlationId', 'count', 'resultIds']);
  assert.equal((await store.reconcileMatches('other', 'one')).count, 0);
  for (const query of ['', '?actor=only', `?actor=${'x'.repeat(257)}&idempotencyKey=one`, '?actor=operator&idempotencyKey=one&extra=bad',
    '?actor=operator&actor=other&idempotencyKey=one']) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/internal/reconciliation/matches${query}`, {
      headers: { 'x-internal-service-key': 'fixture-key', 'x-actor-subject': 'reader', 'x-actor-role': 'admin' } });
    assert.equal(response.status, 400);
  }
});
