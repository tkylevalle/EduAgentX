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
// knowledge.lookup: the Gateway's default of three lessons, and its query limit.
const LOOKUP_RESULTS = 3;
const LOOKUP_MAX_QUERY_CHARS = 500;
const TERMINAL = new Set(['complete', 'agent_failed', 'system_aborted']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The Engine refused an episode step. playEpisode cannot be told to stop, so
// the refusal is thrown out of it and turned back into an outcome below.
class EpisodeRejected extends Error {
  constructor(status, reason) {
    super(`episode_step_failed:${status}:${reason}`);
    this.status = status;
    this.reason = reason;
  }
}

// The policy that plays a behaviour item: the run's reference policy for a
// provenance-bound attempt (the Engine refuses any other step), else actFor's.
function policyFor(attempt, item, actFor) {
  if (attempt.provenance) return execution.episodePolicy(attempt.provenance, item);
  return actFor ? actFor(item, { package: attempt.form?.package || null }) : null;
}

// knowledge.lookup, pinned to the exam's own package version so a lookup never
// reads a newer one. A failed lookup gives no lessons and the item is still
// answered; knowledge counts lookups, failures, empty answers and answers from
// the index's stale cache, so a closed or degraded book is visible.
function createLookup(call, knowledge, pkg) {
  const pin = pkg?.id && pkg?.version ? `&packageId=${encodeURIComponent(pkg.id)}&version=${encodeURIComponent(pkg.version)}` : '';
  return async (query, limit = LOOKUP_RESULTS) => {
    knowledge.lookups += 1;
    let reply;
    try {
      reply = await call('GET', `/v1/knowledge?query=${encodeURIComponent(String(query).slice(0, LOOKUP_MAX_QUERY_CHARS))}&limit=${limit}${pin}`);
    } catch { reply = null; }
    if (reply?.status !== 200 || !Array.isArray(reply.body?.results)) { knowledge.failed += 1; return []; }
    if (reply.body.mode !== 'live') knowledge.stale += 1;
    if (!reply.body.results.length) knowledge.empty += 1;
    return reply.body.results;
  };
}

// Plays one behaviour item through the Engine's step route. Each action is
// recorded by the Engine, which answers the item. Resolves to the updated
// attempt and, when the Engine refused a step, the refusal.
async function playBehaviourItem({ call, attempt, item, policy }) {
  let current = attempt;
  const episodePath = `/v1/examinations/${attempt.attemptId}/episodes/${encodeURIComponent(item.id)}`;
  const view = (reply) => {
    if (reply.status !== 200) throw new EpisodeRejected(reply.status, reply.body?.error || 'episode_step_failed');
    if (reply.body.attempt) current = { ...current, ...reply.body.attempt };
    return { observation: reply.body.observation, done: reply.body.done, episodes: reply.body.episodes };
  };
  let step = 0;
  try {
    await playEpisode(policy, { observe: async () => view(await call('GET', episodePath)),
      act: async (action) => view(await call('POST', `${episodePath}/steps`, {
        idempotencyKey: `step-${attempt.attemptId}-${item.id}-${step++}`, expectedSequence: current.sequence, action })) });
  } catch (error) {
    if (!(error instanceof EpisodeRejected)) throw error;
    return { attempt: current, rejected: { status: error.status, reason: error.reason } };
  }
  return { attempt: current, rejected: null };
}

// Polls until the grading sweep reaches a terminal state or the wait runs out.
async function awaitGrading(call, attempt, gradingWaitMs, pollIntervalMs) {
  let current = attempt;
  const deadline = Date.now() + gradingWaitMs;
  while (!TERMINAL.has(current.status) && Date.now() < deadline) {
    await sleep(pollIntervalMs);
    const reply = await call('GET', `/v1/examinations/${current.attemptId}`);
    if (reply.status === 200) current = reply.body.attempt;
  }
  return current;
}

function createExamRunner({ gatewayClient, idGenerator = randomUUID, pollIntervalMs = POLL_INTERVAL_MS } = {}) {
  if (!gatewayClient || typeof gatewayClient.request !== 'function') {
    throw new TypeError('A gateway client with a request method is required');
  }

  // answerFor(item, index, tools) returns the response text, or null to stop
  // answering (the attempt then waits for its deadline). tools.lookup(query)
  // is knowledge.lookup: the agent's declared read-only tool, so the exam is
  // open book.
  // actFor(item) returns the policy for a behaviour item, played through the
  // Engine's step route; without it a behaviour item gets answerFor's text.
  async function examine({ answerFor, actFor, correlationId = `exam-run-${idGenerator()}`,
    gradingWaitMs = DEFAULT_GRADING_WAIT_MS, trainingSessionId, executionProfile, domainId, onProgress = () => {} } = {}) {
    const call = (method, path, body) => gatewayClient.request(method, path, { body, correlationId });
    const knowledge = { lookups: 0, failed: 0, empty: 0, stale: 0 };
    const started = await call('POST', '/v1/examinations', { idempotencyKey: `exam-${idGenerator()}`, ...(trainingSessionId ? { trainingSessionId } : {}), ...(executionProfile ? { executionProfile } : {}),
      ...(domainId ? { domainId } : {}) });
    if (started.status !== 201 && started.status !== 200) {
      return { outcome: 'not_started', status: started.status, reason: started.body?.error || 'examination_unavailable',
        correlationId };
    }
    let attempt = started.body.attempt;
    const lookup = createLookup(call, knowledge, attempt.form?.package);
    const items = attempt.form?.items || [];
    onProgress({ stage: 'started', attemptId: attempt.attemptId, itemCount: items.length });
    const answered = [];
    for (const [index, item] of items.entries()) {
      // Behaviour items are played, never answered with text; a provenance-bound
      // attempt plays its source's reference policy, which the Engine checks step by step.
      const behaviour = item.kind === 'behaviour';
      const policy = behaviour ? policyFor(attempt, item, actFor) : null;
      if (policy) {
        const played = await playBehaviourItem({ call, attempt, item, policy });
        attempt = played.attempt;
        if (played.rejected) {
          return { outcome: 'episode_rejected', attemptId: attempt.attemptId, itemId: item.id, ...played.rejected,
            answered, knowledge, correlationId };
        }
      } else {
        const produced = attempt.provenance && !behaviour ? execution.receipt(attempt.provenance, 'examination', item, attempt.attemptId) : null;
        const response = produced ? produced.response : await answerFor(item, index, { lookup, package: attempt.form?.package || null, domainId: domainId || null });
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
      }
      answered.push({ itemId: item.id, slotId: item.slotId, tier: item.tier });
      onProgress({ stage: 'answered', attemptId: attempt.attemptId, itemId: item.id, answered: answered.length, itemCount: items.length });
    }

    attempt = await awaitGrading(call, attempt, gradingWaitMs, pollIntervalMs);
    const { form, ...summary } = attempt;
    onProgress({ stage: 'graded', attemptId: attempt.attemptId, status: attempt.status });
    return { outcome: TERMINAL.has(attempt.status) ? attempt.status : 'grading_pending', attempt: summary, knowledge,
      answered, correlationId };
  }

  return { examine };
}

module.exports = { createExamRunner, TERMINAL };
