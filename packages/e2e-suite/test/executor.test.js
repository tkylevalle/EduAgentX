'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { manifest, select, manifestHash } = require('../manifest');
const executor = require('../executor');
const execution = require('../../execution-provenance');
const { readPrincipals, MAX_BYTES } = require('../execution-bootstrap');
test('all frozen scenarios have explicit synthetic authority with a safe new remediation run', () => {
  assert.equal(manifestHash, 'sha256:c54705fbdc5a4ea51e00b8f3517a504d1a17019c085fa049a65f838df8c3abfd');
  const list = execution.enrollments(executor.principalsFor(manifest.scenarios));
  assert.equal(list.length, 1000);
  for (const s of manifest.scenarios) {
    const auth = execution.authority(list, { subject: s.clientId, role: 'agent' }, executor.profileFor(s));
    assert.equal(auth.evidenceMode, 'synthetic');
    assert.equal(auth.environment, 'simulation');
    assert.equal(execution.authority(list, { subject: s.clientId, role: 'agent' }).source.id, executor.SAFE);
    assert.equal(executor.profileFor(s, 'reexamination'), executor.SAFE);
  }
});
test('private preload supports 1000 explicit identities without broadening enrollment policy', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e33-enrollment-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const file = path.join(dir, 'principals.json');
  const rows = executor.principalsFor(manifest.scenarios);
  fs.writeFileSync(file, JSON.stringify(rows), { mode: 0o600 });
  assert.deepEqual(readPrincipals(file), rows);
  const bad = [[], [...rows, rows[0]], [{ ...rows[0], subject: '*' }], [{ ...rows[0], evidenceMode: 'live' }],
    [{ ...rows[0], sources: ['replay:reference-safe'] }], [{ ...rows[0], sources: ['synthetic:invented:safe'] }]];
  for (const value of bad) {
    fs.writeFileSync(file, JSON.stringify(value));
    assert.throws(() => readPrincipals(file), /invalid_private_execution_enrollment/);
  }
  fs.writeFileSync(file, ' '.repeat(MAX_BYTES + 1));
  assert.throws(() => readPrincipals(file));
  assert.throws(() => readPrincipals(dir));
});
test('private preload refuses an enrollment file reached through a symbolic link', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e33-enrollment-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const file = path.join(dir, 'principals.json');
  fs.writeFileSync(file, JSON.stringify(executor.principalsFor(manifest.scenarios)), { mode: 0o600 });
  assert.ok(readPrincipals(file).length);
  // The refusal itself, on every OS: a valid file that lstat reports as a link is refused.
  const lstat = fs.lstatSync;
  const stub = t.mock.method(fs, 'lstatSync', (target) => Object.assign(lstat(target), { isSymbolicLink: () => true }));
  assert.throws(() => readPrincipals(file), /invalid_private_execution_enrollment/);
  stub.mock.restore();
  // A real link too, where this OS user may create one (Windows needs Developer Mode or admin rights).
  const link = path.join(dir, 'link');
  try { fs.symlinkSync(file, link); } catch (e) { if (e.code !== 'EPERM') throw e; return t.diagnostic('real symbolic link not created: EPERM'); }
  assert.throws(() => readPrincipals(link), /invalid_private_execution_enrollment/);
});
test('pilot uses frozen mixed recipe without unsafe safe-escalation misclassification', () => {
  for (const s of select('developer')) {
    const profile = executor.profileFor(s);
    if (s.category === 'remediable') assert.equal(profile, 'synthetic:remediable:applied-low-effort-v1');
    if (s.category === 'competent') assert.equal(profile, executor.SAFE);
    if (s.category === 'adversarial') assert.ok(!profile.endsWith('safe-escalation'));
  }
});
