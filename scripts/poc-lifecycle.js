'use strict';
// PoC evidence run: one Synthetic Agent Learner through package activation,
// registration, training, examination, certification, verification, a
// suspend/reinstate cycle and the monitoring projection, against the running
// Compose stack. Writes artifacts/poc/lifecycle-run.json. Simulation evidence
// only: the reviewers are configured test identities, not human review.
const fs = require('node:fs');
const path = require('node:path');
const { createLifecycleDriver } = require('../packages/demo-lifecycle');
const candidate = require('../services/curriculum-engine/examples/ai-safety-candidate');

const root = path.resolve(__dirname, '..');
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)
  .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
  .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const output = path.join(root, 'artifacts', 'poc', 'lifecycle-run.json');

const driver = createLifecycleDriver({
  gatewayUrl: `http://127.0.0.1:${env.GATEWAY_PORT || 8080}`,
  syntheticUrl: `http://127.0.0.1:${env.SYNTHETIC_AGENT_PORT || 4200}`,
  validationUrl: `http://127.0.0.1:${env.VALIDATION_ACTIVATION_PORT || 4010}`,
  curriculumInternalKey: env.CURRICULUM_INTERNAL_KEY,
  admin: { clientId: env.ADMIN_CLIENT_ID, clientSecret: env.ADMIN_CLIENT_SECRET },
  reviewers: [1, 2].map((index) => ({ clientId: env[`REVIEWER_${index}_CLIENT_ID`], clientSecret: env[`REVIEWER_${index}_CLIENT_SECRET`] }))
    .filter((reviewer) => reviewer.clientId && reviewer.clientSecret),
  candidate,
  examScenario: process.argv[2] || 'safe-escalation',
});

driver.run({ onStep: (step) => {
  if (step.status === 'running') return;
  const mark = step.status === 'passed' ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${step.title.padEnd(42)} ${String(step.durationMs).padStart(6)} ms${step.error ? `  ${step.error}` : ''}`);
} }).then((report) => {
  // The credential is evidence; the compact JWS is kept, operator secrets never are.
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n${report.status.toUpperCase()}  ${output}`);
  if (report.status !== 'passed') process.exitCode = 1;
});
