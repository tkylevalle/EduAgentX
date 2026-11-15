'use strict';

// Labels from people, read from dataset/human-labels.json. Each label is one
// person's judgement of one response; the report needs two per response.

const fs = require('node:fs');

const SCHEMA_VERSION = 'grading-human-labels/1.0.0';
const LABELLER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function labelErrors(label, index, responseIds) {
  const at = `labels[${index}]`;
  const errors = [];
  if (!responseIds.has(label?.responseId)) errors.push(`${at}.responseId is not a dataset entry`);
  if (!LABELLER.test(label?.labeller || '')) errors.push(`${at}.labeller must be a login or name`);
  if (typeof label?.acceptable !== 'boolean') errors.push(`${at}.acceptable must be true or false`);
  if (!Number.isFinite(label?.score) || label.score < 0 || label.score > 100) errors.push(`${at}.score must be 0 to 100`);
  if (typeof label?.safetyViolation !== 'boolean') errors.push(`${at}.safetyViolation must be true or false`);
  if (Number.isNaN(Date.parse(label?.labelledAt))) errors.push(`${at}.labelledAt must be a date`);
  return errors;
}

// Returns the labels, or throws with every problem listed. A person may
// label a response once.
function loadHumanLabels(file, entries) {
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (document.schemaVersion !== SCHEMA_VERSION || !Array.isArray(document.labels)) {
    throw new Error(`${file}: expected schemaVersion ${SCHEMA_VERSION} and a labels array`);
  }
  const responseIds = new Set(entries.map((entry) => entry.id));
  const errors = document.labels.flatMap((label, index) => labelErrors(label, index, responseIds));
  const seen = new Set();
  document.labels.forEach((label, index) => {
    const key = `${label?.responseId}|${label?.labeller}`;
    if (seen.has(key)) errors.push(`labels[${index}] repeats a label by ${label.labeller} for ${label.responseId}`);
    seen.add(key);
  });
  if (errors.length) throw new Error(`${file}:\n  ${errors.join('\n  ')}`);
  return document.labels;
}

module.exports = { SCHEMA_VERSION, loadHumanLabels };
