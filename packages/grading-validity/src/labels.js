'use strict';

// Labels from people, read from dataset/human-labels.json. Each label is one
// person's independent judgement of one response; labels are never edited
// to settle a disagreement (see report.js for how disagreement is reported).

const fs = require('node:fs');

const SCHEMA_VERSION = 'grading-human-labels/1.0.0';
// A GitHub login or short name: letters, digits, '.', '_' or '-', up to 64
// characters, so it can be checked against the dataset's author list.
const LABELLER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function labelErrors(label, index, responseIds, authors) {
  const at = `labels[${index}]`;
  const errors = [];
  if (!responseIds.has(label?.responseId)) errors.push(`${at}.responseId is not a dataset entry`);
  if (!LABELLER_PATTERN.test(label?.labeller || '')) errors.push(`${at}.labeller must be a login or name`);
  else if (authors.has(label.labeller.toLowerCase())) errors.push(`${at}.labeller ${label.labeller} wrote the dataset and cannot label it`);
  if (typeof label?.acceptable !== 'boolean') errors.push(`${at}.acceptable must be true or false`);
  if (!Number.isFinite(label?.score) || label.score < 0 || label.score > 100) errors.push(`${at}.score must be 0 to 100`);
  if (typeof label?.safetyViolation !== 'boolean') errors.push(`${at}.safetyViolation must be true or false`);
  if (Number.isNaN(Date.parse(label?.labelledAt))) errors.push(`${at}.labelledAt must be a date`);
  return errors;
}

/**
 * Reads and checks the labels. A person may label a response once, and the
 * dataset's authors may not label it.
 * @param {string} file
 * @param {{ entries: { id: string }[], authors?: string[] }} dataset
 * @returns {{ responseId: string, labeller: string, acceptable: boolean, score: number, safetyViolation: boolean, labelledAt: string }[]}
 * @throws {Error} listing every problem found
 */
function loadHumanLabels(file, dataset) {
  const document = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (document.schemaVersion !== SCHEMA_VERSION || !Array.isArray(document.labels)) {
    throw new Error(`${file}: expected schemaVersion ${SCHEMA_VERSION} and a labels array`);
  }
  const responseIds = new Set(dataset.entries.map((entry) => entry.id));
  const authors = new Set((dataset.authors || []).map((author) => author.toLowerCase()));
  const errors = document.labels.flatMap((label, index) => labelErrors(label, index, responseIds, authors));
  const seen = new Set();
  document.labels.forEach((label, index) => {
    const key = `${label?.responseId}|${String(label?.labeller).toLowerCase()}`;
    if (seen.has(key)) errors.push(`labels[${index}] repeats a label by ${label.labeller} for ${label.responseId}`);
    seen.add(key);
  });
  if (errors.length) throw new Error(`${file}:\n  ${errors.join('\n  ')}`);
  return document.labels;
}

module.exports = { loadHumanLabels };
