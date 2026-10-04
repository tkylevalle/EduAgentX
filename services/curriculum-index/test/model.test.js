'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractChunks } = require('../model');
const samplePackage = require('../../curriculum-engine/examples/ai-safety-candidate');

test('extracts one chunk per module, tagged with package identity', () => {
  const chunks = extractChunks(samplePackage);
  assert.equal(chunks.length, 5);
  assert.equal(chunks[0].packageId, 'ai-safety-fundamentals');
  assert.equal(chunks[0].moduleId, 'm1');
  assert.ok(chunks[0].text.includes(samplePackage.modules[0].title));
});

test('chunk digests are deterministic for the same package content', () => {
  const first = extractChunks(samplePackage);
  const second = extractChunks(samplePackage);
  assert.deepEqual(first.map((c) => c.digest), second.map((c) => c.digest));
});

test('chunk digest changes if module content changes', () => {
  const pkg = structuredClone(samplePackage);
  pkg.modules[0].content = 'Completely different lesson content.';
  const changed = extractChunks(pkg);
  const original = extractChunks(samplePackage);
  assert.notEqual(changed[0].digest, original[0].digest);
});