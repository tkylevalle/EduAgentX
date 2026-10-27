'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createExamRunner } = require('../exam-runner');
const { examAnswer } = require('../exam-scenarios');

// A Gateway stand-in: delivers a three-item form, records each response and
// reports the attempt complete on the first poll after the last answer.
function fakeGateway({ startStatus = 201 } = {}) {
  const calls = [];
  let sequence = 1, received = 0, polls = 0;
  const items = ['a1', 'a2', 'v4'].map((slotId, index) => ({ id: `item-${index}`, slotId, tier: 'recall', prompt: `Prompt ${slotId}` }));
  return {
    calls,
    async request(method, path, { body } = {}) {
      calls.push({ method, path, body });
      if (method === 'POST' && path === '/v1/examinations') {
        if (startStatus !== 201) return { status: startStatus, body: { error: 'examination_unavailable' } };
        return { status: 201, body: { attempt: { attemptId: 'attempt-1', status: 'in_progress', sequence, form: { items } } } };
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
