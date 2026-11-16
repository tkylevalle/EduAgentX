'use strict';

// Package review policy (target design 3.2 step 5; assurance audit C1-C3).
// A reviewer scores every rubric criterion from 0 to 5; the review's score is
// the rubric-weighted mean, so it cannot be typed in. A reviewer also confirms,
// for every source a claim cites, its edition, its licence and that the quotes
// are in it (C2); an approval needs all three for every cited source. Two
// approving reviewers who differ by more than one point on a criterion
// disagree, and the package cannot be activated until one of them records how
// that was resolved.

const { RUBRIC_POLICY } = require('../../curriculum-engine/model');

const MAX_COMMENT_CHARS = 2000;
const MAX_RESOLUTION_CHARS = 2000;
// The rubric's own floor and target (validation gate rubric_policy): a package
// needs an approval mean of at least the floor; the target is reported.
const REVIEW_FLOOR = RUBRIC_POLICY.scoreFloor;
const REVIEW_TARGET = RUBRIC_POLICY.scoreTarget;
// Two people outside the authoring role (target design 3.1, review record).
const REQUIRED_APPROVALS = 2;
// One point on the 0-5 scale is the difference between adjacent rubric anchors;
// more than that is a different judgement, not rounding.
const DISAGREEMENT_SPREAD = 1;
const SCALE = RUBRIC_POLICY.scoreScale;
const SOURCE_CHECKS = Object.freeze(['edition', 'licence', 'quotes']);

/** @param {object} pkg @returns {string[]} the sources some claim quotes, sorted */
const citedSources = (pkg) => [...new Set((pkg?.modules || []).flatMap((module) => (module.claims || []).map((claim) => claim.sourceId)))].sort();

/**
 * @param {{ criteria: { id: string, weight: number }[] }} rubric
 * @param {unknown} criterionScores  { criterionId: score }
 * @returns {{ score: number } | { error: string }} the weighted score, or why the scores are invalid
 */
function reviewScore(rubric, criterionScores) {
  const criteria = rubric?.criteria || [];
  if (!criterionScores || typeof criterionScores !== 'object' || Array.isArray(criterionScores) ||
    Object.keys(criterionScores).length !== criteria.length || criteria.some((criterion) => !Object.hasOwn(criterionScores, criterion.id)))
    return { error: 'criterion_scores_must_cover_the_rubric' };
  if (criteria.some((criterion) => !Number.isFinite(criterionScores[criterion.id]) ||
    criterionScores[criterion.id] < SCALE.min || criterionScores[criterion.id] > SCALE.max)) return { error: 'invalid_score' };
  const weight = criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  const score = criteria.reduce((sum, criterion) => sum + criterion.weight * criterionScores[criterion.id], 0) / weight;
  return { score: Math.round(score * 100) / 100 };
}

/**
 * @param {object} pkg @param {unknown} sourceChecks  { sourceId: { edition, licence, quotes } } for every cited source
 * @param {boolean} approved
 * @returns {string | null} why the checks are invalid, or null
 */
function sourceChecksError(pkg, sourceChecks, approved) {
  const cited = citedSources(pkg);
  if (!sourceChecks || typeof sourceChecks !== 'object' || Array.isArray(sourceChecks) ||
    Object.keys(sourceChecks).sort().join() !== cited.join() ||
    cited.some((id) => Object.keys(sourceChecks[id] || {}).sort().join() !== [...SOURCE_CHECKS].sort().join() ||
      SOURCE_CHECKS.some((check) => typeof sourceChecks[id][check] !== 'boolean'))) return 'source_checks_must_cover_every_cited_source';
  if (approved && cited.some((id) => SOURCE_CHECKS.some((check) => !sourceChecks[id][check]))) return 'approval_requires_confirmed_sources';
  return null;
}

/** @returns {object[]} the reviews that count as approvals of this exact digest */
const approvalsOf = (reviews, digest) => reviews.filter((review) => review.approved && review.score >= REVIEW_FLOOR && review.digest === digest);

/**
 * @param {{ reviewer_id: string, criterionScores?: object }[]} approvals  from approvalsOf
 * @param {{ criteria: { id: string }[] }} rubric
 * @param {{ criterionId: string }[]} resolutions
 * @returns {{ criterionId: string, scores: Record<string, number> }[]} the criteria the approvers disagree on, without a recorded resolution
 */
function unresolvedDisagreements(approvals, rubric, resolutions = []) {
  return (rubric?.criteria || []).flatMap((criterion) => {
    const scores = Object.fromEntries(approvals.filter((review) => Number.isFinite(review.criterionScores?.[criterion.id]))
      .map((review) => [review.reviewer_id, review.criterionScores[criterion.id]]));
    const values = Object.values(scores);
    const disagree = values.length >= 2 && Math.max(...values) - Math.min(...values) > DISAGREEMENT_SPREAD;
    return disagree && !resolutions.some((resolution) => resolution.criterionId === criterion.id) ? [{ criterionId: criterion.id, scores }] : [];
  });
}

/** @returns {object} the review state of one package version: what activation needs and what is still missing */
function reviewState(pkg, reviews, resolutions) {
  const approvals = approvalsOf(reviews, pkg.digest);
  const reviewers = new Set(approvals.map((review) => review.reviewer_id));
  const mean = approvals.length ? Math.round(approvals.reduce((sum, review) => sum + review.score, 0) / approvals.length * 100) / 100 : null;
  const disagreements = unresolvedDisagreements(approvals, pkg.rubric, resolutions);
  return { approvals: reviewers.size, required: REQUIRED_APPROVALS, mean, floor: REVIEW_FLOOR, targetMet: mean !== null && mean >= REVIEW_TARGET,
    disagreements, ready: reviewers.size >= REQUIRED_APPROVALS && mean >= REVIEW_FLOOR && disagreements.length === 0 };
}

const REVIEW_POLICY = Object.freeze({ floor: REVIEW_FLOOR, target: REVIEW_TARGET, requiredApprovals: REQUIRED_APPROVALS,
  disagreementSpread: DISAGREEMENT_SPREAD, maxCommentChars: MAX_COMMENT_CHARS, maxResolutionChars: MAX_RESOLUTION_CHARS, sourceChecks: SOURCE_CHECKS });

module.exports = { MAX_COMMENT_CHARS, MAX_RESOLUTION_CHARS, REQUIRED_APPROVALS, REVIEW_FLOOR, REVIEW_POLICY, approvalsOf, citedSources,
  reviewScore, reviewState, sourceChecksError, unresolvedDisagreements };
