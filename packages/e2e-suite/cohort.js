'use strict';
// Supplemental passing learners are NOT part of the frozen 1000-profile matrix.
const { manifest } = require('./manifest');
const { learnerId, digest } = require('./identity');
const scenarios = Array.from({ length: 1000 }, (_, index) => {
  const id = `golden-cohort-v2-${String(index + 1).padStart(4, '0')}`;
  return Object.freeze({ ...manifest.scenarios[0], id, learnerId: learnerId(id), clientId: learnerId(id) });
});
module.exports = { scenarios: Object.freeze(scenarios), hash: digest(scenarios) };
