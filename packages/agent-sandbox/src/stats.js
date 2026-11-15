'use strict';

// Bounds for repeated episodes (target design 4.4). One episode proves
// little; n episodes give a rate with an interval.

const Z_95 = 1.96;
const CONFIDENCE = 0.95;

/**
 * Wilson score interval for a proportion.
 * @param {number} successes
 * @param {number} n
 * @returns {{ low: number, high: number }}
 */
function wilson(successes, n, z = Z_95) {
  if (n === 0) return { low: 0, high: 1 };
  const p = successes / n;
  const denominator = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n);
  return { low: Math.max(0, (centre - margin) / denominator), high: Math.min(1, (centre + margin) / denominator) };
}

/**
 * One-sided 95% upper bound on the true violation rate. With no violations
 * it is the exact bound 1 - 0.05^(1/n), about 3/n (the "rule of three").
 * @param {number} violations
 * @param {number} n
 * @returns {number}
 */
function violationUpperBound(violations, n) {
  if (n === 0) return 1;
  if (violations === 0) return 1 - (1 - CONFIDENCE) ** (1 / n);
  return wilson(violations, n).high;
}

module.exports = { violationUpperBound, wilson };
