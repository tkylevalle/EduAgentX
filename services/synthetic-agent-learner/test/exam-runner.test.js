'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createExamRunner } = require('../exam-runner');
const { examAnswer } = require('../exam-scenarios');

// A Gateway stand-in: delivers a three-item form, records each response and
// reports the attempt complete on the first poll after the last answer.
function fakeGateway({ startStatus = 201, knowledgeStatus = 200 } = {}) {
  const calls = [];
  let sequence = 1, received = 0, polls = 0;
  const items = ['a1', 'a2', 'v4'].map((slotId, index) => ({ id: `item-${index}`, slotId, tier: 'recall', prompt: `Prompt ${slotId}` }));
  return {
    calls,
    async request(method, path, { body } = {}) {
      calls.push({ method, path, body });
      if (method === 'POST' && path === '/v1/examinations') {
        if (startStatus !== 201) return { status: startStatus, body: { error: 'examination_unavailable' } };
        return { status: 201, body: { attempt: { attemptId: 'attempt-1', status: 'in_progress', sequence,
          form: { package: { id: 'ai-safety', version: '0.1.6' }, items } } } };
      }
      if (method === 'GET' && path.startsWith('/v1/knowledge')) {
        if (knowledgeStatus === 'throw') throw new Error('gateway_timeout');
        return knowledgeStatus === 200 ? { status: 200, body: { mode: 'live', results: [{ moduleId: 'm1', text: 'lesson' }] } }
          : { status: knowledgeStatus, body: { error: 'knowledge_unavailable' } };
      }
      if (method === 'POST' && path.endsWith('/responses')) {
        assert.equal(body.expectedSequence, sequence);
        sequence += 1; received += 1;
        return { status: 200, body: { attempt: { attemptId: 'attempt-1', status: 'in_progress', sequence, responsesReceived: received } } };
      }
      polls += 1;
      return { status: 200, body: { attempt: { attemptId: 'attempt-1', status: polls > 1 ? 'complete' : 'in_progress', sequence } } };
    },
  };
}

test('exam runner answers every item in sequence and waits for the terminal state', async () => {
  const gateway = fakeGateway();
  const runner = createExamRunner({ gatewayClient: gateway, pollIntervalMs: 1 });
  const result = await runner.examine({ answerFor: (item, index) => examAnswer('safe-escalation', item, index) });
  assert.equal(result.outcome, 'complete');
  assert.equal(result.answered.length, 3);
  assert.equal(result.attempt.form, undefined, 'form is not echoed back');
  const responses = gateway.calls.filter((call) => call.path.endsWith('/responses'));
  assert.deepEqual(responses.map((call) => call.body.expectedSequence), [1, 2, 3]);
  assert.ok(gateway.calls.every((call) => !call.path.includes('grade') && !call.path.includes('finalize')),
    'the agent never grades or finalizes its own attempt');
});

test('answers may use knowledge.lookup pinned to the exam\'s package, and failed lookups are counted, not fatal', async () => {
  for (const [knowledgeStatus, lessons, failed] of [[200, 1, 0], [503, 0, 3], ['throw', 0, 3]]) {
    const gateway = fakeGateway({ knowledgeStatus });
    const seen = [];
    const result = await createExamRunner({ gatewayClient: gateway, pollIntervalMs: 1 }).examine({
      answerFor: async (item, index, tools) => { seen.push((await tools.lookup(item.prompt)).length); return examAnswer('safe-escalation', item, index); } });
    assert.equal(result.outcome, 'complete', String(knowledgeStatus));
    assert.deepEqual(seen, [lessons, lessons, lessons]);
    assert.deepEqual(result.knowledge, { lookups: 3, failed, empty: 0, stale: 0 });
    assert.ok(gateway.calls.some((call) => call.path === '/v1/knowledge?query=Prompt%20a1&limit=3&packageId=ai-safety&version=0.1.6'));
  }
});

test('exam runner reports an unavailable examination without answering', async () => {
  const gateway = fakeGateway({ startStatus: 503 });
  const result = await createExamRunner({ gatewayClient: gateway }).examine({ answerFor: () => 'x' });
  assert.equal(result.outcome, 'not_started');
  assert.equal(gateway.calls.length, 1);
});

test('a null answer stops answering so the attempt can reach its deadline', async () => {
  const gateway = fakeGateway();
  const result = await createExamRunner({ gatewayClient: gateway, pollIntervalMs: 1 })
    .examine({ answerFor: (item, index) => (index < 1 ? 'answer' : null), gradingWaitMs: 5 });
  assert.equal(result.answered.length, 1);
});

test('a requested domain goes to the Examination start and reaches every answer', async () => {
  const gateway = fakeGateway();
  const seen = [];
  const result = await createExamRunner({ gatewayClient: gateway, pollIntervalMs: 1 }).examine({ domainId: 'personal-data',
    answerFor: (item, index, tools) => { seen.push(tools.domainId); return examAnswer('safe-escalation', item, index); } });
  assert.equal(result.outcome, 'complete');
  assert.equal(gateway.calls.find((call) => call.path === '/v1/examinations').body.domainId, 'personal-data');
  assert.deepEqual(seen, ['personal-data', 'personal-data', 'personal-data']);
});

test('without a domain the Examination start carries no domainId', async () => {
  const gateway = fakeGateway();
  await createExamRunner({ gatewayClient: gateway, pollIntervalMs: 1 }).examine({ answerFor: (item, index) => examAnswer('safe-escalation', item, index) });
  assert.equal('domainId' in gateway.calls.find((call) => call.path === '/v1/examinations').body, false);
});

// A Gateway stand-in whose form is a text item then a behaviour item; the
// behaviour item's episode route answers episodeStatus.
function behaviourGateway({ episodeStatus = 200 } = {}) {
  const calls = [];
  let sequence = 1, polls = 0;
  const items = [{ id: 'item-0', slotId: 'a1', tier: 'recall', prompt: 'Prompt a1' },
    { id: 'item-b', slotId: 'b1', tier: 'behaviour', kind: 'behaviour', prompt: 'Act' }];
  return {
    calls,
    async request(method, path, { body } = {}) {
      calls.push({ method, path, body });
      if (method === 'POST' && path === '/v1/examinations') {
        return { status: 201, body: { attempt: { attemptId: 'attempt-1', status: 'in_progress', sequence, form: { items } } } };
      }
      if (path.startsWith('/v1/knowledge')) return { status: 200, body: { mode: 'live', results: [] } };
      if (method === 'POST' && path.endsWith('/responses')) {
        sequence += 1;
        return { status: 200, body: { attempt: { attemptId: 'attempt-1', status: 'in_progress', sequence } } };
      }
      if (path.includes('/episodes/')) {
        if (episodeStatus !== 200) return { status: episodeStatus, body: { error: 'sequence_conflict' } };
        return { status: 200, body: { observation: null, done: true, episodes: 1 } };
      }
      polls += 1;
      return { status: 200, body: { attempt: { attemptId: 'attempt-1', status: polls > 1 ? 'complete' : 'in_progress', sequence } } };
    },
  };
}

const finishPolicy = () => async () => ({ finish: { message: 'done' } });

// Review finding 2: a refused episode step is an outcome, so the caller keeps what was answered.
test('a refused episode step ends the run with episode_rejected and keeps the attempt, answers and lookups', async () => {
  const gateway = behaviourGateway({ episodeStatus: 409 });
  const result = await createExamRunner({ gatewayClient: gateway, pollIntervalMs: 1 }).examine({ correlationId: 'run-1',
    answerFor: async (item, index, tools) => { await tools.lookup(item.prompt); return 'answer'; }, actFor: finishPolicy });
  assert.deepEqual(result, { outcome: 'episode_rejected', attemptId: 'attempt-1', itemId: 'item-b', status: 409,
    reason: 'sequence_conflict', answered: [{ itemId: 'item-0', slotId: 'a1', tier: 'recall' }],
    knowledge: { lookups: 1, failed: 0, empty: 1, stale: 0 }, correlationId: 'run-1' });
  assert.equal(gateway.calls.some((call) => call.path === '/v1/examinations/attempt-1'), false, 'no grading wait after a refusal');
});

test('a played behaviour item counts as answered and the run waits for grading', async () => {
  const gateway = behaviourGateway();
  const result = await createExamRunner({ gatewayClient: gateway, pollIntervalMs: 1 }).examine({ answerFor: () => 'answer', actFor: finishPolicy });
  assert.equal(result.outcome, 'complete');
  assert.deepEqual(result.answered.map((entry) => entry.itemId), ['item-0', 'item-b']);
});
