'use strict';

// Recorded rubric-judge verdicts, so the validity report runs in CI with no
// model key. Each verdict in dataset/judge-verdicts.v1.json is the judge's
// real output for one input, recorded from a live call by
// `cli.js --record`; replaying it is the same as the judge answering again
// from its cache. They are NOT labels: what people judged is in
// human-labels.json, and the report compares the two.
//
// Two verdicts are kept per input: `verdicts` from the first live pass and
// `repeat` from a second live pass made without the cache, so the report's
// repeat variance is the live judge's own, not the cache's zero.

const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_MODEL, DEFAULT_URL, PROMPT_SHA256, PROMPT_VERSION, createJudge } = require('../../../services/grading-service/src/judge');
const { graderIdentity } = require('../../../services/grading-service/src/rubric-grader');

const VERDICTS_FILE = path.join(__dirname, '..', 'dataset', 'judge-verdicts.v1.json');
const SCHEMA_VERSION = 'grading-judge-verdicts/1.0.0';
const NOTE = 'Each verdict is the rubric judge\'s real output for one input (sha256 key), recorded from a live call by ' +
  '`node packages/grading-validity/cli.js --record`. Replayed so CI needs no model key. Not labels: labels from people are in human-labels.json.';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * @param {string} file
 * @returns {{ model: string|null, verdicts: Record<string, object>, repeat: Record<string, object> }}
 *   empty when the file does not exist, so every lookup misses and grading fails closed
 */
function loadVerdicts(file = VERDICTS_FILE) {
  if (!fs.existsSync(file)) return { model: null, verdicts: {}, repeat: {} };
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (data.schemaVersion !== SCHEMA_VERSION || !isObject(data.verdicts) || !isObject(data.repeat))
    throw new Error(`${path.basename(file)} is not a ${SCHEMA_VERSION} file`);
  return { model: data.judge?.model ?? null, verdicts: data.verdicts, repeat: data.repeat };
}

const sortedEntries = (entries) => Object.fromEntries(Object.keys(entries).sort().map((key) => [key, entries[key]]));

/**
 * Writes the recorded verdicts, keys sorted so a re-record diffs cleanly.
 * @param {{ file?: string, model: string, verdicts: Record<string, object>, repeat: Record<string, object>,
 *   usage: { calls: number, promptTokens: number, completionTokens: number }, recordedAt: string }} input
 */
function saveVerdicts({ file = VERDICTS_FILE, model, verdicts, repeat, usage, recordedAt }) {
  const data = { schemaVersion: SCHEMA_VERSION, note: NOTE, grader: graderIdentity(model),
    judge: { model, promptVersion: PROMPT_VERSION, promptSha256: PROMPT_SHA256 }, recordedAt, usage,
    verdicts: sortedEntries(verdicts), repeat: sortedEntries(repeat) };
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

/** @returns {string} the judge model: JUDGE_MODEL or the service default */
const judgeModel = (env) => env.JUDGE_MODEL || DEFAULT_MODEL;

/** A judge with no key: it can only replay recorded verdicts. */
const replayJudge = (env = process.env) => createJudge({ apiKey: '', model: judgeModel(env) });

/**
 * The live judge for --record, with the service's own variables
 * (JUDGE_API_KEY, falling back to OPENCODE_API_KEY; JUDGE_MODEL_URL; JUDGE_MODEL).
 * @param {NodeJS.ProcessEnv} env
 * @param {{ fetchImpl?: Function }} options
 * @returns {{ judge: object, usage: { calls: number, promptTokens: number, completionTokens: number } }}
 */
function liveJudge(env = process.env, { fetchImpl = fetch } = {}) {
  const usage = { calls: 0, promptTokens: 0, completionTokens: 0 };
  const judge = createJudge({ apiKey: env.JUDGE_API_KEY || env.OPENCODE_API_KEY, url: env.JUDGE_MODEL_URL || DEFAULT_URL,
    model: judgeModel(env), fetchImpl, sessionId: `eduagentx-judge-record-${Date.now()}`,
    onUsage: ({ promptTokens, completionTokens }) => {
      usage.calls += 1;
      usage.promptTokens += promptTokens ?? 0;
      usage.completionTokens += completionTokens ?? 0;
    } });
  if (!judge.available) throw new Error(`cannot record verdicts: ${judge.reason} (set JUDGE_API_KEY or OPENCODE_API_KEY)`);
  return { judge, usage };
}

module.exports = { SCHEMA_VERSION, VERDICTS_FILE, liveJudge, loadVerdicts, replayJudge, saveVerdicts };
