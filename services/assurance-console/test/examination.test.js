'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderExamination } = require('../index');

test('read-only examination view renders governing identifiers, escapes content and omits answers', () => {
  const html = renderExamination({ attemptId: 'attempt-1', status: 'in_progress', mode: 'standard',
    agentLearnerKey: '<script>alert(1)</script>', configurationFingerprint: 'fingerprint',
    package: { id: 'pkg', version: '1', digest: 'digest' },
    template: { id: 'template', version: '1', digest: 'template-digest' },
    rubric: { id: 'rubric', version: '1', digest: 'rubric-digest' },
    generationPolicySha256: 'policy-hash', trainingEventId: 'event-1', formDigest: 'form-hash',
    startedAt: '2026-10-12T06:00:00Z', deadlineAt: '2026-10-12T07:00:00Z',
    itemReferences: [{ id: 'item-1', slotId: 'r1', tier: 'recall', promptSha256: 'prompt-hash',
      prompt: 'RESTRICTED PROMPT', expectedAnswer: 'RESTRICTED ANSWER' }],
  });
  assert.match(html, /policy-hash/);
  assert.match(html, /item-1/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|RESTRICTED PROMPT|RESTRICTED ANSWER/);
});
