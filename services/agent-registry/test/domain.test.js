const assert = require('node:assert/strict');
const test = require('node:test');

const {
  computeConfigurationFingerprint,
  normalizeRegistrationRequest,
  validateRegistrationRequest,
} = require('../domain');

const validRequest = {
  agentLearnerKey: 'synthetic-agent-1',
  model: { provider: 'synthetic', version: '1.0.0' },
  systemPromptHash: 'sha256:system-prompt-v1',
  approvedToolManifest: [
    { name: 'z-tool', version: '2.0.0' },
    { name: 'a-tool', version: '1.0.0', permissions: ['read'] },
  ],
  policyConfigurationHash: 'sha256:policy-v1',
  adapterVersion: '1.0.0',
};

test('valid registration input normalizes the model and tool manifest', () => {
  const result = validateRegistrationRequest(validRequest);

  assert.equal(result.valid, true);
  assert.deepEqual(result.value.model, { provider: 'synthetic', version: '1.0.0' });
  assert.deepEqual(
    result.value.approvedToolManifest.map((tool) => tool.name),
    ['a-tool', 'z-tool']
  );
});

test('configuration fingerprint is stable across object and manifest ordering', () => {
  const first = normalizeRegistrationRequest(validRequest);
  const second = normalizeRegistrationRequest({
    adapterVersion: '1.0.0',
    policyConfigurationHash: 'sha256:policy-v1',
    approvedToolManifest: [
      { permissions: ['read'], name: 'a-tool', version: '1.0.0' },
      { version: '2.0.0', name: 'z-tool' },
    ],
    systemPromptHash: 'sha256:system-prompt-v1',
    model: { version: '1.0.0', provider: 'synthetic' },
    agentLearnerKey: 'different-agent',
  });

  assert.equal(computeConfigurationFingerprint(first), computeConfigurationFingerprint(second));
  assert.match(computeConfigurationFingerprint(first), /^sha256:[0-9a-f]{64}$/);
});

test('material configuration input changes the fingerprint', () => {
  const original = normalizeRegistrationRequest(validRequest);
  const changed = normalizeRegistrationRequest({
    ...validRequest,
    model: { provider: 'synthetic', version: '1.0.1' },
  });

  assert.notEqual(
    computeConfigurationFingerprint(original),
    computeConfigurationFingerprint(changed)
  );
});

test('invalid registration input identifies missing fields and rejects caller fingerprints', () => {
  const missing = validateRegistrationRequest({ agentLearnerKey: 'agent-1' });
  const clientFingerprint = validateRegistrationRequest({
    ...validRequest,
    fingerprint: 'sha256:client-chosen',
  });

  assert.equal(missing.valid, false);
  assert.ok(missing.errors.some((error) => error.field.startsWith('model.')));
  assert.ok(missing.errors.some((error) => error.field === 'systemPromptHash'));
  assert.equal(clientFingerprint.valid, false);
  assert.ok(clientFingerprint.errors.some((error) => error.code === 'server_owned_field'));
});
