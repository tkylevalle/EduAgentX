'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src');
const candidate = require('../../curriculum-engine/examples/ai-safety-candidate');

const version = candidate.manifest.version;
const key = 'governance-test-key';
const headers = (subject, role = 'admin') => ({
  'content-type': 'application/json', 'x-internal-service-key': key,
  'x-actor-subject': subject, 'x-actor-role': role,
});
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
    assert.equal((await post('/review', { package_id: id, version, score: 5, approved: true }, 'author', 'reviewer')).status, 403);
    assert.equal((await post('/review', { package_id: id, version, reviewer_id: 'forged', score: 3.5, approved: true }, 'human-a', 'reviewer')).status, 200);
    assert.equal((await post('/review', { package_id: id, version, score: 3.5, approved: true }, 'human-a', 'reviewer')).status, 409);
    const reviewed = await post('/review', { package_id: id, version, score: 3.5, approved: true }, 'human-b', 'reviewer');
    assert.equal(reviewed.body.ready_to_activate, true);
    assert.equal(reviewed.body.target_met, false);
    const view = await fetch(`${base}/packages/${id}?version=${encodeURIComponent(version)}`, { headers: headers('operator') }).then(r => r.json());
    assert.deepEqual(view.reviews.map(review => review.reviewer_id).sort(), ['human-a', 'human-b']);
    assert.equal(JSON.stringify(view).includes('expectedAnswer'), false);
  }
  const activated = await Promise.all([first, second].map(id => post('/activate', { package_id: id, version })));
  assert.deepEqual(activated.map(result => result.status).sort(), [200, 409]);
  const active = await fetch(`${base}/packages/active`, { headers: headers('training-service') }).then(r => r.json());
  assert.equal([first, second].includes(active.packageId), true);
  assert.equal(JSON.stringify(active).includes('expectedAnswer'), false);
});

test('PostgreSQL loss returns a bounded safe response instead of exposing errors or crashing', async (t) => {
  const app = createApp({ internalKey: key, packageDb: {
    listPackages: async () => { throw new Error('private database detail'); },
    getActivePackage: async () => { throw new Error('private database detail'); },
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
