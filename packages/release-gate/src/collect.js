'use strict';
// Reads the repository state the release gate evaluates. All reads are local and read-only.
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { sourceFingerprint } = require('./fingerprint');
const { RECORDS_DIRECTORY, LIMITATIONS_FILE } = require('./paths');

const MAX_SCANNED_BYTES = 2 * 1024 * 1024;
const GIT_OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: GIT_OUTPUT_LIMIT_BYTES });
const gitSucceeds = (root, args) => spawnSync('git', args, { cwd: root, stdio: 'ignore' }).status === 0;

function insideRoot(root, relative) {
  const resolved = path.resolve(root, relative);
  return resolved === root || resolved.startsWith(root + path.sep) ? resolved : null;
}

// Binary files are read as empty text. A file too large to read is reported by the scan.
function readTrackedFile(root, relative) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return { path: relative, text: '' };
  if (fs.statSync(absolute).size > MAX_SCANNED_BYTES) return { path: relative, text: '', isTooLarge: true };
  const bytes = fs.readFileSync(absolute);
  return { path: relative, text: bytes.includes(0) ? '' : bytes.toString('utf8') };
}

function parseRecord(text) {
  const record = JSON.parse(text);
  if (record === null || typeof record !== 'object' || Array.isArray(record)) throw new TypeError('not an object');
  return record;
}

function readRecords(root) {
  const directory = path.join(root, RECORDS_DIRECTORY);
  if (!fs.existsSync(directory)) return { records: [], recordErrors: [] };
  const names = fs.readdirSync(directory).filter((file) => file.endsWith('.json')).sort();
  return names.reduce((result, name) => {
    try {
      return { ...result, records: [...result.records, parseRecord(fs.readFileSync(path.join(directory, name), 'utf8'))] };
    } catch (error) {
      const reason = error instanceof SyntaxError ? 'invalid JSON' : error.message;
      return { ...result, recordErrors: [...result.recordErrors, `${name}: ${reason}`] };
    }
  }, { records: [], recordErrors: [] });
}

function readHistory(root) {
  return {
    commitExists: (sha) => gitSucceeds(root, ['cat-file', '-e', `${sha}^{commit}`]),
    isAncestor: (older, newer) => gitSucceeds(root, ['merge-base', '--is-ancestor', older, newer]),
  };
}

/** @param {string} root repository root @returns {string} SHA-256 source fingerprint */
function readFingerprint(root) {
  return sourceFingerprint(git(path.resolve(root), ['ls-files', '-s']));
}

/**
 * @param {string} repositoryRoot repository root, in any path style git reports
 * @returns {import('./release-gate').ReleaseInput & { trackedFiles: import('./secret-scan').TrackedFile[] }}
 */
function collectReleaseInput(repositoryRoot) {
  // git reports C:/... on Windows; path.resolve gives the native form that insideRoot compares against.
  const root = path.resolve(repositoryRoot);
  const limitationsPath = path.join(root, LIMITATIONS_FILE);
  return {
    fingerprint: readFingerprint(root),
    isWorkingTreeClean: git(root, ['status', '--porcelain']).trim() === '',
    trackedFiles: git(root, ['ls-files', '-z']).split('\0').filter(Boolean).map((relative) => readTrackedFile(root, relative)),
    limitations: fs.existsSync(limitationsPath) ? fs.readFileSync(limitationsPath, 'utf8') : null,
    fileExists: (relative) => {
      const resolved = insideRoot(root, relative);
      return resolved !== null && fs.existsSync(resolved);
    },
    history: readHistory(root),
    ...readRecords(root),
  };
}

module.exports = { collectReleaseInput, readFingerprint };
