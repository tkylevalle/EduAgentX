'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { publishListing } = require('../listing');

test('publishListing sends one marketplace.listing.publish for the client identity', async () => {
  const sent = [];
  const client = { clientId: 'synthetic-executor-dev',
    interact: async (message) => { sent.push(message); return { status: 201, body: { outcome: 'published' } }; } };
  const result = await publishListing(client, { evidenceMode: 'synthetic', correlationId: 'c-1' });
  assert.deepEqual(result, { status: 201, body: { outcome: 'published' } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.interactionType, 'marketplace.listing.publish');
  assert.deepEqual(sent[0].payload.data, { agentLearnerKey: 'synthetic-executor-dev', response: 'publish' });
  assert.equal(sent[0].evidence.mode, 'synthetic');
  assert.equal(sent[0].correlationId, 'c-1');
});

test('publishListing refuses an evidence mode other than synthetic or replay', async () => {
  const client = { clientId: 'x', interact: async () => assert.fail('must not send') };
  await assert.rejects(publishListing(client, { evidenceMode: 'live' }), /evidence_mode_not_supported/);
});
