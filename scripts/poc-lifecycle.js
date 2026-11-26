'use strict';
// PoC evidence run: one Synthetic Agent Learner through the whole lifecycle
// against the running Compose stack; writes artifacts/poc/lifecycle-run.json.
// Simulation evidence only.
//   node scripts/poc-lifecycle.js [exam scenario, default safe-escalation] [domain, default ai-safety]
const fs = require('node:fs');
const path = require('node:path');
const { createLifecycleDriver, demoAutoApproveFromEnv } = require('../packages/demo-lifecycle');
const { CANDIDATE_DOMAINS, candidateFor, readEnvFile, stackConnection } = require('../packages/demo-lifecycle/stack');

const domain = process.argv[3] || 'ai-safety';
const candidate = candidateFor(domain);
if (!candidate) {
  console.error(`unknown domain ${domain}; use one of ${CANDIDATE_DOMAINS.join(', ')}`);
  process.exit(2);
}

const root = path.resolve(__dirname, '..');
// EDUAGENTX_ENV_FILE runs the lifecycle against another stack's settings, e.g. a copy of older data.
const env = readEnvFile(process.env.EDUAGENTX_ENV_FILE || path.join(root, '.env'));
const output = path.join(root, 'artifacts', 'poc', 'lifecycle-run.json');

const driver = createLifecycleDriver({
  ...stackConnection(env),
  candidate,
  examScenario: process.argv[2] || 'safe-escalation',
  // Unset means on, as in docker-compose.yml's web service.
  autoApprove: demoAutoApproveFromEnv({ ...env, DEMO_AUTO_APPROVE: env.DEMO_AUTO_APPROVE ?? '1' }),
});

driver.run({ onStep: (step) => {
  if (step.status === 'running') return;
  const mark = step.status === 'passed' ? 'PASS' : 'FAIL';
  console.log(`${mark}  ${step.title.padEnd(42)} ${String(step.durationMs).padStart(6)} ms${step.error ? `  ${step.error}` : ''}${step.detail?.kind ? ` (${step.detail.kind})` : ''}`);
} }).then((report) => {
  // The credential is evidence; the compact JWS is kept, operator secrets never are.
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n${report.status.toUpperCase()}  ${output}`);
  if (report.steps?.find((step) => step.id === 'package')?.detail?.autoApproved) {
    console.log('\nThe package was approved automatically by the demo reviewer accounts (DEMO_AUTO_APPROVE=1), not by people.');
  }
  if (report.steps?.some((step) => step.error === 'package_awaiting_review')) {
    const { packageId, version } = candidate.manifest;
    console.log(`\n${packageId} ${version} needs two approving reviews before it can be activated. It is approved ` +
      'automatically only when nobody has reviewed it, DEMO_AUTO_APPROVE is not 0 and REVIEWER_1/REVIEWER_2 are in .env. Otherwise:\n' +
      `  - two people review it in the Governance page (http://localhost:4300), signing in with REVIEWER_1 and REVIEWER_2 from .env; or\n` +
      `  - on a throwaway test stack only: EDUAGENTX_DISPOSABLE_STACK=1 node scripts/review-test-package.js ${domain}\n` +
      'Then run this script again.');
  }
  if (report.status !== 'passed') process.exitCode = 1;
});
