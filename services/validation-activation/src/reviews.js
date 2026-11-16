'use strict';

// Package review policy (target design 3.2 step 5; assurance audit C1-C3).
// A reviewer scores every rubric criterion from 0 to 5; the review's score is
// the rubric-weighted mean, so it cannot be typed in. Two approving reviewers
// who differ by more than one point on a criterion disagree, and the package
// cannot be activated until a person records how that was resolved.

const MAX_COMMENT_CHARS = 2000;
const MAX_RESOLUTION_CHARS = 2000;
// One point on the 0-5 scale is the difference between adjacent rubric anchors;
// more than that is a different judgement, not rounding.
const DISAGREEMENT_SPREAD = 1;
const SCALE = Object.freeze({ min: 0, max: 5 });

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
 * @param {{ reviewer_id: string, approved: boolean, criterionScores?: object }[]} approvals
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

module.exports = { DISAGREEMENT_SPREAD, MAX_COMMENT_CHARS, MAX_RESOLUTION_CHARS, reviewScore, unresolvedDisagreements };
