'use strict';
const crypto = require('node:crypto');

// Release records and evidence are written after the source they describe,
// so they are left out of the fingerprint that the records refer to.
const EXCLUDED_PREFIXES = ['docs/release/records/', 'evidence/'];

/**
 * @param {string} stagedListing output of `git ls-files -s`
 * @returns {string} SHA-256 hex digest of the tracked source
 */
function sourceFingerprint(stagedListing) {
  const entries = stagedListing.split(/\r?\n/).filter(Boolean).map((line) => {
    const [meta, path] = line.split('\t');
    const [mode, blob] = meta.split(' ');
    return { path, entry: `${path}\t${mode} ${blob}` };
  }).filter(({ path }) => !EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix)));
  const lines = entries.map(({ entry }) => entry).sort();
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

module.exports = { sourceFingerprint, EXCLUDED_PREFIXES };
