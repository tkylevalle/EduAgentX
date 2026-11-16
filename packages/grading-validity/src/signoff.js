'use strict';
// A two-person sign-off on one grader version (dataset/signoff.json). The
// measured route needs two people to label 100 or more responses; a team that
// cannot do that yet can record that two named reviewers looked at the grader
// and its report and approved it. The sign-off may accept only the missing
// labels and the probe failures it names, and the report says the status rests
// on a sign-off, not on measured agreement. It never waives a measured failure:
// a safety false pass, stale dataset entries, or human labels below the floor.
// A new grader version needs a new sign-off.

const fs = require('node:fs');
const path = require('node:path');

const SIGNOFF_FILE = path.join(__dirname, '..', 'dataset', 'signoff.json');
const SCHEMA_VERSION = 'grading-validity-signoff/1.0.0';
const MIN_REVIEWERS = 2;
// The reasons a sign-off may accept: the missing labels, and a failed must-pass
// probe (the exam is too harsh on an agent that should pass). A failed must-fail
// probe means the grader passed what it must not, and no sign-off accepts that.
const acceptable = (reason, probes) => reason === 'human_labels_insufficient' ||
  (reason.startsWith('probe_failed:') && probes.some((probe) => `probe_failed:${probe.id}` === reason && probe.expect === 'pass'));

/** @returns {object | null} the recorded sign-off, or null when there is none */
function loadSignOff(file = SIGNOFF_FILE) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

/** @param {object | null} record @param {{ id: string, version: string }} grader @returns {boolean} whether it signs off this grader */
function validSignOff(record, grader) {
  if (!record || record.schemaVersion !== SCHEMA_VERSION || record.grader?.id !== grader?.id ||
    record.grader?.version !== grader?.version || typeof record.basis !== 'string' || !record.basis.trim() ||
    !/^\d{4}-\d{2}-\d{2}$/.test(String(record.signedOn)) || !Array.isArray(record.acceptedLimitations) ||
    !Array.isArray(record.reviewers)) return false;
  const approving = record.reviewers.filter((reviewer) => reviewer?.approved === true && typeof reviewer.name === 'string' && reviewer.name.trim());
  return approving.length === record.reviewers.length &&
    new Set(approving.map((reviewer) => reviewer.name.trim().toLowerCase())).size >= MIN_REVIEWERS;
}

/**
 * @param {{ status: string, reasons: string[], grader: object, probes?: { id: string, expect: string }[] }} report the measured report
 * @param {object | null} record the sign-off
 * @returns {object} the report with signOff set; Green only when every remaining reason was accepted
 */
function applySignOff(report, record) {
  if (report.status !== 'Red' || !validSignOff(record, report.grader)) return { ...report, signOff: null };
  const accepted = report.reasons.filter((reason) => acceptable(reason, report.probes || []) && record.acceptedLimitations.includes(reason));
  const remaining = report.reasons.filter((reason) => !accepted.includes(reason));
  if (remaining.length) return { ...report, reasons: remaining, signOff: null };
  return { ...report, status: 'Green', reasons: [],
    signOff: { reviewers: record.reviewers.map((reviewer) => reviewer.name), signedOn: record.signedOn, basis: record.basis,
      acceptedReasons: accepted, measuredAgreement: false,
      note: 'Green on a two-person sign-off for this grader version; agreement with labels from people is not measured.' } };
}

module.exports = { SIGNOFF_FILE, applySignOff, loadSignOff, validSignOff };
