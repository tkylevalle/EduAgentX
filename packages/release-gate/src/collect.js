'use strict';
// Reads the repository state the release gate evaluates. All reads are local and read-only.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { sourceFingerprint } = require('./fingerprint');

const RECORDS_DIRECTORY = 'docs/release/records';
const LIMITATIONS_FILE = 'docs/release/limitations.md';
const MAX_SCANNED_BYTES = 2 * 1024 * 1024;

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function insideRoot(root, relative) {
  const resolved = path.resolve(root, relative);
  return resolved === root || resolved.startsWith(root + path.sep) ? resolved : null;
}

// Binary and very large files are skipped; secrets in them are out of this scan's reach.
function readTrackedFiles(root) {
  return git(root, ['ls-files', '-z']).split('\0').filter(Boolean).flatMap((relative) => {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute) || fs.statSync(absolute).size > MAX_SCANNED_BYTES) return [{ path: relative, text: '' }];
    const bytes = fs.readFileSync(absolute);
    return [{ path: relative, text: bytes.includes(0) ? '' : bytes.toString('utf8') }];
  });
}

function readRecords(root) {
  const directory = path.join(root, RECORDS_DIRECTORY);
  if (!fs.existsSync(directory)) return { records: [], recordErrors: [] };
  const records = [];
  const recordErrors = [];
  for (const name of fs.readdirSync(directory).filter((file) => file.endsWith('.json')).sort()) {
    try {
      const record = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
      if (record === null || typeof record !== 'object' || Array.isArray(record)) throw new Error('not an object');
      records.push(record);
    } catch (error) {
      recordErrors.push(`${name}: ${error instanceof SyntaxError ? 'invalid JSON' : error.message}`);
    }
  }
  return { records, recordErrors };
}

/**
 * @param {string} root repository root
 * @returns {object} input for evaluateRelease, plus scan counts
 */
function collectReleaseInput(root) {
  const limitationsPath = path.join(root, LIMITATIONS_FILE);
  return {
    fingerprint: sourceFingerprint(git(root, ['ls-files', '-s'])),
    workingTreeClean: git(root, ['status', '--porcelain']).trim() === '',
    trackedFiles: readTrackedFiles(root),
    limitations: fs.existsSync(limitationsPath) ? fs.readFileSync(limitationsPath, 'utf8') : null,
    fileExists: (relative) => {
      const resolved = insideRoot(root, relative);
      return resolved !== null && fs.existsSync(resolved);
    },
    ...readRecords(root),
  };
}

module.exports = { collectReleaseInput, RECORDS_DIRECTORY, LIMITATIONS_FILE };
