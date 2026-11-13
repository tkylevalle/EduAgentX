'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sourceFingerprint } = require('../src/fingerprint');

const stage = (path, blob) => `100644 ${blob.repeat(40).slice(0, 40)} 0\t${path}`;

test('the fingerprint is stable and ignores release records and evidence', () => {
  const base = [stage('a.js', '1'), stage('b.js', '2')];
  const withRecords = [...base, stage('docs/release/records/approval.json', '3'), stage('evidence/sprint-1/x.txt', '4')];
  assert.match(sourceFingerprint(base.join('\n')), /^[0-9a-f]{64}$/);
  assert.equal(sourceFingerprint(withRecords.join('\n')), sourceFingerprint(base.join('\n')));
  assert.equal(sourceFingerprint([...base].reverse().join('\n')), sourceFingerprint(base.join('\n')));
});

test('any source change changes the fingerprint', () => {
  assert.notEqual(sourceFingerprint(stage('a.js', '1')), sourceFingerprint(stage('a.js', '9')));
});
