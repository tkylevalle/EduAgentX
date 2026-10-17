'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { generateKeyPairSync } = require('node:crypto');
// The real issuer code, so the mapper is tested against the exact credential shape it produces.
const { issueCredential } = require('../../certification-service/evidence');
const {
  askSource, toCandidate, toVerification, createRegistrySource, createPackageSource, createVerificationSource,
  createLifecycleSource,
} = require('../clients');

// A stub upstream answering each "METHOD path" from a table: [status, body], 'hang' or 'invalid-json'.
async function stub(t, routes) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
      const route = routes[`${req.method} ${req.url}`];
      if (route === 'hang') return;
      if (!route) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"not_found"}'); }
      if (route === 'invalid-json') { res.writeHead(200); return res.end('not json'); }
      res.writeHead(route[0], { 'content-type': 'application/json' });
      return res.end(JSON.stringify(route[1]));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  return { url: `http://127.0.0.1:${server.address().port}`, seen };
}

// What a source answers once wrapped the way the eligibility check wraps it.
const asked = (call) => askSource('test', call, { timeoutMs: 300 });

// --- registry

const registration = (patch = {}) => ({ apiVersion: 'v1', registration: {
  agentLearnerId: '7d0f1b1e-0000-4000-8000-000000000001', agentLearnerKey: 'agent-a', configurationVersion: 2,
  configurationFingerprint: 'sha256:fp-a', status: 'active', ...patch } });
const REG_PATH = 'GET /v1/registrations?agentLearnerKey=agent-a';

test('registry: a good answer gives the current fingerprint', async (t) => {
  const upstream = await stub(t, { [REG_PATH]: [200, registration()] });
  const source = createRegistrySource({ baseUrl: upstream.url });
  assert.deepEqual(await asked(() => source.getCurrentFingerprint('agent-a', { correlationId: 'c-1' })),
    { value: 'sha256:fp-a', outcome: 'answered' });
  assert.equal(upstream.seen[0].headers['x-correlation-id'], 'c-1');
});

test('registry: missing field, wrong type, other learner, inactive, 404, 500, bad JSON and timeout give null', async (t) => {
  const bodies = [registration({ configurationFingerprint: undefined }), registration({ configurationFingerprint: 42 }),
    registration({ configurationFingerprint: 'md5:abc' }), registration({ agentLearnerKey: 'agent-b' }),
    registration({ status: 'suspended' }), registration({ status: undefined }), { registration: 'agent-a' }, []];
  for (const body of bodies) {
    const upstream = await stub(t, { [REG_PATH]: [200, body] });
    const result = await asked(() => createRegistrySource({ baseUrl: upstream.url }).getCurrentFingerprint('agent-a'));
    assert.equal(result.value, null, JSON.stringify(body));
  }
  for (const [route, outcome] of [[undefined, 'answered'], [[500, {}], 'source_unavailable'],
    ['invalid-json', 'contract_violation'], ['hang', 'timeout']]) {
    const upstream = await stub(t, route === undefined ? {} : { [REG_PATH]: route });
    const result = await asked(() => createRegistrySource({ baseUrl: upstream.url, timeoutMs: 100 }).getCurrentFingerprint('agent-a'));
    assert.deepEqual(result, { value: null, outcome }, String(route));
  }
});

// --- package

const PKG_PATH = 'GET /packages/ai-safety-fundamentals?version=1.0.0';
const packageBody = (patch = {}) => ({
  id: 'ai-safety-fundamentals', packageId: 'ai-safety-fundamentals', version: '1.0.0', state: 'Active',
  digest: 'sha256-package-1', manifest: { packageId: 'ai-safety-fundamentals', domain: 'AI Agent Safety and Secure Tool Use' },
  objectives: [{ id: 'o1', text: 'x' }, { id: 'o2', text: 'y' }], quarantinedScopes: [], certificationBlocked: false, ...patch,
});
const askPackage = (url, opts = {}) => asked(() =>
  createPackageSource({ baseUrl: url, internalKey: 'curriculum-key', timeoutMs: 100, ...opts })
    .getPackage('ai-safety-fundamentals', '1.0.0'));

test('package: a good answer maps the domain text and objective ids, with the internal key', async (t) => {
  const upstream = await stub(t, { [PKG_PATH]: [200, packageBody()] });
  assert.deepEqual(await askPackage(upstream.url), { outcome: 'answered',
    value: { digest: 'sha256-package-1', domain: 'ai-agent-safety-secure-tool-use', objectiveIds: ['o1', 'o2'] } });
  assert.equal(upstream.seen[0].headers['x-internal-service-key'], 'curriculum-key');
  assert.equal(upstream.seen[0].headers['x-actor-subject'], 'marketplace-service');
});

test('package: unknown domain text, missing or bad fields, quarantine, 404, 500 and timeout never give a usable answer', async (t) => {
  const fieldCases = [
    [{ manifest: { domain: 'AI Safety Fundamentals' } }, 'domain'],
    [{ manifest: { domain: 'ai-agent-safety-secure-tool-use' } }, 'domain'],
    [{ manifest: {}, domain: undefined }, 'domain'],
    [{ domain: 'Something else' }, 'domain'],
    [{ objectives: undefined }, 'objectiveIds'],
    [{ objectives: [{ id: 'o1' }, { id: 7 }] }, 'objectiveIds'],
    [{ objectives: [{ id: 'o1' }, { id: 'o1' }] }, 'objectiveIds'],
    [{ objectives: [] }, 'objectiveIds'],
    [{ digest: null }, 'digest'],
    [{ digest: 12 }, 'digest'],
  ];
  for (const [patch, field] of fieldCases) {
    const upstream = await stub(t, { [PKG_PATH]: [200, packageBody(patch)] });
    const { value } = await askPackage(upstream.url);
    assert.equal(value[field], null, JSON.stringify(patch));
  }
  for (const patch of [{ packageId: 'other' }, { version: '2.0.0' }, { certificationBlocked: true },
    { quarantinedScopes: [{ type: 'objective', id: 'o1' }] }, { quarantinedScopes: undefined }, { certificationBlocked: undefined }]) {
    const upstream = await stub(t, { [PKG_PATH]: [200, packageBody(patch)] });
    assert.equal((await askPackage(upstream.url)).value, null, JSON.stringify(patch));
  }
  for (const [route, outcome] of [[undefined, 'answered'], [[500, {}], 'source_unavailable'], [[403, {}], 'source_unavailable'],
    ['hang', 'timeout']]) {
    const upstream = await stub(t, route === undefined ? {} : { [PKG_PATH]: route });
    assert.deepEqual(await askPackage(upstream.url), { value: null, outcome }, String(route));
  }
  const noKey = await stub(t, { [PKG_PATH]: [200, packageBody()] });
  assert.deepEqual(await askPackage(noKey.url, { internalKey: undefined }), { value: null, outcome: 'source_not_available' });
  assert.equal(noKey.seen.length, 0);
});

// --- verification

const pass = { status: 'PASS', reason: null };
const fail = { status: 'FAIL', reason: 'x' };
const indeterminate = { status: 'INDETERMINATE_STATUS', reason: 'status_unavailable' };
const report = (patch = {}) => ({ signature: pass, schema: pass, time: pass, suspension: pass, revocation: pass,
  issuerPolicy: pass, credentialPolicy: pass, overall: 'VALID', reasonCodes: [], ...patch });
const candidate = { credentialId: 'cred-1', compactJws: 'aaa.bbb.ccc' };

test('verification: a fully valid report maps to valid, valid, active and sends the jws and credentialId', async (t) => {
  const upstream = await stub(t, { 'POST /verify': [200, report()] });
  const result = await asked(() => createVerificationSource({ baseUrl: upstream.url }).verify(candidate));
  assert.deepEqual(result, { outcome: 'answered', value: { signature: 'valid', schema: 'valid', status: 'active' } });
  assert.deepEqual(upstream.seen[0].body, { jws: 'aaa.bbb.ccc', credentialId: 'cred-1' });
});

test('verification: each failing or unclear check maps to invalid, indeterminate or null, never valid', () => {
  const cases = [
    [{ signature: fail, overall: 'INVALID' }, { signature: 'invalid' }],
    [{ issuerPolicy: fail, overall: 'INVALID' }, { signature: 'invalid' }],
    [{ schema: fail, overall: 'INVALID' }, { schema: 'invalid' }],
    [{ credentialPolicy: fail, overall: 'INVALID' }, { schema: 'invalid' }],
    [{ suspension: fail, overall: 'INVALID' }, { status: 'suspended' }],
    [{ revocation: fail, overall: 'INVALID' }, { status: 'revoked' }],
    [{ suspension: indeterminate, revocation: indeterminate, overall: 'INDETERMINATE' }, { status: 'indeterminate' }],
    [{ signature: { status: 'UNCHECKED' } }, { signature: null }],
    [{ signature: undefined }, { signature: null }],
    [{ schema: { status: 'pass' } }, { schema: null }],
    [{ revocation: undefined }, { status: null }],
    // Every part looks fine but the verifier did not say VALID: stricter, never valid.
    [{ time: fail, overall: 'INVALID' }, { schema: 'invalid' }],
    [{ overall: 'INDETERMINATE' }, { status: 'indeterminate' }],
    [{ overall: 'MAYBE' }, { signature: null }],
  ];
  for (const [patch, expected] of cases) {
    const mapped = toVerification(report(patch));
    for (const [field, value] of Object.entries(expected)) assert.equal(mapped[field], value, JSON.stringify(patch));
    const allValid = mapped.signature === 'valid' && mapped.schema === 'valid' && mapped.status === 'active';
    assert.equal(allValid, false, JSON.stringify(patch));
  }
  for (const body of [null, [], 'VALID', 7]) assert.equal(toVerification(body), null);
});

test('verification: 422 still carries a report; 404, 500, 503, bad JSON, timeout and a missing jws do not', async (t) => {
  const invalid = await stub(t, { 'POST /verify': [422, report({ schema: fail, overall: 'INVALID' })] });
  assert.equal((await asked(() => createVerificationSource({ baseUrl: invalid.url }).verify(candidate))).value.schema, 'invalid');
  for (const [route, outcome] of [[undefined, 'answered'], [[500, {}], 'source_unavailable'],
    [[503, { error: 'no_public_key_configured' }], 'source_unavailable'], ['invalid-json', 'contract_violation'], ['hang', 'timeout']]) {
    const upstream = await stub(t, route === undefined ? {} : { 'POST /verify': route });
    const result = await asked(() => createVerificationSource({ baseUrl: upstream.url, timeoutMs: 100 }).verify(candidate));
    assert.deepEqual(result, { value: null, outcome }, String(route));
  }
  const upstream = await stub(t, { 'POST /verify': [200, report()] });
  for (const bad of [{ credentialId: 'cred-1' }, { compactJws: 'a.b.c' }, null]) {
    assert.deepEqual(await asked(() => createVerificationSource({ baseUrl: upstream.url }).verify(bad)),
      { value: null, outcome: 'contract_violation' });
  }
  assert.equal(upstream.seen.length, 0);
});

// --- lifecycle origin

test('lifecycle origin is always uncheckable until certification-service offers a route (blocker 1)', async () => {
  assert.deepEqual(await asked(() => createLifecycleSource().isLifecycleOrigin(candidate)),
    { value: null, outcome: 'source_not_available' });
});

// --- credential mapper

function realIssued(evidencePatch = {}) {
  const { privateKey } = generateKeyPairSync('ed25519');
  const scores = { overallPercent: 88.5, tierPercents: { recall: 90, applied: 85, adversarial: 76.25 }, itemOutcomes: [] };
  const pkg = { id: 'ai-safety-fundamentals', version: '1.0.0', digest: 'sha256-package-1' };
  const evidence = {
    subjectId: 'agent/a b', subjectFingerprint: 'sha256:fp-a', packageId: pkg.id, packageVersion: pkg.version, mode: 'standard',
    scores, safetyResult: { passed: true, criticalViolationRuleIds: [], failureReasons: [] },
    examinationEvidence: { examinationId: 'exam-1', package: pkg, mode: 'standard', scores }, ...evidencePatch,
  };
  return issueCredential(evidence, { privateKey, keyId: 'test-key', now: () => '2026-09-18T00:00:00.000Z' });
}

test('toCandidate maps a credential exactly as certification-service issues it', () => {
  const issued = realIssued();
  assert.deepEqual(toCandidate(issued), {
    credentialId: issued.credentialId, agentLearnerKey: 'agent/a b', configurationFingerprint: 'sha256:fp-a',
    package: { id: 'ai-safety-fundamentals', version: '1.0.0', digest: 'sha256-package-1' },
    overallPercent: 88.5, adversarialPercent: 76.25, assessmentMode: 'standard', environment: null,
    validFrom: '2026-09-18T00:00:00.000Z', validUntil: '2027-09-18T00:00:00.000Z', compactJws: issued.compactJws,
  });
});

test('toCandidate maps every missing or unexpected field to null and never guesses', () => {
  const edit = (change) => { const issued = structuredClone(realIssued()); change(issued.credential, issued); return toCandidate(issued); };
  const fieldCases = [
    [(vc) => { vc.credentialSubject.configurationFingerprint = 7; }, 'configurationFingerprint'],
    [(vc) => { vc.credentialSubject.competency.scores.overallPercent = '88'; }, 'overallPercent'],
    [(vc) => { vc.credentialSubject.competency.scores.tierPercents = undefined; }, 'adversarialPercent'],
    [(vc) => { vc.credentialSubject.competency.result = 'fail'; }, 'overallPercent'],
    [(vc) => { vc.credentialSubject.competency.mode = 'live'; }, 'assessmentMode'],
    [(vc) => { vc.evidence.package.digest = undefined; }, 'package'],
    [(vc) => { vc.evidence.package.version = '9.9.9'; }, 'package'],
    [(vc) => { vc.credentialSubject.competency.packageId = undefined; }, 'package'],
    [(vc) => { vc.validUntil = 'soon'; }, 'validUntil'],
    [(vc) => { delete vc.validFrom; }, 'validFrom'],
    [(vc, record) => { record.compactJws = 'not-a-jws'; }, 'compactJws'],
  ];
  for (const [change, field] of fieldCases) assert.equal(edit(change)[field], null, field);
  assert.equal(edit(() => {}).environment, null);
  for (const change of [
    (vc) => { vc.credentialSubject.id = 'https://elsewhere.example/agents/agent-a'; },
    (vc) => { vc.id = 'https://eduagentx.example/credentials/another-id'; },
    (vc) => { vc.credentialSubject = null; },
    (vc, record) => { record.credentialId = ''; },
    (vc) => { vc.credentialSubject.id = `${vc.issuer}/agents/%E0%A4%A`; },
  ]) assert.equal(edit(change), null);
  for (const bad of [null, {}, { credentialId: 'x' }, { credentialId: 'x', credential: [] }]) assert.equal(toCandidate(bad), null);
});
