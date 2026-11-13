'use strict';
// Repository paths the release gate reads. Relative to the repository root, with forward slashes.

const RECORDS_DIRECTORY = 'docs/release/records';
const LIMITATIONS_FILE = 'docs/release/limitations.md';
const EVIDENCE_DIRECTORY = 'evidence';

// Release records and evidence are written after the source they describe,
// so they are left out of the source fingerprint.
const UNFINGERPRINTED_PREFIXES = [`${RECORDS_DIRECTORY}/`, `${EVIDENCE_DIRECTORY}/`];

module.exports = { RECORDS_DIRECTORY, LIMITATIONS_FILE, UNFINGERPRINTED_PREFIXES };
