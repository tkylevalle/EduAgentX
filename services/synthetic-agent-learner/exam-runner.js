'use strict';

const { playEpisode } = require('./exam-scenarios');

// Takes one standard Examination through the public Gateway, as any External
// Agent Learner would: start an attempt, answer each delivered item in order,
// then wait while the Examination Engine's grading sweep reaches a terminal
// state. Grading, finalization and certification are never called from here;
// the Gateway does not expose them to an agent.

const execution = require('../../packages/execution-provenance');
const { randomUUID } = require('node:crypto');

const POLL_INTERVAL_MS = 1000;
const DEFAULT_GRADING_WAIT_MS = 60_000;
const TERMINAL = new Set(['complete', 'agent_failed', 'system_aborted']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The policy that plays a behaviour item: the run's reference policy for a
// provenance-bound attempt (the Engine refuses any other step), else actFor's.
function policyFor(attempt, item, actFor) {
  if (attempt.provenance) return execution.episodePolicy(attempt.provenance, item);
  return actFor ? actFor(item) : null;
}

function createExamRunner({ gatewayClient, idGenerator = randomUUID, pollIntervalMs = POLL_INTERVAL_MS } = {}) {
  if (!gatewayClient || typeof gatewayClient.request !== 'function') {
    throw new TypeError('A gateway client with a request method is required');
  }

  // answerFor(item, index) returns the response text, or null to stop
  // answering (the attempt then waits for its deadline).
  // actFor(item) returns the policy for a behaviour item, played through the
  // Engine's step route; without it a behaviour item gets answerFor's text.
  async function examine({ answerFor, actFor, correlationId = `exam-run-${idGenerator()}`,
    gradingWaitMs = DEFAULT_GRADING_WAIT_MS, trainingSessionId, executionProfile, onProgress = () => {} } = {}) {
    const call = (method, path, body) => gatewayClient.request(method, path, { body, correlationId });
    const started = await call('POST', '/v1/examinations', { idempotencyKey: `exam-${idGenerator()}`, ...(trainingSessionId ? { trainingSessionId } : {}), ...(executionProfile ? { executionProfile } : {}) });
    if (started.status !== 201 && started.status !== 200) {
      return { outcome: 'not_started', status: started.status, reason: started.body?.error || 'examination_unavailable',
        correlationId };
    }
    let attempt = started.body.attempt;
    const items = attempt.form?.items || [];
    onProgress({ stage: 'started', attemptId: attempt.attemptId, itemCount: items.length });
    const answered = [];
    for (const [index, item] of items.entries()) {
      // Behaviour items are played, never answered with text; a provenance-bound
      // attempt plays its source's reference policy, which the Engine checks step by step.
      const behaviour = item.kind === 'behaviour';
      const produced = attempt.provenance && !behaviour ? execution.receipt(attempt.provenance, 'examination', item, attempt.attemptId) : null;
      const policy = behaviour ? policyFor(attempt, item, actFor) : null;
      if (policy) {
        // Each action is recorded by the Engine; the Engine answers the item.
        const episodePath = `/v1/examinations/${attempt.attemptId}/episodes/${encodeURIComponent(item.id)}`;
        const view = (reply) => {
          if (reply.status !== 200) throw new Error(`episode_step_failed:${reply.status}:${reply.body?.error || ''}`);
          if (reply.body.attempt) attempt = { ...attempt, ...reply.body.attempt };
          return { observation: reply.body.observation, done: reply.body.done, episodes: reply.body.episodes };
        };
        let step = 0;
        await playEpisode(policy, { observe: async () => view(await call('GET', episodePath)),
          act: async (action) => view(await call('POST', `${episodePath}/steps`, {
            idempotencyKey: `step-${attempt.attemptId}-${item.id}-${step++}`, expectedSequence: attempt.sequence, action })) });
        answered.push({ itemId: item.id, slotId: item.slotId, tier: item.tier });
        onProgress({ stage: 'answered', attemptId: attempt.attemptId, itemId: item.id, answered: answered.length, itemCount: items.length });
        continue;
      }
      const response = produced ? produced.response : await answerFor(item, index);
      if (response === null || response === undefined) break;
      const receipt = await call('POST', `/v1/examinations/${attempt.attemptId}/responses`, {
        idempotencyKey: `answer-${attempt.attemptId}-${item.id}`, expectedSequence: attempt.sequence,
        itemId: item.id, response, ...(executionProfile ? { executionProfile } : {}),
        ...(produced ? { executionEvidence: produced.executionEvidence } : {}),
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
