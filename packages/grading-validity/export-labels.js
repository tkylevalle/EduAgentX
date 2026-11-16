#!/usr/bin/env node
'use strict';

// Writes dataset/human-labels.json from the labels people recorded on the
// console's Labelling page:
//   node packages/grading-validity/export-labels.js
// It signs in to the Gateway as the admin client (ADMIN_CLIENT_ID and
// ADMIN_CLIENT_SECRET from the environment or the repository's .env, never
// printed), reads GET /v1/admin/grader-labels/export, checks the result with
// src/labels.js and only then replaces the file. Then run cli.js.

const fs = require('node:fs');
const path = require('node:path');
const { loadHumanLabels } = require('./src/labels');

// The document version src/labels.js reads.
const SCHEMA_VERSION = 'grading-human-labels/1.0.0';
const ENV_FILE = path.join(__dirname, '..', '..', '.env');
const DEFAULT_OUT = path.join(__dirname, 'dataset', 'human-labels.json');
// The Gateway's published port in docker-compose.yml when .env does not set one.
const DEFAULT_GATEWAY_PORT = 8080;
// One sign-in and one read of about two hundred labels; a live Gateway answers in well under a second.
const REQUEST_TIMEOUT_MS = 10_000;

/** KEY=VALUE lines of a .env file; a missing file gives no values. */
function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => /^[A-Z0-9_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
}

function gatewaySettings(env) {
  if (!env.ADMIN_CLIENT_ID || !env.ADMIN_CLIENT_SECRET) {
    throw new Error('ADMIN_CLIENT_ID and ADMIN_CLIENT_SECRET are required (set them in .env or the environment)');
  }
  return { gatewayUrl: env.EDUAGENTX_GATEWAY_URL || `http://127.0.0.1:${env.GATEWAY_PORT || DEFAULT_GATEWAY_PORT}`,
    clientId: env.ADMIN_CLIENT_ID, clientSecret: env.ADMIN_CLIENT_SECRET };
}

// Errors name the step and the status only, so the secret never reaches a message.
async function readExport({ gatewayUrl, clientId, clientSecret }, fetchImpl) {
  const signIn = await fetchImpl(`${gatewayUrl}/v1/auth/tokens`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (signIn.status !== 200) throw new Error(`admin sign-in to the Gateway was refused with status ${signIn.status}`);
  const { accessToken } = await signIn.json();
  const exported = await fetchImpl(`${gatewayUrl}/v1/admin/grader-labels/export`,
    { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (exported.status !== 200) throw new Error(`the label export was refused with status ${exported.status}`);
  return exported.json();
}

function labelsDocument(exported, dataset) {
  if (exported?.datasetVersion !== dataset.version || !Array.isArray(exported.labels)) {
    throw new Error(`the export holds labels for dataset version ${exported?.datasetVersion}, not ${dataset.version}`);
  }
  return { schemaVersion: SCHEMA_VERSION, labels: exported.labels.map(({ responseId, labeller, acceptable, score, safetyViolation, labelledAt }) =>
    ({ responseId, labeller, acceptable, score, safetyViolation, labelledAt })) };
}

// Written beside the target and checked by labels.js first, so a refused export leaves the old file as it was.
function writeChecked(document, dataset, out) {
  const temporary = `${out}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`);
  try { loadHumanLabels(temporary, dataset); } catch (error) { fs.rmSync(temporary, { force: true }); throw error; }
  fs.renameSync(temporary, out);
}

/**
 * @param {{ env: Record<string, string|undefined>, fetchImpl?: typeof fetch, out?: string, dataset?: object }} options
 * @returns {Promise<{ count: number, out: string }>}
 */
async function exportLabels({ env, fetchImpl = fetch, out = DEFAULT_OUT, dataset = require('./dataset/responses.v1.json') }) {
  const document = labelsDocument(await readExport(gatewaySettings(env), fetchImpl), dataset);
  writeChecked(document, dataset, out);
  return { count: document.labels.length, out };
}

if (require.main === module) {
  exportLabels({ env: { ...readEnvFile(ENV_FILE), ...process.env } })
    .then(({ count, out }) => process.stdout.write(`wrote ${count} labels to ${path.relative(process.cwd(), out)}\n`))
    .catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}

module.exports = { exportLabels };
