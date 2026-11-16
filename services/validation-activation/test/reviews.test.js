'use strict';

// Package review (assurance audit C1-C3): a reviewer scores every rubric
// criterion, the score is computed from them, and two approvers who disagree
// by more than a point on a criterion block activation until a reviewer
// records how it was resolved.

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src');
const { reviewScore, unresolvedDisagreements } = require('../src/reviews');
const candidate = require('../../curriculum-engine/examples/customer-refunds-candidate');

const KEY = 'review-test-key';
const version = candidate.manifest.version;
const { rubric } = candidate;
const scores = (value, overrides = {}) => ({ ...Object.fromEntries(rubric.criteria.map((criterion) => [criterion.id, value])), ...overrides });

test('the review score is the rubric-weighted mean of the criterion scores, and every criterion must be scored', () => {
  assert.deepEqual(reviewScore(rubric, scores(4)), { score: 4 });
  // factual_accuracy weighs 35 of 100: dropping it from 4 to 2 lowers the score by 0.7.
  assert.deepEqual(reviewScore(rubric, scores(4, { factual_accuracy: 2 })), { score: 3.3 });
  assert.deepEqual(reviewScore(rubric, { factual_accuracy: 5 }), { error: 'criterion_scores_must_cover_the_rubric' });
  assert.deepEqual(reviewScore(rubric, scores(4, { extra: 5 })), { error: 'criterion_scores_must_cover_the_rubric' });
  assert.deepEqual(reviewScore(rubric, scores(6)), { error: 'invalid_score' });
});

test('approvers more than one point apart on a criterion disagree until a resolution is recorded', () => {
  const approvals = [{ reviewer_id: 'a', approved: true, criterionScores: scores(4) },
    { reviewer_id: 'b', approved: true, criterionScores: scores(4, { safety: 2.5 }) }];
  assert.deepEqual(unresolvedDisagreements(approvals, rubric), [{ criterionId: 'safety', scores: { a: 4, b: 2.5 } }]);
  assert.deepEqual(unresolvedDisagreements(approvals, rubric, [{ criterionId: 'safety' }]), []);
  assert.deepEqual(unresolvedDisagreements([approvals[0], { ...approvals[1], criterionScores: scores(3) }], rubric), [], 'one point apart agrees');
});

test('activation waits for two approvals and for every disagreement to be resolved by a reviewer of that version', async (t) => {
  const server = createApp({ internalKey: KEY }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const post = async (path, body, actor, role) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'x-internal-service-key': KEY, 'x-actor-subject': actor, 'x-actor-role': role } });
    return { status: response.status, body: await response.json() };
  };
  const id = 'customer-refunds';
  assert.equal((await post('/packages', candidate, 'author', 'admin')).status, 201);
  assert.equal((await post('/validate', { package_id: id, version }, 'author', 'admin')).status, 200);
  const review = (actor, criterionScores) => post('/review', { package_id: id, version, criterionScores, approved: true,
    comment: 'Checked every quote against its article.' }, actor, 'reviewer');
  assert.equal((await post('/review', { package_id: id, version, score: 5, approved: true }, 'reviewer-a', 'reviewer')).status, 422,
    'a bare score is not a review');
  assert.equal((await review('reviewer-a', scores(4.5))).body.score, 4.5);
  const second = await review('reviewer-b', scores(4.5, { safety: 3 }));
  assert.deepEqual([second.body.ready_to_activate, second.body.disagreements.map((item) => item.criterionId)], [false, ['safety']]);
  const blocked = await post('/activate', { package_id: id, version }, 'author', 'admin');
  assert.deepEqual([blocked.status, blocked.body.error], [409, 'unresolved_review_disagreement']);
  const resolve = (actor, criterionId = 'safety') => post('/review/resolutions', { package_id: id, version, criterionId,
    resolution: 'Agreed the over-limit lesson needs the split-refund counter-example; it is there, so 4 stands.' }, actor, 'reviewer');
  assert.equal((await resolve('outsider')).status, 403, 'only a reviewer of this version');
  assert.equal((await resolve('reviewer-a', 'learner_clarity')).status, 409, 'no disagreement on that criterion');
  assert.equal((await resolve('reviewer-b')).status, 200);
  assert.equal((await resolve('reviewer-a')).status, 409, 'resolved once');
  assert.equal((await post('/activate', { package_id: id, version }, 'author', 'admin')).status, 200);
});
