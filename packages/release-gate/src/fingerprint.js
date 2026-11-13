'use strict';
const crypto = require('node:crypto');
const { UNFINGERPRINTED_PREFIXES } = require('./paths');

/**
 * @param {string} stagedListing output of `git ls-files -s`
 * @returns {string} SHA-256 hex digest of the tracked source
 */
function sourceFingerprint(stagedListing) {
  const lines = stagedListing.split(/\r?\n/).filter(Boolean).map((line) => {
    const [meta, path] = line.split('\t');
    const [mode, blob] = meta.split(' ');
    return { path, entry: `${path}\t${mode} ${blob}` };
  })
    .filter(({ path }) => !UNFINGERPRINTED_PREFIXES.some((prefix) => path.startsWith(prefix)))
    .map(({ entry }) => entry)
    .sort();
  return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

module.exports = { sourceFingerprint };
