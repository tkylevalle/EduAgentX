'use strict';
const { collectReleaseInput, readFingerprint } = require('./collect');
const { evaluateRelease } = require('./release-gate');
const { scanTrackedFiles } = require('./secret-scan');

/**
 * Collects the repository state, scans it and evaluates the final release gate.
 * @param {string} root repository root
 * @returns {{ status: 'PASS'|'BLOCKED', fingerprint: string, blockers: string[], waivers: string[],
 *   scannedFiles: number, recordsRead: number }}
 */
function runReleaseGate(root) {
  const { trackedFiles, ...input } = collectReleaseInput(root);
  return {
    ...evaluateRelease({ ...input, scanFindings: scanTrackedFiles(trackedFiles) }),
    scannedFiles: trackedFiles.length,
    recordsRead: input.records.length,
  };
}

module.exports = { runReleaseGate, readFingerprint };
