'use strict';
// Final release gate (docs/blueprint/issues/09-define-sprint-exit-gates.md, "Final release gate").
// Fails closed: anything missing, stale or unreadable is a blocker.
const { CURRENT_RECORD_CHECKS, filled, filledList } = require('./record-checks');

const SPRINTS = [1, 2, 3, 4, 5];
const COMMIT = /^[0-9a-f]{40}$/;
const REQUIRED_LIMITATION_SECTIONS = [
  'Known limitations', 'Supporting-scope reductions', 'Residual risks',
  'Non-accreditation positioning', 'Optional live cost', 'Ownership history',
];

const timeOf = (value) => (filled(value) ? Date.parse(value) : Number.NaN);

function sprintProblems(record, fileExists) {
  const problems = [];
  if (!filled(record.evidencePack) || !fileExists(record.evidencePack)) {
    problems.push(`evidence pack ${record.evidencePack ?? '(none)'} not found`);
  }
  if (!COMMIT.test(record.sourceCommit ?? '')) problems.push('source commit missing');
  if (Number.isNaN(timeOf(record.passedAt))) problems.push('passedAt is not a date');
  if (!filledList(record.approvedBy)) problems.push('approvedBy is empty');
  return problems;
}

function sprintBlockers(records, fileExists) {
  let previous = null;
  return SPRINTS.flatMap((sprint) => {
    const found = records.filter((record) => record.type === 'sprint-pass' && record.sprint === sprint);
    if (found.length !== 1) {
      previous = null;
      return [`sprint ${sprint}: ${found.length === 0 ? 'no pass record' : `${found.length} pass records found`}`];
    }
    const [record] = found;
    const problems = sprintProblems(record, fileExists);
    const passedAt = timeOf(record.passedAt);
    if (previous !== null && passedAt <= previous) problems.push(`passed before sprint ${sprint - 1}`);
    previous = Number.isNaN(passedAt) ? null : passedAt;
    return problems.map((problem) => `sprint ${sprint}: ${problem}`);
  });
}

function currentRecordProblems(record, fingerprint, check) {
  if (record.sourceFingerprint !== fingerprint) return ['recorded for a different source version'];
  const missing = ['recordedBy', 'recordedAt', 'evidenceReference'].filter((field) => !filled(record[field]));
  return [...missing.map((field) => `${field} missing`), ...check(record)];
}

function currentRecordBlockers(records, fingerprint) {
  return Object.entries(CURRENT_RECORD_CHECKS).flatMap(([type, check]) => {
    const found = records.filter((record) => record.type === type);
    if (found.length === 0) return [`${type}: no record`];
    if (found.length > 1) return [`${type}: ${found.length} records found, expected exactly 1`];
    return currentRecordProblems(found[0], fingerprint, check).map((problem) => `${type}: ${problem}`);
  });
}

function limitationBlockers(limitations) {
  if (typeof limitations !== 'string') return ['limitations: docs/release/limitations.md not found'];
  const headings = new Set(limitations.split(/\r?\n/)
    .map((line) => line.match(/^#{1,6}\s+(.+?)\s*$/)?.[1].toLowerCase()).filter(Boolean));
  return REQUIRED_LIMITATION_SECTIONS
    .filter((section) => !headings.has(section.toLowerCase()))
    .map((section) => `limitations: missing section "${section}"`);
}

/**
 * @param {{ fingerprint: string, workingTreeClean: boolean, recordErrors: string[],
 *   scanFindings: { path: string, line: number|null, rule: string }[], records: object[],
 *   limitations: string|null, fileExists: (path: string) => boolean }} input
 * @returns {{ status: 'PASS'|'BLOCKED', fingerprint: string, blockers: string[] }}
 */
function evaluateRelease(input) {
  const records = Array.isArray(input.records) ? input.records : [];
  const blockers = [
    ...(input.workingTreeClean === true ? [] : ['source: working tree has uncommitted changes']),
    ...(input.recordErrors || []).map((error) => `records: ${error}`),
    ...(input.scanFindings || []).map(({ path, line, rule }) => `secret scan: ${path}${line ? `:${line}` : ''} ${rule}`),
    ...sprintBlockers(records, input.fileExists),
    ...currentRecordBlockers(records, input.fingerprint),
    ...limitationBlockers(input.limitations),
  ];
  return { status: blockers.length === 0 ? 'PASS' : 'BLOCKED', fingerprint: input.fingerprint, blockers };
}

module.exports = { evaluateRelease, REQUIRED_LIMITATION_SECTIONS };
