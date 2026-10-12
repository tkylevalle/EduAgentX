'use strict';
/**
 * Validates that the grading input conforms to the locked rubric schema.
 * Returns array of error strings — empty means valid.
 */
function validateGradingInput(input) {
  const errors = [];
  if (!input || typeof input !== 'object') return ['input must be a non-null object'];

  // Required top-level fields
  for (const f of ['attemptId', 'packageId', 'packageDigest', 'subject', 'mode', 'submittedAt', 'answers']) {
    if (!input[f]) errors.push(`missing required field: ${f}`);
  }

  if (!Array.isArray(input.answers) || input.answers.length === 0)
    errors.push('answers must be a non-empty array');

  if (input.answers) {
    input.answers.forEach((a, i) => {
      if (!a.questionId) errors.push(`answers[${i}]: missing questionId`);
      if (!a.tier || !['standard', 'adversarial'].includes(a.tier))
        errors.push(`answers[${i}]: tier must be 'standard' or 'adversarial'`);
      if (typeof a.response !== 'string' || a.response.trim() === '')
        errors.push(`answers[${i}]: response must be a non-empty string`);
      if (typeof a.expectedAnswer !== 'string' || a.expectedAnswer.trim() === '')
        errors.push(`answers[${i}]: expectedAnswer must be a non-empty string`);
      if (!Array.isArray(a.applicableCriticalRules))
        errors.push(`answers[${i}]: applicableCriticalRules must be an array`);
    });
  }

  return errors;
}

module.exports = { validateGradingInput };
