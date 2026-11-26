#!/usr/bin/env node
'use strict';
// Recorded rubric-judge verdicts for the scripted agent's written answers
// (scripted-verdicts.v1.json), so tests grade those answers with the production
// rubric grader (grading-service rubric-grader.js) and no key or network.
//
// What is recorded: every text item of the standard form of each package in
// services/curriculum-engine/examples/*-candidate.js, answered as reference.js
// answers it under the profiles in RECORDED_PROFILES: the competent written
// answer (competent-answers.v1.json), the low-effort answer, and the
// authorization-boundary scenario answer on its slot. A malformed-output answer
// is not recorded: it embeds the item id, which changes with the package digest.
// Keys are the grading service's own verdictKey, so a replayed verdict is the
// one the grader would take from its cache. A changed answer, item, rubric,
// judge prompt or model is a new key: replay then fails closed.
//
// Re-record (live judge, JUDGE_API_KEY or OPENCODE_API_KEY, JUDGE_MODEL, JUDGE_MODEL_URL):
//   node --env-file=.env packages/execution-provenance/scripted-verdicts.js --record
// Verdicts already in this file or in the grading-validity dataset
// (packages/grading-validity/dataset/judge-verdicts.v1.json) are reused; only
// the rest are asked of the judge. Without --record it prints each verdict.

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const reference = require('./reference');
const { competentAnswer } = require('./competent-answers');
const { sha256 } = require('../../services/curriculum-engine/model');
const { createStandardItems } = require('../../services/examination-engine/standard-generator');
const { gradingRequest } = require('../../services/examination-engine/grading');
const { PROMPT_SHA256, PROMPT_VERSION, createJudge } = require('../../services/grading-service/src/judge');
const { GradingUnavailableError, createRubricGrader, graderIdentity } = require('../../services/grading-service/src/rubric-grader');
const { createMemoryCache, verdictKey } = require('../../services/grading-service/src/verdict-cache');
const validity = require('../grading-validity/src/verdicts');

const FILE = path.join(__dirname, 'scripted-verdicts.v1.json');
const SCHEMA_VERSION = 'scripted-agent-verdicts/1.0.0';
const VALIDITY_SOURCE = 'packages/grading-validity/dataset/judge-verdicts.v1.json';
const NOTE = 'The rubric judge\'s real verdicts on the scripted agent\'s written answers, keyed by the grading service\'s verdictKey. ' +
  'Recorded by `node --env-file=.env packages/execution-provenance/scripted-verdicts.js --record`. Verdicts, not labels.';
const PACKAGES = ['ai-safety', 'customer-refunds', 'personal-data']
  .map((domain) => require(`../../services/curriculum-engine/examples/${domain}-candidate`));
const RECORDED_PROFILES = Object.freeze(['safe-escalation', 'authorization-boundary', 'low-effort']);
// A judge call that fails is asked again this many times (verdicts already
// given are cached); the old file is left as it was if it still fails.
const RECORD_RETRIES = 2;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = (text) => createHash('sha256').update(text).digest('hex');

/** @returns {{ pkg: object, items: object[] }[]} each package with its generated standard form */
const forms = () => PACKAGES.map((pkg) => ({ pkg, items: createStandardItems({ packageDigest: sha256(pkg),
  template: pkg.examTemplate, objectives: pkg.objectives, modules: pkg.modules, sources: pkg.sources, rubric: pkg.rubric }) }));

// The Engine's grading request for one profile's answers to one form.
function requestFor({ pkg, items }, profile) {
  const responses = items.map((item, index) => ({ itemId: item.id, response: reference.examAnswer(profile, item, index) }));
  return gradingRequest({ form: { items, rubric: { id: pkg.rubric.id, version: pkg.rubric.version } }, responses }, pkg);
}

/**
 * Every distinct text input the scripted agent gives, with its verdict key under the judge `model`.
 * @param {string} model
 * @returns {{ key: string, domainId: string, slotId: string, tier: string, answer: string, rubric: object, item: object }[]}
 */
function scriptedInputs(model) {
  const graderVersion = graderIdentity(model).version;
  const inputs = new Map();
  for (const form of forms()) {
    const slots = new Map(form.items.map((item) => [item.id, item.slotId]));
    for (const profile of RECORDED_PROFILES) {
      const { rubric, items } = requestFor(form, profile);
      for (const { itemId, ...item } of items) {
        const key = verdictKey({ graderVersion, model, promptSha256: PROMPT_SHA256, rubric, item });
        if (inputs.has(key)) continue;
        const answer = item.response === competentAnswer(item.prompt) ? 'competent' : profile;
        inputs.set(key, { key, domainId: form.pkg.manifest.domainId, slotId: slots.get(itemId), tier: item.tier, answer, rubric, item });
      }
    }
  }
  return [...inputs.values()];
}

/**
 * @param {string} file
 * @returns {{ model: string|null, verdicts: Record<string, object>, records: Record<string, object> }}
 *   empty when the file does not exist, so every replayed lookup misses and grading fails closed
 */
function loadScriptedVerdicts(file = FILE) {
  if (!fs.existsSync(file)) return { model: null, verdicts: {}, records: {} };
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.schemaVersion !== SCHEMA_VERSION || !isObject(data.verdicts)) throw new Error(`${path.basename(file)} is not a ${SCHEMA_VERSION} file`);
  const verdicts = Object.fromEntries(Object.entries(data.verdicts).map(([key, record]) => [key, record.verdict]));
  return { model: data.judge?.model ?? null, verdicts, records: data.verdicts };
}

/**
 * The production rubric grader with a judge that has no key: it grades only
 * from the recorded verdicts, and an unrecorded input is GradingUnavailableError.
 * @param {{ file?: string }} options
 * @returns {{ identity: { id: string, version: string }, gradeItems: (request: object) => Promise<object[]> }}
 */
function replayGrader({ file = FILE } = {}) {
  const { model, verdicts } = loadScriptedVerdicts(file);
  if (!model) throw new Error(`${path.basename(file)} has no recorded verdicts`);
  return createRubricGrader({ judge: createJudge({ apiKey: '', model }), cache: createMemoryCache({ entries: verdicts }) });
}

async function gradeWithRetries(grader, request) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await grader.gradeItems(request); }
    catch (error) { if (!(error instanceof GradingUnavailableError) || attempt >= RECORD_RETRIES) throw error; }
  }
}

/**
 * Grades every scripted input through the production rubric grader with `judge`,
 * starting its cache from the reused verdicts, and writes the file.
 * @param {{ judge: object, usage: object, file?: string, now?: () => string,
 *   reuse?: { source: string, verdicts: Record<string, object> }[] }} input
 *   reuse: earlier verdict sets, first match wins; by default this file, then the grading-validity dataset
 * @returns {Promise<{ reused: number, asked: number }>}
 */
async function recordScriptedVerdicts({ judge, usage, file = FILE, now = () => new Date().toISOString(),
  reuse = defaultReuse(file) }) {
  const inputs = scriptedInputs(judge.model);
  const from = new Map();
  for (const set of reuse) for (const input of inputs) {
    if (!from.has(input.key) && set.verdicts[input.key]) from.set(input.key, { source: set.source, verdict: set.verdicts[input.key] });
  }
  const cache = createMemoryCache({ entries: Object.fromEntries([...from].map(([key, { verdict }]) => [key, verdict])) });
  const grader = createRubricGrader({ judge, cache });
  for (const form of forms()) for (const profile of RECORDED_PROFILES) await gradeWithRetries(grader, requestFor(form, profile));
  const recordedAt = now();
  const verdicts = Object.fromEntries(inputs.sort((a, b) => a.key.localeCompare(b.key)).map((input) => {
    const prior = from.get(input.key);
    return [input.key, { domainId: input.domainId, slotId: input.slotId, tier: input.tier, answer: input.answer,
      responseSha256: hash(input.item.response), recordedFrom: prior ? prior.source : 'live', verdict: cache.get(input.key) }];
  }));
  const data = { schemaVersion: SCHEMA_VERSION, note: NOTE, grader: graderIdentity(judge.model),
    judge: { model: judge.model, promptVersion: PROMPT_VERSION, promptSha256: PROMPT_SHA256 }, recordedAt, usage, verdicts };
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  return { reused: from.size, asked: inputs.length - from.size };
}

// This file's own verdicts keep their source; the grading-validity dataset's first pass is the other source.
function defaultReuse(file) {
  const own = loadScriptedVerdicts(file);
  const sources = Object.groupBy(Object.entries(own.records), ([, record]) => record.recordedFrom);
  return [...Object.entries(sources).map(([source, entries]) => ({ source,
    verdicts: Object.fromEntries(entries.map(([key, record]) => [key, record.verdict])) })),
  { source: VALIDITY_SOURCE, verdicts: validity.loadVerdicts().verdicts }];
}

function printVerdicts() {
  const { records } = loadScriptedVerdicts();
  const rows = Object.values(records).sort((a, b) => `${a.answer}${a.domainId}${a.slotId}`.localeCompare(`${b.answer}${b.domainId}${b.slotId}`));
  for (const r of rows) process.stdout.write(`${r.answer}\t${r.domainId}\t${r.slotId}\t${r.tier}\t${r.verdict.score}\t` +
    `[${r.verdict.criticalViolationRuleIds.join(',')}]\t${r.verdict.rationale}\n`);
}

if (require.main === module) {
  if (!process.argv.includes('--record')) printVerdicts();
  else {
    const { judge, usage } = validity.liveJudge(process.env);
    recordScriptedVerdicts({ judge, usage }).then(({ reused, asked }) => process.stdout.write(
      `recorded ${reused + asked} verdicts (${reused} reused, ${asked} judged): ${usage.calls} calls, ` +
      `${usage.promptTokens} prompt + ${usage.completionTokens} completion tokens\n`))
      .catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
  }
}

module.exports = { FILE, RECORDED_PROFILES, SCHEMA_VERSION, VALIDITY_SOURCE, loadScriptedVerdicts, recordScriptedVerdicts,
  replayGrader, scriptedInputs };
