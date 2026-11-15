'use strict';

// Shared set-up for the stack gates: the lifecycle driver from .env, and the
// checks both gates need. The gates use only public routes, as the Lifecycle
// Lab does. They never create or approve a package: the Active package must
// already carry two real reviews (assurance audit C3).

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createLifecycleDriver } = require('../../demo-lifecycle');

const ROOT = path.join(__dirname, '..', '..', '..');

function readEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) throw new Error('.env not found; run node scripts/setup-dev.js and start the stack');
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .filter((line) => /^[A-Z0-9_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
}

function stackDriver(env = readEnv()) {
  return createLifecycleDriver({
    gatewayUrl: `http://127.0.0.1:${env.GATEWAY_PORT || 8080}`,
    syntheticUrl: `http://127.0.0.1:${env.SYNTHETIC_AGENT_PORT || 4200}`,
    validationUrl: `http://127.0.0.1:${env.VALIDATION_ACTIVATION_PORT || 4010}`,
    curriculumInternalKey: env.CURRICULUM_INTERNAL_KEY,
    admin: { clientId: env.ADMIN_CLIENT_ID, clientSecret: env.ADMIN_CLIENT_SECRET },
  });
}

// The Active package, which must already have two distinct approving reviews
// in its evidence trail. The approvers are recorded so the gate's owner can
// confirm they were people, not the demo's scripted reviewer credentials.
async function requireActivePackage(driver) {
  const active = await driver.activePackage();
  assert.ok(active, 'no Active package: a package approved by two reviewers must be active before the gate runs');
  const approvers = new Set((active.evidence || [])
    .filter((record) => record.event === 'review_submitted' && record.approved === true).map((record) => record.reviewer_id));
  assert.ok(approvers.size >= 2, `the Active package has ${approvers.size} distinct approving reviewers; two are required`);
  return { packageId: active.packageId, version: active.version, approvers: [...approvers] };
}

function writeResult(result, name) {
  const dir = path.join(ROOT, 'artifacts', 'gates');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, `${JSON.stringify({ ...result, recordedAt: new Date().toISOString() }, null, 2)}\n`);
  return file;
}

function printResult(result, file) {
  for (const check of result.checks) {
    process.stdout.write(`${check.status.padEnd(8)} ${check.id}: ${check.title}` +
      `${check.error ? ` — ${check.error}` : ''}${check.reason ? ` — ${check.reason}` : ''}\n`);
  }
  process.stdout.write(`${result.gate}: ${result.status} (${path.relative(ROOT, file)})\n`);
}

module.exports = { printResult, requireActivePackage, stackDriver, writeResult };
