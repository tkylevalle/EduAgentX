'use strict';
// Throwaway test stack only: activates a domain's candidate package with two
// TEST reviews from REVIEWER_1 and REVIEWER_2 in .env. They are not people's
// reviews; each says so in its comment.
//   EDUAGENTX_DISPOSABLE_STACK=1 node scripts/review-test-package.js [domain, default ai-safety]
const path = require('node:path');
const { demoApprovalReview } = require('../packages/demo-lifecycle');
const { CANDIDATE_DOMAINS, candidateFor, readEnvFile, stackConnection } = require('../packages/demo-lifecycle/stack');

const TEST_COMMENT = 'TEST REVIEW on a disposable stack by a configured test account; not a human review.';

function fail(message) {
  console.error(message);
  process.exit(2);
}

if (process.env.EDUAGENTX_DISPOSABLE_STACK !== '1') {
  fail('Refused: this submits TEST reviews from the configured test reviewer accounts. Run it only on a throwaway stack, with\n' +
    '  EDUAGENTX_DISPOSABLE_STACK=1 node scripts/review-test-package.js [domain]\n' +
    'On a demo or shared stack, two people review the package in the Governance page (http://localhost:4300).');
}
const domain = process.argv[2] || 'ai-safety';
const candidate = candidateFor(domain);
if (!candidate) fail(`unknown domain ${domain}; use one of ${CANDIDATE_DOMAINS.join(', ')}`);

const env = readEnvFile(process.env.EDUAGENTX_ENV_FILE || path.join(__dirname, '..', '.env'));
const gateway = stackConnection(env).gatewayUrl;

async function call(method, route, { token, body } = {}) {
  const reply = await fetch(`${gateway}${route}`, { method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: reply.status, data: await reply.json().catch(() => ({})) };
}

async function signIn(prefix) {
  const clientId = env[`${prefix}_CLIENT_ID`], clientSecret = env[`${prefix}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) fail(`${prefix}_CLIENT_ID and ${prefix}_CLIENT_SECRET must be set in .env (node scripts/setup-dev.js)`);
  const reply = await call('POST', '/v1/auth/tokens', { body: { clientId, clientSecret } });
  if (reply.status !== 200) fail(`${prefix} sign-in refused (${reply.status} ${reply.data.error || ''})`);
  return reply.data.accessToken;
}

const expect = (reply, statuses, step) => {
  if (!statuses.includes(reply.status)) fail(`${step} failed: ${reply.status} ${JSON.stringify(reply.data.error ?? reply.data)}`);
  return reply.data;
};

async function main() {
  const id = candidate.manifest.packageId, version = candidate.manifest.version;
  const packageRoute = `/v1/admin/curriculum/packages/${encodeURIComponent(id)}/${encodeURIComponent(version)}`;
  const admin = await signIn('ADMIN');
  let stored = await call('GET', packageRoute, { token: admin });
  if (stored.status === 404) {
    expect(await call('POST', '/v1/admin/curriculum/packages', { token: admin, body: candidate }), [200, 201], 'ingestion');
    stored = await call('GET', packageRoute, { token: admin });
  }
  stored = expect(stored, [200], 'package read');
  if (stored.state === 'Active') return console.log(`${id} ${version} is already Active; nothing to do.`);
  if (stored.state === 'Candidate') {
    const validated = expect(await call('POST', '/v1/admin/curriculum/validate', { token: admin, body: { package_id: id, version } }), [200], 'validation');
    if (!validated.passed) fail(`validation did not pass: ${JSON.stringify(validated.gates)}`);
  }
  for (const prefix of ['REVIEWER_1', 'REVIEWER_2']) {
    const reply = await call('POST', '/v1/curriculum/review', { token: await signIn(prefix),
      body: demoApprovalReview(candidate, TEST_COMMENT) });
    // duplicate_reviewer: this account already reviewed this version on an earlier run.
    const repeated = reply.status === 409 && reply.data.error === 'duplicate_reviewer';
    if (!repeated) expect(reply, [200], `${prefix} review`);
    console.log(`${prefix}: TEST review ${repeated ? 'already on record' : 'submitted'}`);
  }
  expect(await call('POST', '/v1/admin/curriculum/activate', { token: admin, body: { package_id: id, version } }), [200], 'activation');
  console.log(`${id} ${version} is Active (TEST reviews). Run: node scripts/poc-lifecycle.js safe-escalation ${domain}`);
}

main().catch((error) => fail(`could not reach the Gateway at ${gateway}: ${error.message}`));
