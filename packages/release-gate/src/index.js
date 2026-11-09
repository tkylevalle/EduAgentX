'use strict';
const { collectReleaseInput } = require('./collect');
const { evaluateRelease, REQUIRED_LIMITATION_SECTIONS } = require('./release-gate');
const { scanTrackedFiles } = require('./secret-scan');
const { sourceFingerprint } = require('./fingerprint');

/**
 * Collects the repository state, scans it and evaluates the final release gate.
 * @param {string} root repository root
 */
function runReleaseGate(root) {
  const { trackedFiles, ...input } = collectReleaseInput(root);
  const scanFindings = scanTrackedFiles(trackedFiles);
  return {
    ...evaluateRelease({ ...input, scanFindings }),
    scannedFiles: trackedFiles.length,
    recordsRead: input.records.length,
  };
}

module.exports = { runReleaseGate, evaluateRelease, scanTrackedFiles, sourceFingerprint, REQUIRED_LIMITATION_SECTIONS };
