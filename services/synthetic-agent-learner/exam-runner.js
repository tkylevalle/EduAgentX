'use strict';

// Takes one standard Examination through the public Gateway, as any External
// Agent Learner would: start an attempt, answer each delivered item in order,
// then wait while the Examination Engine's grading sweep reaches a terminal
// state. Grading, finalization and certification are never called from here;
// the Gateway does not expose them to an agent.

const { randomUUID } = require('node:crypto');

const POLL_INTERVAL_MS = 1000;
const DEFAULT_GRADING_WAIT_MS = 60_000;
const TERMINAL = new Set(['complete', 'agent_failed', 'system_aborted']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createExamRunner({ gatewayClient, idGenerator = randomUUID, pollIntervalMs = POLL_INTERVAL_MS } = {}) {
  if (!gatewayClient || typeof gatewayClient.request !== 'function') {
    throw new TypeError('A gateway client with a request method is required');
  }

  // answerFor(item, index) returns the response text, or null to stop
  // answering (the attempt then waits for its deadline).
  async function examine({ answerFor, correlationId = `exam-run-${idGenerator()}`,
    gradingWaitMs = DEFAULT_GRADING_WAIT_MS, onProgress = () => {} } = {}) {
    const call = (method, path, body) => gatewayClient.request(method, path, { body, correlationId });
    const started = await call('POST', '/v1/examinations', { idempotencyKey: `exam-${idGenerator()}` });
    if (started.status !== 201 && started.status !== 200) {
      return { outcome: 'not_started', status: started.status, reason: started.body?.error || 'examination_unavailable',
        correlationId };
    }
    let attempt = started.body.attempt;
    const items = attempt.form?.items || [];
    onProgress({ stage: 'started', attemptId: attempt.attemptId, itemCount: items.length });
    const answered = [];
    for (const [index, item] of items.entries()) {
      const response = await answerFor(item, index);
      if (response === null || response === undefined) break;
      const receipt = await call('POST', `/v1/examinations/${attempt.attemptId}/responses`, {
        idempotencyKey: `answer-${attempt.attemptId}-${item.id}`, expectedSequence: attempt.sequence,
        itemId: item.id, response,
      });
      if (receipt.status !== 200) {
        return { outcome: 'response_rejected', attemptId: attempt.attemptId, itemId: item.id,
          reason: receipt.body?.error || 'response_rejected', answered, correlationId };
      }
      attempt = { ...attempt, ...receipt.body.attempt };
      answered.push({ itemId: item.id, slotId: item.slotId, tier: item.tier });
      onProgress({ stage: 'answered', attemptId: attempt.attemptId, itemId: item.id, answered: answered.length,
        itemCount: items.length });
    }

    const deadline = Date.now() + gradingWaitMs;
    while (!TERMINAL.has(attempt.status) && Date.now() < deadline) {
      await sleep(pollIntervalMs);
      const current = await call('GET', `/v1/examinations/${attempt.attemptId}`);
      if (current.status === 200) attempt = current.body.attempt;
    }
    const { form, ...summary } = attempt;
    onProgress({ stage: 'graded', attemptId: attempt.attemptId, status: attempt.status });
    return { outcome: TERMINAL.has(attempt.status) ? attempt.status : 'grading_pending', attempt: summary,
      answered, correlationId };
  }

  return { examine };
}

module.exports = { createExamRunner, TERMINAL };
