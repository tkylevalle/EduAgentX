'use strict';
// Isolated technical demonstration. The two configured reviewer credentials
// are simulation identities, never evidence of independent human approval.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const candidate = require('../services/curriculum-engine/examples/ai-safety-candidate');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts', 'sprint2', 'live-smoke.json');
const local = Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)
  .filter(line => /^[A-Z][A-Z0-9_]*=/.test(line)).map(line => {
    const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)];
  }));
const gateway = `http://127.0.0.1:${local.GATEWAY_PORT || 8080}`;
const validation = `http://127.0.0.1:${local.VALIDATION_ACTIVATION_PORT || 4010}`;
const synthetic = `http://127.0.0.1:${local.SYNTHETIC_AGENT_PORT || 4200}`;
const report = { schemaVersion: '1.0.0', kind: 'technical-simulation-not-human-review',
  startedAt: new Date().toISOString(), status: 'running', steps: [] };
const step = (name, fields) => report.steps.push({ name, ...fields });
async function request(url, { method = 'GET', token, internal = false, body } = {}) {
  const response = await fetch(url, { method, signal: AbortSignal.timeout(15000), headers: {
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(internal ? { 'x-internal-service-key': local.CURRICULUM_INTERNAL_KEY, 'x-actor-subject': 'sprint2-technical-smoke' } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  return { status: response.status, data };
}
function expect(actual, wanted, label) {
  if (actual !== wanted) throw new Error(`${label}: expected ${wanted}, received ${actual}`);
}
async function token(id, secret) {
  const response = await request(`${gateway}/v1/auth/tokens`, { method: 'POST', body: { clientId: id, clientSecret: secret } });
  expect(response.status, 200, 'token');
  return response.data.accessToken;
}
function indexRequest(route, method = 'GET') {
  const js = `fetch('http://127.0.0.1:4003${route}',{method:'${method}',headers:{'x-internal-service-key':process.env.CURRICULUM_INTERNAL_KEY}}).then(async r=>console.log(JSON.stringify({status:r.status,data:await r.json()}))).catch(()=>process.exit(2))`;
  const result = spawnSync('docker', ['exec', 'eduagentx-curriculum-index', 'node', '-e', js], { encoding: 'utf8', timeout: 60000 });
  if (result.status !== 0) throw new Error(`index request failed: ${result.status}`);
  return JSON.parse(result.stdout.trim());
}
function docker(args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 60000 });
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed`);
}
async function main() {
  const reviewers = [1, 2].map(index => ({
    id: process.env[`SPRINT2_REVIEWER_${index}_ID`],
    secret: process.env[`SPRINT2_REVIEWER_${index}_SECRET`],
  }));
  if (reviewers.some(person => !person.id || !person.secret)) throw new Error('synthetic_reviewer_credentials_required');
  const admin = await token(local.ADMIN_CLIENT_ID, local.ADMIN_CLIENT_SECRET);
  const reviewerTokens = await Promise.all(reviewers.map(person => token(person.id, person.secret)));
  const id = `ai-safety-s2-${randomUUID().slice(0, 8)}`;
  const pkg = structuredClone(candidate);
  pkg.manifest.packageId = id;
  const prior = await request(`${validation}/packages/active`, { internal: true });
  if (prior.status === 200) pkg.manifest.predecessor = { packageId: prior.data.packageId, version: prior.data.version };
  else if (prior.status !== 404) throw new Error('active_pointer_unavailable');
  report.packageId = id;
  report.packageVersion = pkg.manifest.version;
  const unauth = await request(`${gateway}/v1/admin/curriculum/packages`, { method: 'POST', body: pkg });
  expect(unauth.status, 401, 'unauthenticated ingestion');
  step('unauthenticated_ingestion_blocked', { status: unauth.status });
  const ingested = await request(`${gateway}/v1/admin/curriculum/packages`, { method: 'POST', token: admin, body: pkg });
  expect(ingested.status, 201, 'ingestion');
  report.packageDigest = ingested.data.digest;
  step('candidate_ingested', { status: ingested.status, digest: ingested.data.digest });
  const validated = await request(`${gateway}/v1/admin/curriculum/validate`, { method: 'POST', token: admin,
    body: { package_id: id, version: pkg.manifest.version } });
  expect(validated.status, 200, 'validation');
  if (!validated.data.passed || validated.data.gates?.length !== 6) throw new Error('six_gate_validation_failed');
  step('six_gates', { passed: validated.data.gates.map(gate => gate.name) });
  for (const [index, reviewerToken] of reviewerTokens.entries()) {
    const reviewed = await request(`${gateway}/v1/curriculum/review`, { method: 'POST', token: reviewerToken,
      body: { package_id: id, version: pkg.manifest.version, reviewer_id: 'ignored-forgery', score: index ? 4.5 : 4,
        approved: true } });
    expect(reviewed.status, 200, 'review');
    step(`synthetic_reviewer_${index + 1}`, { status: reviewed.status, approvals: reviewed.data.approvals,
      mean: reviewed.data.mean });
  }
  const activated = await request(`${gateway}/v1/admin/curriculum/activate`, { method: 'POST', token: admin,
    body: { package_id: id, version: pkg.manifest.version } });
  expect(activated.status, 200, 'activation');
  step('technical_activation', { status: activated.status, supersededId: activated.data.superseded_id });
  const active = await request(`${validation}/packages/active`, { internal: true });
  expect(active.status, 200, 'active package');
  if (active.data.packageId !== id || active.data.digest !== report.packageDigest ||
      JSON.stringify(active.data).includes('expectedAnswer')) throw new Error('active_package_contract_failed');
  step('active_package', { packageId: active.data.packageId, version: active.data.version,
    moduleCount: active.data.modules.length, answersExposed: false });
  const first = await request(`${synthetic}/v1/training-runs`, { method: 'POST', body: { maxItems: 1 } });
  expect(first.status, 200, 'training partial');
  if (first.data.outcome !== 'open' || first.data.completedItems.length !== 1) throw new Error('training_partial_failed');
  step('training_partial', { sessionId: first.data.sessionId, itemCount: first.data.completedItems.length });
  const resumed = await request(`${synthetic}/v1/training-runs`, { method: 'POST',
    body: { resumeSessionId: first.data.sessionId, maxItems: 20 } });
  expect(resumed.status, 200, 'training resume');
  if (resumed.data.outcome !== 'completed' || resumed.data.completedItems.length !== 9)
    throw new Error('training_completion_failed');
  step('training_resumed_completed', { sessionId: resumed.data.sessionId,
    remainingItems: resumed.data.completedItems.length, moduleIds: [...new Set(resumed.data.completedItems.map(item => item.moduleId))] });
  const rebuilt = indexRequest('/internal/index/rebuild', 'POST');
  expect(rebuilt.status, 200, 'index rebuild');
  step('index_rebuilt', { chunkCount: rebuilt.data.chunkCount });
  let chromaStopped = false;
  try {
    docker(['stop', 'eduagentx-chromadb']); chromaStopped = true;
    const cached = indexRequest('/internal/index/query?text=Tool%20Misuse');
    expect(cached.status, 200, 'index cache');
    if (cached.data.mode !== 'cached-stale' || !cached.data.results.some(item => item.moduleId === 'm4'))
      throw new Error('cached_content_not_verified');
    step('chroma_loss_verified_cache', { mode: cached.data.mode, moduleIds: cached.data.results.map(item => item.moduleId) });
  } finally { if (chromaStopped) docker(['start', 'eduagentx-chromadb']); }
  const refresh = await request(`${validation}/packages/${id}/freshness-checks`, { method: 'POST', internal: true,
    body: { sourceId: 'nist-rmf', evidence: { observedAt: new Date().toISOString(),
      evidenceUrl: 'https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.100-1.pdf', snapshotReference: 'technical-simulation',
      contentSha256: 'b'.repeat(64), changeKind: 'material', summary: 'Synthetic substantive source change' } } });
  expect(refresh.status, 200, 'substantive refresh');
  if (refresh.data.classification !== 'Substantive' || refresh.data.candidatePackage?.packageId === id)
    throw new Error('separate_candidate_not_created');
  step('substantive_candidate', { candidateId: refresh.data.candidatePackage.packageId,
    classification: refresh.data.classification });
  const preserved = await request(`${validation}/packages/active`, { internal: true });
  if (preserved.data.packageId !== id) throw new Error('active_package_changed_during_refresh');
  step('active_preserved', { packageId: preserved.data.packageId });
  const critical = await request(`${validation}/packages/${id}/freshness-checks`, { method: 'POST', internal: true,
    body: { sourceId: 'owasp-agentic', scope: { type: 'delivery_item', id: 'm4-lesson-1' },
      evidence: { observedAt: new Date().toISOString(), evidenceUrl: 'https://genai.owasp.org/download/52117/',
        snapshotReference: 'technical-critical-simulation', contentSha256: 'c'.repeat(64),
        changeKind: 'critical', summary: 'Synthetic critical correction' } } });
  expect(critical.status, 202, 'critical quarantine');
  step('critical_scope_quarantined', { classification: critical.data.classification, scope: critical.data.quarantinedScope });
  const blocked = await request(`${validation}/fallback/select`, { method: 'POST', internal: true,
    body: { package_id: id, reason: 'standard_generation_unavailable' } });
  expect(blocked.status, 409, 'fallback quarantine refusal');
  step('fallback_blocked_on_quarantine', { status: blocked.status, error: blocked.data.error });
  const filtered = indexRequest('/internal/index/query?text=Tool%20Misuse');
  expect(filtered.status, 200, 'quarantine index filtering');
  const filteredIds = filtered.data.mode === 'live' ? filtered.data.results.ids.flat() :
    filtered.data.results.map(item => item.chunkId);
  if (filteredIds.some(item => item.endsWith(':m4'))) throw new Error('quarantined_content_leaked');
  step('quarantined_content_excluded', { mode: filtered.data.mode, resultCount: filteredIds.length });
  let pgStopped = false;
  try {
    docker(['stop', 'eduagentx-postgres']); pgStopped = true;
    const health = await request(`${validation}/health`);
    expect(health.status, 503, 'validation health during postgres loss');
    const unavailable = await request(`${validation}/packages/active`, { internal: true });
    expect(unavailable.status, 503, 'active package during postgres loss');
    const noTrust = indexRequest('/internal/index/query?text=Tool%20Misuse');
    expect(noTrust.status, 503, 'index query during postgres loss');
    step('postgres_loss_fails_closed', { health: health.status, activeRead: unavailable.status,
      indexQuery: noTrust.status });
  } finally { if (pgStopped) docker(['start', 'eduagentx-postgres']); }
  report.status = 'technical_pass';
}
main().catch(error => { report.status = 'failed'; report.error = error.message; process.exitCode = 1; })
  .finally(() => {
    report.completedAt = new Date().toISOString();
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ status: report.status, steps: report.steps.map(item => item.name),
      error: report.error || null, output })}\n`);
  });
