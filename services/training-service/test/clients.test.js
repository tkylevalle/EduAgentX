'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {
  ContractError, SourceUnavailableError, createPackageSource, createRegistrySource, toPackageRecord, toRegistration,
} = require('../clients');

const activeBody = {
  packageId: 'pkg-a', digest: 'digest-1', version: '1.0.0', state: 'Active',
  objectives: [{ id: 'o1' }], modules: [{ id: 'm1' }],
  examTemplate: {}, fallbackBank: {}, rubric: {}, evidence: [{ event: 'activated' }],
};

// A stub upstream that answers each path from a table: [status, body] or 'invalid-json'.
async function stub(routes) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, correlationId: req.headers['x-correlation-id'] });
    const route = routes[req.url];
    if (!route) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"not_found"}'); }
    if (route === 'invalid-json') { res.writeHead(200); return res.end('not json'); }
    res.writeHead(route[0], { 'content-type': 'application/json' });
    return res.end(JSON.stringify(route[1]));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => new Promise((r) => server.close(r)) };
}

test('toPackageRecord maps the validation-activation response and keeps only objectives and modules', () => {
  assert.deepEqual(toPackageRecord(activeBody), {
    id: 'pkg-a', version: '1.0.0', state: 'Active', digest: 'digest-1',
    payload: { objectives: [{ id: 'o1' }], modules: [{ id: 'm1' }] },
  });
});

test('toPackageRecord fails closed on a missing digest, modules or identity instead of guessing', () => {
  for (const [field, value] of [['digest', null], ['modules', undefined], ['packageId', ''], ['state', undefined],
    ['version', undefined], ['objectives', undefined]]) {
    const body = { ...activeBody, [field]: value };
    assert.throws(() => toPackageRecord(body), (error) =>
      error instanceof ContractError && error.details.includes(field), field);
  }
});

test('package client reads the Active package, a package by id, and 404 as null', async (t) => {
  const upstream = await stub({ '/packages/active': [200, activeBody], '/packages/pkg-a': [200, { ...activeBody, id: 'pkg-a' }] });
  t.after(upstream.close);
  const source = createPackageSource({ baseUrl: upstream.url });
  assert.equal((await source.getActive({ correlationId: 'c-1' })).digest, 'digest-1');
  assert.equal((await source.getById('pkg-a')).id, 'pkg-a');
  assert.equal(await source.getById('missing'), null);
  assert.equal(upstream.seen[0].correlationId, 'c-1', 'the correlation ID is passed downstream');
});

test('package client treats a malformed Active package as a contract error', async (t) => {
  const upstream = await stub({ '/packages/active': [200, { ...activeBody, digest: null }] });
  t.after(upstream.close);
  await assert.rejects(createPackageSource({ baseUrl: upstream.url }).getActive(), ContractError);
});

test('package client reports 5xx, invalid JSON and a refused connection as unavailable', async (t) => {
  const upstream = await stub({ '/packages/active': [500, { error: 'boom' }], '/packages/x': 'invalid-json' });
  t.after(upstream.close);
  const source = createPackageSource({ baseUrl: upstream.url });
  await assert.rejects(source.getActive(), SourceUnavailableError);
  await assert.rejects(source.getById('x'), SourceUnavailableError);
  const closed = createPackageSource({ baseUrl: 'http://127.0.0.1:1' });
  await assert.rejects(closed.getActive(), SourceUnavailableError);
});

test('registry client maps the current configuration and returns null for an unknown Agent Learner', async (t) => {
  const upstream = await stub({
    '/v1/registrations?agentLearnerKey=learner-1': [200, { apiVersion: 'v1', registration: {
      agentLearnerKey: 'learner-1', configurationVersion: 2, configurationFingerprint: 'sha256:c2', status: 'active',
    } }],
    '/v1/registrations?agentLearnerKey=broken': [200, { registration: { agentLearnerKey: 'broken' } }],
  });
  t.after(upstream.close);
  const source = createRegistrySource({ baseUrl: upstream.url });
  assert.deepEqual(await source.getRegistration('learner-1'),
    { agentLearnerKey: 'learner-1', configurationFingerprint: 'sha256:c2', configurationVersion: 2 });
  assert.equal(await source.getRegistration('unknown'), null);
  await assert.rejects(source.getRegistration('broken'), ContractError);
  assert.throws(() => toRegistration({ registration: { agentLearnerKey: 'a', configurationFingerprint: 'f' } }), ContractError);
});
