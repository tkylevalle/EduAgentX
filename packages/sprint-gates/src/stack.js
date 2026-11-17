'use strict';

// Shared set-up for the stack gates: the lifecycle driver from .env, the
// package check both gates need, and running a gate to a recorded result.
// The gates act only through the Gateway and the agent's own API, as the
// Lifecycle Lab does. They never create or approve a package. The Gateway
// has no route for the Active package, so it is read, read-only, from
// validation-activation with the curriculum internal key.

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createLifecycleDriver } = require('../../demo-lifecycle');
const { createGate } = require('./gate');

const ROOT = path.join(__dirname, '..', '..', '..');
// The reviewer client IDs are required so the scripted-approval check below
// cannot pass by default when they are missing.
const REQUIRED_ENV = Object.freeze(['ADMIN_CLIENT_ID', 'ADMIN_CLIENT_SECRET', 'CURRICULUM_INTERNAL_KEY',
  'REVIEWER_1_CLIENT_ID', 'REVIEWER_2_CLIENT_ID']);
// The spec's two-person review: two distinct authenticated reviewers.
const MIN_APPROVERS = 2;
// The demo's shared reviewer credentials. The demo driver signs reviews with
// them (assurance audit C3), so their approvals are not a people's review.
const SCRIPTED_REVIEWER_KEYS = Object.freeze(['REVIEWER_1_CLIENT_ID', 'REVIEWER_2_CLIENT_ID']);

/** @returns {Record<string, string>} the KEY=value lines of .env; fails if a required key is missing */
function readEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) throw new Error('.env not found; run node scripts/setup-dev.js and start the stack');
  const env = Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .filter((line) => /^[A-Z0-9_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  const missing = REQUIRED_ENV.filter((key) => !env[key]);
  if (missing.length) throw new Error(`.env is missing ${missing.join(', ')}; run node scripts/setup-dev.js`);
  return env;
}

function stackDriver(env) {
  return createLifecycleDriver({
    gatewayUrl: `http://127.0.0.1:${env.GATEWAY_PORT || 8080}`,
    syntheticUrl: `http://127.0.0.1:${env.SYNTHETIC_AGENT_PORT || 4200}`,
    validationUrl: `http://127.0.0.1:${env.VALIDATION_ACTIVATION_PORT || 4010}`,
    curriculumInternalKey: env.CURRICULUM_INTERNAL_KEY,
    admin: { clientId: env.ADMIN_CLIENT_ID, clientSecret: env.ADMIN_CLIENT_SECRET },
  });
}

/**
 * The Active package, which must carry approvals from two distinct reviewers
 * other than the demo's scripted reviewer credentials.
 * @param {{ activePackage: () => Promise<object|null> }} driver
 * @param {{ scriptedReviewerIds?: string[] }} [options]
 * @returns {Promise<{ packageId: string, version: string, approvers: string[], objectives: object[] }>}
 */
async function requireActivePackage(driver, { scriptedReviewerIds = [] } = {}) {
  const active = await driver.activePackage();
  assert.ok(active, 'no Active package: a package approved by two reviewers must be active before the gate runs');
  const approvers = [...new Set((active.evidence || [])
    .filter((record) => record.event === 'review_submitted' && record.approved === true).map((record) => record.reviewer_id))];
  const scripted = approvers.filter((approver) => scriptedReviewerIds.includes(approver));
  assert.deepEqual(scripted, [], `approved with the demo's scripted reviewer credentials (${scripted.join(', ')}); ` +
    'reviews must come from named reviewers');
  assert.ok(approvers.length >= MIN_APPROVERS,
    `the Active package has ${approvers.length} distinct approving reviewers; ${MIN_APPROVERS} are required`);
  return { packageId: active.packageId, version: active.version, approvers, objectives: active.objectives || [] };
}

/**
 * The check both gates start with: an Active package approved by two named reviewers.
 * @returns {Promise<object|null>} the package summary, or null when the check did not pass
 */
function checkActivePackage(gate, { driver, scriptedReviewerIds }) {
  return gate.check('active-package', 'An Active package approved by two named reviewers governs the exam',
    () => requireActivePackage(driver, { scriptedReviewerIds }));
}

function writeResult(result, name) {
  const recordedAt = new Date().toISOString();
  const dir = path.join(ROOT, 'artifacts', 'gates');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}-${recordedAt.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, `${JSON.stringify({ ...result, recordedAt }, null, 2)}\n`);
  return file;
}

function printResult(result, file) {
  for (const check of result.checks) {
    process.stdout.write(`${check.status.padEnd(8)} ${check.id}: ${check.title}` +
      `${check.error ? ` — ${check.error}` : ''}${check.reason ? ` — ${check.reason}` : ''}\n`);
  }
  process.stdout.write(`${result.gate}: ${result.status} (${path.relative(ROOT, file)})\n`);
}

/**
 * Runs one gate on the stack and records its result under artifacts/gates.
 * @param {string} name
 * @param {(gate: object, context: { driver: object, scriptedReviewerIds: string[] }) => Promise<void>} defineChecks
 */
async function runGate(name, defineChecks) {
  try {
    const env = readEnv();
    const gate = createGate(name);
    await defineChecks(gate, { driver: stackDriver(env),
      scriptedReviewerIds: SCRIPTED_REVIEWER_KEYS.map((key) => env[key]).filter(Boolean) });
    const result = gate.result();
    printResult(result, writeResult(result, name));
    process.exitCode = result.exitCode;
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  }
}

module.exports = { MIN_APPROVERS, checkActivePackage, readEnv, requireActivePackage, runGate };
