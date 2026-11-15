'use strict';
// Publishes the client's own Marketplace listing, the step a certified agent
// takes before Marketplace can discover it. The Gateway checks the identity.
const { randomUUID } = require('node:crypto');
const { createLifecycleMessage } = require('../../packages/external-agent-protocol');

const PUBLISH_TIMEOUT_MS = 5000;
const LISTING_EVIDENCE_MODES = Object.freeze(['synthetic', 'replay']);

async function publishListing(client, { evidenceMode, correlationId = randomUUID() } = {}) {
  if (!LISTING_EVIDENCE_MODES.includes(evidenceMode)) throw new Error('evidence_mode_not_supported');
  return client.interact(createLifecycleMessage({
    messageId: `listing-publish-${randomUUID()}`, correlationId,
    idempotencyKey: `listing-publish-${randomUUID()}`, timeoutMs: PUBLISH_TIMEOUT_MS,
    evidence: { mode: evidenceMode },
    payload: { interactionType: 'marketplace.listing.publish',
      data: { agentLearnerKey: client.clientId, response: 'publish' } },
  }));
}

module.exports = { publishListing };
