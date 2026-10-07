'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFakePackageSource, createFakeRegistrySource } = require('../sources');

test('fake PackageSource returns only the Active package from getActive and copies of records', async () => {
  const source = createFakePackageSource([
    { id: 'old', version: '1.0.0', state: 'Superseded', payload: { n: 1 } },
    { id: 'new', version: '1.1.0', state: 'Active', payload: { n: 2 } },
  ]);
  assert.equal((await source.getActive()).id, 'new');
  assert.equal((await source.getById('old')).state, 'Superseded');
  assert.equal(await source.getById('missing'), null);

  const copy = await source.getById('new');
  copy.payload.n = 99;
  assert.equal((await source.getById('new')).payload.n, 2, 'callers cannot mutate the source');

  source.setState('new', 'Quarantined');
  assert.equal(await source.getActive(), null);
});

test('fake RegistrySource returns registrations by key and null for an unknown Agent Learner', async () => {
  const source = createFakeRegistrySource([
    { agentLearnerKey: 'a', configurationFingerprint: 'sha256:1', configurationVersion: 1 },
  ]);
  assert.equal((await source.getRegistration('a')).configurationFingerprint, 'sha256:1');
  assert.equal(await source.getRegistration('b'), null);
  source.setFingerprint('a', 'sha256:2');
  assert.deepEqual(await source.getRegistration('a'),
    { agentLearnerKey: 'a', configurationFingerprint: 'sha256:2', configurationVersion: 2 });
});
