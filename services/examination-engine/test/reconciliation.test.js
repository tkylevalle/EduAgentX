'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./exam-harness');
test('exact admission reconciliation is answer-free, admin-only, and preserves replay identity', async t => {
  const ctx = await h.boot(t), suffix = `?agentLearnerKey=${h.ACTOR}&idempotencyKey=admit`;
  const route = '/internal/reconciliation/examinations' + suffix;
  for (const headers of [{ 'x-actor-role': 'admin', 'x-actor-subject': 'operator' },
    { ...h.ADMIN, 'x-internal-service-key': 'wrong' }])
    assert.equal((await ctx.call('GET', route, undefined, headers)).status, 403);
  assert.equal((await ctx.call('GET', route)).status, 403);
  assert.equal((await ctx.call('GET', route, undefined, h.ADMIN)).body.count, 0);
  const start = await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'admit' });
  const replay = await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'admit' });
  const inventory = await ctx.call('GET', route, undefined, h.ADMIN);
  assert.deepEqual(Object.keys(inventory.body).sort(), ['apiVersion', 'attemptIds', 'correlationId', 'count']);
  assert.deepEqual(inventory.body.attemptIds, [start.body.attempt.attemptId]);
  assert.equal(replay.body.attempt.attemptId, start.body.attempt.attemptId);
  assert.equal((await ctx.call('GET', route + '&extra=bad', undefined, h.ADMIN)).status, 400);
  for (const query of ['', '?agentLearnerKey=only', `?agentLearnerKey=${'x'.repeat(257)}&idempotencyKey=admit`,
    suffix + '&idempotencyKey=duplicate'])
    assert.equal((await ctx.call('GET', '/internal/reconciliation/examinations' + query, undefined, h.ADMIN)).status, 400);
  const other = await ctx.call('GET', '/internal/reconciliation/examinations?agentLearnerKey=*&idempotencyKey=*', undefined, h.ADMIN);
  assert.equal(other.body.count, 0);
});
