'use strict';

// Real judge verdicts that the repository recorded, loaded into the verdict
// cache at start. The image carries two files:
//   packages/grading-validity/dataset/judge-verdicts.v1.json
//   packages/execution-provenance/scripted-verdicts.v1.json
// Their keys are this service's verdictKey, so an answer recorded there is
// graded as the judge graded it, with no key and no network. An answer that is
// not recorded still needs the live judge; without one it fails closed (503).
// A file recorded under another grader version (judge model or prompt) is
// skipped, so a verdict is never reused for a grader that did not give it.

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_DIR = path.join(__dirname, '..', 'recorded-verdicts');

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

// judge-verdicts holds { key: verdict }; scripted-verdicts holds { key: { ..., verdict } }.
const verdictOf = (record) => (isObject(record?.verdict) ? record.verdict : record);

/**
 * @param {{ dir?: string, identity: { id: string, version: string } }} options
 * @returns {Record<string, object>} recorded verdicts by verdictKey; empty when the directory is missing
 */
function loadRecordedVerdicts({ dir = DEFAULT_DIR, identity }) {
  if (!fs.existsSync(dir)) return {};
  const verdicts = {};
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith('.json')).sort()) {
    const data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    if (data.grader?.id !== identity.id || data.grader?.version !== identity.version || !isObject(data.verdicts)) continue;
    for (const [key, record] of Object.entries(data.verdicts)) verdicts[key] ??= verdictOf(record);
  }
  return verdicts;
}

module.exports = { DEFAULT_DIR, loadRecordedVerdicts };
