'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src');
const { citedSources } = require('../src/reviews');
const candidate = require('../../curriculum-engine/examples/ai-safety-candidate');

const version = candidate.manifest.version;
const key = 'governance-test-key';
const headers = (subject, role = 'admin') => ({
  'content-type': 'application/json', 'x-internal-service-key': key,
  'x-actor-subject': subject, 'x-actor-role': role,
});
// Every rubric criterion scored the same: the review's weighted score is that value.
const scores = (value) => Object.fromEntries(candidate.rubric.criteria.map((criterion) => [criterion.id, value]));
// Every cited source confirmed: edition, licence and quotes.
const sourceChecks = Object.fromEntries(citedSources(candidate).map((id) => [id, { edition: true, licence: true, quotes: true }]));
const packageOf = (id) => {
  const pkg = structuredClone(candidate);
  pkg.manifest.packageId = id;
  return pkg;
};

test('governance requires authenticated independent reviewers and rejects a racing stale activation', async (t) => {
  const server = createApp({ internalKey: key }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body, actor = 'author', role = 'admin') => {
    const response = await fetch(`${base}${path}`, { method: 'POST', headers: headers(actor, role), body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const first = 'sprint2-governance-a';
  const second = 'sprint2-governance-b';
  const denied = await fetch(`${base}/packages/active`);
  assert.equal(denied.status, 403);
  for (const id of [first, second]) {
    assert.equal((await post('/packages', packageOf(id))).status, 201);
    const validated = await post('/validate', { package_id: id, version });
    assert.equal(validated.status, 200, JSON.stringify(validated.body));
    assert.equal(validated.body.gates.length, 6);
    assert.equal((await post('/review', { package_id: id, version, sourceChecks, criterionScores: scores(5), approved: true }, 'author', 'reviewer')).status, 403);
    assert.equal((await post('/review', { package_id: id, version, reviewer_id: 'forged', sourceChecks, criterionScores: scores(3.5), approved: true }, 'human-a', 'reviewer')).status, 200);
    assert.equal((await post('/review', { package_id: id, version, sourceChecks, criterionScores: scores(3.5), approved: true }, 'human-a', 'reviewer')).status, 409);
    const reviewed = await post('/review', { package_id: id, version, sourceChecks, criterionScores: scores(3.5), approved: true }, 'human-b', 'reviewer');
    assert.equal(reviewed.body.ready, true);
    assert.equal(reviewed.body.targetMet, false);
    const view = await fetch(`${base}/packages/${id}?version=${encodeURIComponent(version)}`, { headers: headers('operator') }).then(r => r.json());
    assert.deepEqual(view.reviews.map(review => review.reviewer_id).sort(), ['human-a', 'human-b']);
    assert.equal(JSON.stringify(view).includes('expectedAnswer'), false);
  }
  const activated = await Promise.all([first, second].map(id => post('/activate', { package_id: id, version })));
  assert.deepEqual(activated.map(result => result.status).sort(), [200, 409]);
  const active = await fetch(`${base}/packages/active`, { headers: headers('training-service') }).then(r => r.json());
  assert.equal([first, second].includes(active.packageId), true);
  assert.equal(active.sources.length, 5, 'internal Examination consumer receives source pins');
  assert.equal(active.sources.every(source => source.contentSha256 && source.edition), true);
  assert.equal(JSON.stringify(active).includes('expectedAnswer'), false);
});

test('PostgreSQL loss returns a bounded safe response instead of exposing errors or crashing', async (t) => {
  const app = createApp({ internalKey: key, packageDb: {
    listPackages: async () => { throw new Error('private database detail'); },
    getActivePackages: async () => { throw new Error('private database detail'); },
  } });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 503);
  const active = await fetch(`${base}/packages/active`, { headers: headers('training-service') });
  assert.equal(active.status, 503);
  assert.deepEqual(await active.json(), { error: 'dependency_unavailable' });
});

// A package store whose package is ready to activate except for what a test
// changes: validated, two approvals of its digest, nothing to resolve.
const DIGEST = 'd'.repeat(64);
const readyStore = (overrides = {}) => ({
  getPackage: async () => ({ ...packageOf('ready'), id: 'ready', version, state: 'AwaitingReview', digest: DIGEST }),
  getEvidence: async () => [{ event: 'validation_run', digest: DIGEST, result: { passed: true } }],
  getReviews: async () => ['human-a', 'human-b'].map((reviewer_id) => ({ reviewer_id, score: 4, approved: true, digest: DIGEST })),
  getResolutions: async () => [],
  appendEvidence: async () => {},
  ...overrides,
});

async function postTo(t, packageDb, path, body, role = 'admin') {
  const server = createApp({ internalKey: key, packageDb }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`,
    { method: 'POST', headers: headers('human-a', role), body: JSON.stringify(body) });
  return { status: response.status, text: await response.text() };
}

test('a failed activation names only a known precondition, never the store\'s own error text', async (t) => {
  const stale = await postTo(t, readyStore({ activatePackage: async () => { throw new Error('stale_candidate'); } }),
    '/activate', { package_id: 'ready', version });
  assert.deepEqual([stale.status, JSON.parse(stale.text)], [409, { error: 'activation_precondition_failed', reason: 'stale_candidate' }]);
  const broken = await postTo(t, readyStore({ activatePackage: async () => { throw new Error('relation "curriculum_engine.packages" does not exist'); } }),
    '/activate', { package_id: 'ready', version });
  assert.equal(broken.status, 503);
  assert.equal(broken.text.includes('relation'), false);
});

test('a disagreement can be resolved only while the package is awaiting review', async (t) => {
  const store = readyStore({ getPackage: async () => ({ ...packageOf('ready'), id: 'ready', version, state: 'Active', digest: DIGEST }),
    getReviews: async () => [{ reviewer_id: 'human-a', score: 5, approved: true, digest: DIGEST, criterionScores: { safety: 5 } },
      { reviewer_id: 'human-b', score: 3.5, approved: true, digest: DIGEST, criterionScores: { safety: 2 } }],
    addResolution: async () => { throw new Error('must not record a resolution'); } });
  const resolved = await postTo(t, store, '/review/resolutions', { package_id: 'ready', version, criterionId: 'safety', resolution: 'Agreed.' }, 'reviewer');
  assert.deepEqual([resolved.status, JSON.parse(resolved.text).error], [409, 'not_awaiting_review']);
});
