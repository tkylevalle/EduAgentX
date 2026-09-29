const assert = require('node:assert/strict');
const test = require('node:test');

const { validateProtocolMessage } = require('../');
const { runProtocolConformanceSuite } = require('../conformance');

test('the conformance suite exercises valid and fail-closed messages through one adapter seam', async () => {
  const result = await runProtocolConformanceSuite({
    send: async (message) => {
      try {
        const validated = validateProtocolMessage(message);
        return {
          status: validated.messageType === 'registration' ? 201 : 202,
          body: {
            status: 'accepted',
            protocol: {
              protocol: validated.protocol,
              protocolVersion: validated.protocolVersion,
              messageId: validated.messageId,
              correlationId: validated.correlationId,
              evidence: validated.evidence,
            },
          },
        };
      } catch (error) {
        return { status: 400, body: { error: error.code, details: error.details } };
      }
    },
  });

  assert.equal(result.registration.status, 201);
  assert.equal(result.lifecycle.status, 202);
  assert.equal(result.invalidVersion.body.error, 'unsupported_protocol_version');
});
