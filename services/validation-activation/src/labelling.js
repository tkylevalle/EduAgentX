'use strict';
/**
 * The grader validation dataset as people label it: each response beside the
 * prompt of the item it answers, and nothing else. A response's id names the
 * category its author wrote it for ('a3:unsafe-explicit'), and the dataset
 * carries the author's provisional label, so neither leaves this module except
 * in the admin export: a labeller sees an opaque item key instead.
 */
const { createHmac } = require('node:crypto');

// The same rule as packages/grading-validity/src/labels.js, so every stored
// labeller can be exported and checked against the dataset's authors there.
const LABELLER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MIN_SCORE = 0;
const MAX_SCORE = 100;
// Hex characters of the HMAC kept as an item key: 128 bits, far beyond guessing.
const ITEM_KEY_HEX = 32;

/**
 * @param {{ version: string, authors?: string[], entries: { id: string, slotId: string, promptSha256: string, response: string }[] }} dataset
 * @param {{ form: { items: { slotId: string, prompt: string, promptSha256: string }[] } }} exam
 * @returns {{ version: string, authors: Set<string>, entries: { responseId: string, prompt: string, response: string }[] }}
 *   only entries whose item prompt is unchanged: a stale entry answers a prompt nobody can be shown
 */
function labellingSetFrom(dataset, exam) {
  const items = new Map(exam.form.items.map((item) => [item.slotId, item]));
  const entries = dataset.entries.filter((entry) => items.get(entry.slotId)?.promptSha256 === entry.promptSha256)
    .map((entry) => ({ responseId: entry.id, prompt: items.get(entry.slotId).prompt, response: entry.response }));
  return { version: dataset.version, authors: new Set((dataset.authors || []).map((author) => author.toLowerCase())), entries };
}

/** The committed dataset and the reference exam, both read-only. */
function loadLabellingSet() {
  const dataset = require('../../../packages/grading-validity/dataset/responses.v1.json');
  const { referenceExam } = require('../../../packages/grading-validity/src/exam');
  return labellingSetFrom(dataset, referenceExam());
}

/**
 * Opaque, stable-per-process keys for a set's entries, in key order, which
 * mixes the categories the dataset lists in sequence.
 * @param {{ version: string, entries: { responseId: string }[] }} set
 * @param {Buffer} secret
 */
function keyedEntries(set, secret) {
  const keyOf = (responseId) => createHmac('sha256', secret).update(`${set.version}\n${responseId}`).digest('hex').slice(0, ITEM_KEY_HEX);
  const keyed = set.entries.map((entry) => ({ ...entry, itemKey: keyOf(entry.responseId) }))
    .sort((a, b) => a.itemKey.localeCompare(b.itemKey));
  return { list: keyed, byKey: new Map(keyed.map((entry) => [entry.itemKey, entry])) };
}

/** @param {unknown} body @returns {string[]} the fields that are missing or wrong */
function labelInputErrors(body) {
  const errors = [];
  if (typeof body?.itemKey !== 'string') errors.push('itemKey');
  if (typeof body?.acceptable !== 'boolean') errors.push('acceptable');
  if (!Number.isInteger(body?.score) || body.score < MIN_SCORE || body.score > MAX_SCORE) errors.push('score');
  if (typeof body?.safetyViolation !== 'boolean') errors.push('safetyViolation');
  return errors;
}

module.exports = { LABELLER_PATTERN, labellingSetFrom, loadLabellingSet, keyedEntries, labelInputErrors };
