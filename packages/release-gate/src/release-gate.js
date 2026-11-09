'use strict';
// Final release gate (docs/blueprint/issues/09-define-sprint-exit-gates.md, "Final release gate").
// Fails closed: anything missing, stale or unreadable is a blocker.
const { CURRENT_RECORD_CHECKS, isFilled, isNonEmptyList } = require('./record-checks');
const { LIMITATIONS_FILE } = require('./paths');

const SPRINTS = [1, 2, 3, 4, 5];
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const REQUIRED_LIMITATION_SECTIONS = [
  'Known limitations', 'Supporting-scope reductions', 'Residual risks',
  'Non-accreditation positioning', 'Optional live cost', 'Ownership history',
];

const timeOf = (value) => (isFilled(value) ? Date.parse(value) : Number.NaN);
const recordsOfType = (records, type) => records.filter((record) => record.type === type);
const countProblem = (count) => (count === 0 ? 'no record' : `${count} records found, expected exactly 1`);

function sprintProblems(record, { fileExists, history }) {
  const problems = [];
  if (!isFilled(record.evidencePack) || !fileExists(record.evidencePack)) {
    problems.push(`evidence pack ${record.evidencePack ?? '(none)'} not found`);
  }
  if (!COMMIT_SHA_PATTERN.test(record.sourceCommit ?? '') || !history.commitExists(record.sourceCommit)) {
    problems.push('source commit not found in git history');
  }
  if (Number.isNaN(timeOf(record.passedAt))) problems.push('passedAt is not a date');
  if (!isNonEmptyList(record.approvedBy)) problems.push('approvedBy is empty');
  if (!Array.isArray(record.waivers)) problems.push('waivers must be a list, empty when none');
  return problems;
}

// "In sequence": each pass is later in time and in git history than the one before it.
function sequenceProblems(record, previous, history) {
  if (!previous) return [];
  const problems = [];
  if (!(timeOf(record.passedAt) > timeOf(previous.passedAt))) problems.push(`passed before sprint ${previous.sprint}`);
  const commitsKnown = [record, previous].every((pass) => COMMIT_SHA_PATTERN.test(pass.sourceCommit ?? '')
    && history.commitExists(pass.sourceCommit));
  if (commitsKnown && !history.isAncestor(previous.sourceCommit, record.sourceCommit)) {
    problems.push(`source commit does not follow sprint ${previous.sprint}`);
  }
  return problems;
}

function sprintResults(records, context) {
  const initial = { blockers: [], waivers: [], previous: null };
  const { blockers, waivers } = SPRINTS.reduce((state, sprint) => {
    const found = recordsOfType(records, 'sprint-pass').filter((record) => record.sprint === sprint);
    if (found.length !== 1) {
      const problem = found.length === 0 ? 'no pass record' : `${found.length} pass records found`;
      return { ...state, blockers: [...state.blockers, `sprint ${sprint}: ${problem}`], previous: null };
    }
    const [record] = found;
    const problems = [...sprintProblems(record, context), ...sequenceProblems(record, state.previous, context.history)];
    const recordWaivers = Array.isArray(record.waivers) ? record.waivers : [];
    return {
      blockers: [...state.blockers, ...problems.map((problem) => `sprint ${sprint}: ${problem}`)],
      waivers: [...state.waivers, ...recordWaivers.map((waiver) => `sprint ${sprint}: ${waiver}`)],
      previous: record,
    };
  }, initial);
  return { blockers, waivers };
}

function currentRecordBlockers(records, fingerprint) {
  return Object.entries(CURRENT_RECORD_CHECKS).flatMap(([type, check]) => {
    const found = recordsOfType(records, type);
    if (found.length !== 1) return [`${type}: ${countProblem(found.length)}`];
    const [record] = found;
    if (record.sourceFingerprint !== fingerprint) return [`${type}: recorded for a different source version`];
    const missing = ['recordedBy', 'recordedAt', 'evidenceReference'].filter((field) => !isFilled(record[field]));
    return [...missing.map((field) => `${field} missing`), ...check(record)].map((problem) => `${type}: ${problem}`);
  });
}

function limitationBlockers(limitations) {
  if (typeof limitations !== 'string') return [`limitations: ${LIMITATIONS_FILE} not found`];
  const headings = new Set(limitations.split(/\r?\n/)
    .map((line) => line.match(/^#{1,6}\s+(.+?)\s*$/)?.[1].toLowerCase()).filter(Boolean));
  return REQUIRED_LIMITATION_SECTIONS
    .filter((section) => !headings.has(section.toLowerCase()))
    .map((section) => `limitations: missing section "${section}"`);
}

/**
 * @typedef {{ commitExists: (sha: string) => boolean, isAncestor: (older: string, newer: string) => boolean }} History
 * @typedef {{ fingerprint: string, isWorkingTreeClean: boolean, recordErrors: string[],
 *   scanFindings: import('./secret-scan').Finding[], records: object[], limitations: string|null,
 *   fileExists: (path: string) => boolean, history: History }} ReleaseInput
 */

/**
 * @param {ReleaseInput} input
 * @returns {{ status: 'PASS'|'BLOCKED', fingerprint: string, blockers: string[], waivers: string[] }}
 */
function evaluateRelease(input) {
  const records = Array.isArray(input.records) ? input.records : [];
  const sprints = sprintResults(records, input);
  const blockers = [
    ...(input.isWorkingTreeClean === true ? [] : ['source: working tree has uncommitted changes']),
    ...(input.recordErrors || []).map((error) => `records: ${error}`),
    ...(input.scanFindings || []).map(({ path, line, rule }) => `secret scan: ${path}${line ? `:${line}` : ''} ${rule}`),
    ...sprints.blockers,
    ...currentRecordBlockers(records, input.fingerprint),
    ...limitationBlockers(input.limitations),
  ];
  return {
    status: blockers.length === 0 ? 'PASS' : 'BLOCKED',
    fingerprint: input.fingerprint,
    blockers,
    waivers: sprints.waivers,
  };
}

module.exports = { evaluateRelease, REQUIRED_LIMITATION_SECTIONS };
