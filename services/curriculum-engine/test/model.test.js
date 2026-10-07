'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sha256, validatePackage } = require('../model');
const sample = require('../examples/ai-safety-candidate');

const copy = () => structuredClone(sample);
const hasError = (errors, prefix) => errors.some(({ path }) => path.startsWith(prefix));

test('five-source candidate has complete pinned artifacts and objective delivery links', () => {
  assert.deepEqual(validatePackage(copy()), []);
});

test('a source change cannot reuse a manifest pin', () => {
  const pkg = copy();
  pkg.sources[0].contentSha256 = '0'.repeat(64);
  assert.ok(hasError(validatePackage(pkg), 'manifest.sourcePins'));
});

test('a matching pin does not make an arbitrary source identity official', () => {
  for (const [field, value] of Object.entries({
    issuer: 'Unverified Publisher',
    documentIdentifier: 'unverified-1',
    canonicalUrl: 'https://example.invalid/unverified',
    snapshotUrl: 'https://example.invalid/unverified.pdf',
  })) {
    const pkg = copy();
    pkg.sources[0][field] = value;
    pkg.manifest.sourcePins[0].sha256 = sha256(pkg.sources[0]);
    assert.ok(hasError(validatePackage(pkg), 'sources[0]'), field);
  }
});

test('a matching pin cannot replace a measured official snapshot digest', () => {
  const pkg = copy();
  pkg.sources[0].contentSha256 = '0'.repeat(64);
  pkg.manifest.sourcePins[0].sha256 = sha256(pkg.sources[0]);
  assert.ok(hasError(validatePackage(pkg), 'sources[0]'));
});

test('Candidate provenance cannot self-declare independent approval', () => {
  const pkg = copy();
  pkg.sources[0].verificationStatus = 'approved';
  pkg.manifest.sourcePins[0].sha256 = sha256(pkg.sources[0]);
  assert.ok(hasError(validatePackage(pkg), 'sources[0]'));
});

test('claims without exact source pinpoint and objectives without delivery links fail closed', () => {
  const pkg = copy();
  pkg.modules[0].claims[0].pinpoint = '';
  pkg.objectives[0].deliveryItemIds = [];
  const errors = validatePackage(pkg);
  assert.ok(hasError(errors, 'modules[0].claims'));
  assert.ok(hasError(errors, 'objectives[0]'));
});

test('only Candidate may be ingested', () => {
  const pkg = copy();
  pkg.manifest.state = 'Active';
  assert.ok(hasError(validatePackage(pkg), 'manifest.state'));
});

test('safety-critical objective needs an adversarial slot and rubric rule', () => {
  const pkg = copy();
  pkg.objectives[2].criticalViolationRuleIds = [];
  assert.ok(hasError(validatePackage(pkg), 'objectives[2].examSlotIds'));
});

test('objective delivery link must resolve to a real immutable lesson', () => {
  const pkg = copy();
  pkg.objectives[0].deliveryItemIds = ['missing-lesson'];
  assert.ok(hasError(validatePackage(pkg), 'objectives[0].deliveryItemIds'));
});

test('each module has a lesson and a practice item, and its objective links both', () => {
  for (const [index, module] of sample.modules.entries()) {
    assert.deepEqual(module.deliveryItems.map((item) => [item.id, item.kind]),
      [[`${module.id}-lesson-1`, 'lesson'], [`${module.id}-practice-1`, 'practice']]);
    assert.match(module.deliveryItems[1].text, /^Practice: /);
    assert.equal(module.deliveryItems.map((item) => item.text).join(' '), module.content);
    assert.deepEqual(sample.objectives[index].deliveryItemIds, module.deliveryItems.map((item) => item.id));
  }
});

test('a delivery item kind other than lesson or practice fails closed', () => {
  const pkg = copy();
  pkg.modules[0].deliveryItems[1].kind = 'quiz';
  pkg.modules[0].contentSha256 = sha256({ content: pkg.modules[0].content, deliveryItems: pkg.modules[0].deliveryItems });
  assert.ok(hasError(validatePackage(pkg), 'modules[0].deliveryItems'));
});

test('Curriculum Track cannot repeat one module while omitting the others', () => {
  const pkg = copy();
  pkg.curriculumTrack.moduleIds = Array(5).fill('m1');
  pkg.manifest.curriculumTrackPin.sha256 = sha256(pkg.curriculumTrack);
  assert.ok(hasError(validatePackage(pkg), 'curriculumTrack.moduleIds'));
});
