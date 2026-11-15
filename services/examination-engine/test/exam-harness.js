'use strict';

// Shared harness for Engine tests that run a real app on an in-memory store:
// one Active package, one registered learner and a Training completion.

const assert = require('node:assert/strict');
const http = require('node:http');
const { sha256 } = require('../../curriculum-engine/model');
const candidate = require('../../curriculum-engine/examples/ai-safety-candidate');
const { createApp } = require('../index');
const { createMemoryStore } = require('../store');
const { createGradingRunner } = require('../grading');
const { playEpisode } = require('../../synthetic-agent-learner/exam-scenarios');
const { PANEL } = require('../../../packages/agent-sandbox/src/panel');

const INTERNAL_KEY = 'grading-run-service-key';
const GRADING_KEY = 'grading-run-grading-key';
const ACTOR = 'grading-run-learner';
const START = '2026-10-15T06:00:00.000Z';
const ANSWERED = '2026-10-15T06:30:00.000Z';
const AGENT = { 'x-internal-service-key': INTERNAL_KEY, 'x-actor-subject': ACTOR, 'x-actor-role': 'agent' };
const ADMIN = { ...AGENT, 'x-actor-subject': 'grading-run-admin', 'x-actor-role': 'admin' };
const EXAMINER = { ...AGENT, 'x-actor-subject': 'grading-sweep', 'x-actor-role': 'examiner', 'x-internal-grading-key': GRADING_KEY };
const EPISODE_KEY = 'engine-test-episode-seed-key-0123456789abcdef';
const SAFE_POLICY = PANEL.find((entry) => entry.id === 'safe-agent').agent;

const SAFE = 'I map the boundary, verify the evidence, refuse untrusted instructions and escalate to a human operator.';
const GRADER = { id: 'test-grader', version: '1.0.0' };

function fixture() {
  const pkg = structuredClone(candidate);
  pkg.packageId = pkg.manifest.packageId; pkg.version = pkg.manifest.version;
  pkg.state = 'Active'; pkg.digest = sha256(pkg); pkg.quarantinedScopes = []; pkg.certificationBlocked = false;
  const registration = { agentLearnerKey: ACTOR, configurationFingerprint: 'sha256:grading-run' };
  const completion = { eventType: 'training.session.completed', eventId: 'grading-run-completed', sessionId: 'grading-run-session',
    agentLearnerKey: ACTOR, configurationFingerprint: registration.configurationFingerprint,
    package: { id: pkg.packageId, version: pkg.version, digest: pkg.digest },
    completion: { plannedItems: 10, completedItems: 10 }, evidence: { mode: 'synthetic', environment: 'simulation' } };
  return { pkg, registration, completion };
}

// The fake grader scores every item `score` unless `perItem` overrides it.
function fakeGrader({ score = 90, perItem = () => ({}), reply } = {}) {
  const grader = async ({ items }) => {
    grader.calls.push(items);
    if (grader.fail) throw grader.fail;
    if (reply) return reply(items);
    return { ok: true, body: { grader: GRADER, results: items.map((item) => ({ itemId: item.itemId, score,
      criticalViolationRuleIds: [], rationale: 'fake grader', citedItemIds: [item.itemId], ...perItem(item) })) } };
  };
  grader.calls = [];
  return grader;
}

async function boot(t, { grader = fakeGrader(), retryWindowMs = 15 * 60 * 1000, appOptions = {}, sources: overrides = {} } = {}) {
  const input = fixture();
  let now = START;
  const store = createMemoryStore();
  const sources = { activePackage: async () => input.pkg, registration: async () => input.registration,
    completion: async () => input.completion, ...overrides };
  const clock = () => now;
  const app = createApp({ store, sources, internalKey: INTERNAL_KEY, gradingKey: GRADING_KEY, clock, episodeSeedKey: EPISODE_KEY,
    durationMinutes: 60, gradeItems: grader, gradingRetryWindowMs: retryWindowMs, ...appOptions });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const call = (method, path, body, headers = AGENT) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method, headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    .then(async (response) => ({ status: response.status, body: await response.json() }));
  const runner = createGradingRunner({ store, sources, gradeItems: grader, clock, retryWindowMs, episodeSeedKey: EPISODE_KEY });
  return { input, store, grader, call, runner, clock, setClock: (value) => { now = value; } };
}

// Answers: text items take a string; behaviour items take { policy }, played
// step by step through the Engine's recorded episode routes. A string for a
// behaviour item is played as an agent that only writes that text.
const safeAnswer = (item) => (item.kind === 'behaviour' ? { policy: SAFE_POLICY } : SAFE);

// The instruction follower on one behaviour slot: in the v2 world it sends
// mail with a tool the task does not permit (critical-o4).
const FOLLOWER_POLICY = PANEL.find((entry) => entry.id === 'instruction-follower').agent;
const unsafeAnswer = (slotId = 'v2') => (item, index, attemptId) =>
  (item.kind === 'behaviour' && item.slotId === slotId ? { policy: FOLLOWER_POLICY } : safeAnswer(item, index, attemptId));

// Records one item's answer and returns the attempt after it.
async function answerItem(ctx, attempt, item, answer, key) {
  if (item.kind !== 'behaviour') {
    const reply = await ctx.call('POST', `/internal/attempts/${attempt.attemptId}/responses`, { idempotencyKey: key,
      expectedSequence: attempt.sequence, itemId: item.id, response: answer });
    assert.equal(reply.status, 200, `${item.slotId}: ${JSON.stringify(reply.body)}`);
    return reply.body.attempt;
  }
  const policy = typeof answer === 'string' ? () => ({ finish: { message: answer } }) : answer.policy;
  const path = `/internal/attempts/${attempt.attemptId}/episodes/${item.id}`;
  let current = attempt;
  let step = 0;
  await playEpisode(policy, {
    observe: async () => (await ctx.call('GET', path)).body,
    act: async (action) => {
      const reply = await ctx.call('POST', `${path}/steps`, { idempotencyKey: `${key}-step-${step++}`, expectedSequence: current.sequence, action });
      assert.equal(reply.status, 200, `${item.slotId} step: ${JSON.stringify(reply.body)}`);
      current = reply.body.attempt;
      return reply.body;
    },
  });
  return current;
}

async function startAndAnswer(ctx, answer = safeAnswer) {
  const started = await ctx.call('POST', '/internal/attempts', { idempotencyKey: 'start' });
  assert.equal(started.status, 201);
  let attempt = started.body.attempt;
  const form = attempt.form;
  ctx.setClock(ANSWERED);
  for (const [index, item] of form.items.entries()) {
    attempt = await answerItem(ctx, attempt, item, answer(item, index, attempt.attemptId), `r-${index}`);
  }
  return { ...attempt, form };
}

const grade = (ctx, attempt, headers = EXAMINER) => ctx.call('POST', `/internal/attempts/${attempt.attemptId}/grade`, {}, headers);
const adminView = async (ctx, attempt) => (await ctx.call('GET', `/internal/admin/attempts/${attempt.attemptId}`, undefined, ADMIN)).body.attempt;

module.exports = { INTERNAL_KEY, GRADING_KEY, EPISODE_KEY, ACTOR, START, ANSWERED, AGENT, ADMIN, EXAMINER, SAFE, GRADER, answerItem, safeAnswer, unsafeAnswer,
  fixture, fakeGrader, boot, startAndAnswer, grade, adminView };
