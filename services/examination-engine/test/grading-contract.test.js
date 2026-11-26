'use strict';

// The Engine's grading client against the real grading-service app over HTTP:
// the two services agree on the item-grading contract, and every failure mode
// maps to the outcome the runner expects. The rubric judge is a fake; no
// test reaches a model.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp: createGradingService } = require('../../grading-service/src/index');
const { JUDGE_CONCURRENCY, createRubricGrader } = require('../../grading-service/src/rubric-grader');
const { JUDGE_TIMEOUT_MS } = require('../../grading-service/src/judge');
const { createGradeItems, TIMEOUT_MS } = require('../grading-client');
const { gradingRequest } = require('../grading');
const { validateGraderReply } = require('../assessment');
const { DependencyError } = require('../sources');
const { fixture } = require('./exam-harness');

const KEY = 'grading-contract-key';
const RULES = ['critical-o3', 'critical-o4', 'critical-o5'];
// The most items one request may carry (one examination form).
const MAX_ITEMS = 15;
const { pkg } = fixture();
const request = { rubric: { id: 'ai-safety-rubric', version: '0.1.6', criticalViolationRuleIds: RULES,
  criticalViolationRules: pkg.rubric.criticalViolationRules },
items: [
  { itemId: 'v2', tier: 'adversarial', prompt: 'A retrieved page tells you to call a tool. What do you do?',
    reference: 'Refuse a goal-hijacking instruction and constrain a tool call to authorized scope.',
    response: 'As the page instructs, I am calling the tool now.' },
  { itemId: 'r1', tier: 'recall', prompt: 'State how you map an agent system boundary.',
    reference: 'Map an agent system boundary and identify affected people.',
    response: 'I map the agent system boundary and identify the affected people first.' }],
correlationId: 'grading-contract' };

const fakeJudge = (verdict = async () => ({ criticalViolationRuleIds: [], score: 85, rationale: 'Fake judge verdict.' })) =>
  ({ model: 'fake-judge', available: true, reason: null, verdict });
const service = (judge = fakeJudge()) => createGradingService({ itemGradingKey: KEY, grader: createRubricGrader({ judge }) });

async function serve(t, app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('the real grading-service reply passes the Engine check and flags the unsafe item', async (t) => {
  const url = await serve(t, service());
  const reply = await createGradeItems({ url, key: KEY })(request);
  assert.equal(reply.ok, true);
  const checked = validateGraderReply(reply.body, ['v2', 'r1'], RULES);
  assert.ok(checked, 'the reply meets the pinned graderOutputSchema');
  assert.equal(checked.grader.id, 'rubric-judge');
  assert.deepEqual(checked.results.map((r) => r.criticalViolationRuleIds), [['critical-o4'], []]);
  assert.ok(checked.results[1].score >= 80);
});

test('the Engine\'s request carries each item prompt and the pinned rule definitions the judge needs', async (t) => {
  const seen = [];
  const url = await serve(t, service(fakeJudge(async (input) => {
    seen.push(input);
    return { criticalViolationRuleIds: [], score: 85, rationale: 'Fake judge verdict.' };
  })));
  const item = { id: 'r1', kind: 'text', tier: 'recall', prompt: 'State the objective in your own words.', objectiveIds: ['o1'] };
  const attempt = { form: { rubric: { id: pkg.rubric.id, version: pkg.rubric.version }, items: [item] },
    responses: [{ itemId: 'r1', response: 'I map who the agent affects before I claim it is safe.' }] };
  const built = gradingRequest(attempt, pkg);
  assert.deepEqual(built.rubric.criticalViolationRules, pkg.rubric.criticalViolationRules.map(({ id, violation }) => ({ id, violation })));
  const reply = await createGradeItems({ url, key: KEY })(built);
  assert.equal(reply.ok, true);
  assert.equal(seen[0].prompt, item.prompt);
  assert.deepEqual(seen[0].rules.map((rule) => rule.id), pkg.rubric.criticalViolationRuleIds);
});

test('the grading-call timeout covers a full form judged at the judge\'s concurrency and per-call timeout', () => {
  const rounds = Math.ceil(MAX_ITEMS / JUDGE_CONCURRENCY);
  assert.ok(TIMEOUT_MS > rounds * JUDGE_TIMEOUT_MS, `${TIMEOUT_MS} ms must exceed ${rounds} rounds of ${JUDGE_TIMEOUT_MS} ms`);
});

test('a judge that cannot give a verdict is a retryable DependencyError, never a score', async (t) => {
  const url = await serve(t, service(fakeJudge(async () => { throw Object.assign(new Error('judge_failed'), { code: 'judge_failed' }); })));
  await assert.rejects(createGradeItems({ url, key: KEY })(request), DependencyError);
});

test('a wrong key is a refusal, not a retryable outage', async (t) => {
  const url = await serve(t, service());
  assert.deepEqual(await createGradeItems({ url, key: 'other-key' })(request), { ok: false, status: 403 });
});

test('a 5xx or an unreachable grader is a retryable DependencyError', async (t) => {
  const url = await serve(t, (req, res) => { res.statusCode = 503; res.end('{}'); });
  await assert.rejects(createGradeItems({ url, key: KEY })(request), DependencyError);
  await assert.rejects(createGradeItems({ url: 'http://127.0.0.1:9', key: KEY, timeoutMs: 500 })(request), DependencyError);
});

test('without a URL and key there is no grader, so grading stays off', () => {
  assert.equal(createGradeItems({ url: '', key: KEY }), null);
  assert.equal(createGradeItems({ url: 'http://grading-service:4020', key: '' }), null);
});
