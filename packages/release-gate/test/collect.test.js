'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runReleaseGate } = require('../src');

function repository(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-gate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'core.autocrlf', 'false');
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  git('add', '-A');
  git('-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', 'fixture');
  return { root, git };
}

test('a real repository is read, scanned and blocked on missing records', (t) => {
  const { root } = repository(t, {
    'src/app.js': 'module.exports = 1;\n',
    '.env.example': 'ADMIN_CLIENT_SECRET=reused-demo-password\n',
    'docs/release/records/broken.json': '{ not json',
  });
  const result = runReleaseGate(root);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.scannedFiles, 3);
  assert.match(result.fingerprint, /^[0-9a-f]{64}$/);
  assert.ok(result.blockers.includes('records: broken.json: invalid JSON'));
  assert.ok(result.blockers.includes('secret scan: .env.example:1 non-placeholder-secret'));
  assert.ok(result.blockers.includes('approval: no record'));
  assert.ok(result.blockers.includes('limitations: docs/release/limitations.md not found'));
  assert.ok(!result.blockers.some((blocker) => blocker.startsWith('source:')));
});

test('uncommitted changes block, and a new record does not change the fingerprint', (t) => {
  const { root, git } = repository(t, { 'src/app.js': 'module.exports = 1;\n' });
  const before = runReleaseGate(root).fingerprint;
  fs.writeFileSync(path.join(root, 'src/app.js'), 'module.exports = 2;\n');
  assert.ok(runReleaseGate(root).blockers.includes('source: working tree has uncommitted changes'));
  git('checkout', '--', 'src/app.js');
  fs.mkdirSync(path.join(root, 'docs/release/records'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/release/records/incidents.json'), '{"type":"incidents"}');
  git('add', '-A');
  git('-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', 'record');
  assert.equal(runReleaseGate(root).fingerprint, before);
});

test('an existing evidence pack and a real commit are accepted', (t) => {
  const { root, git } = repository(t, { 'src/app.js': '1', 'evidence/sprint-1/README.md': 'pack' });
  const commit = git('rev-parse', 'HEAD').trim();
  fs.mkdirSync(path.join(root, 'docs/release/records'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/release/records/sprint-1.json'), JSON.stringify({ type: 'sprint-pass', sprint: 1,
    evidencePack: 'evidence/sprint-1', sourceCommit: commit, passedAt: '2026-05-01T00:00:00Z', approvedBy: ['team'], waivers: [] }));
  git('add', '-A');
  git('-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '-m', 'record');
  // git rev-parse reports C:/... with forward slashes on Windows.
  const blockers = runReleaseGate(root.split(path.sep).join('/')).blockers;
  assert.ok(blockers.includes('sprint 2: no pass record'));
  assert.ok(!blockers.some((blocker) => blocker.startsWith('sprint 1:')), blockers.join(' | '));
});

test('a file too large to scan is reported, not skipped', (t) => {
  const { root } = repository(t, { 'src/app.js': '1', 'data/huge.txt': 'x'.repeat(2 * 1024 * 1024 + 1) });
  assert.ok(runReleaseGate(root).blockers.includes('secret scan: data/huge.txt too-large-to-scan'));
});

test('a large binary file is not reported as unscanned text', (t) => {
  const { root } = repository(t, { 'src/app.js': '1', 'docs/deck.pptx': Buffer.concat([Buffer.from([0x50, 0x4b, 0]), Buffer.alloc(3 * 1024 * 1024)]) });
  assert.ok(!runReleaseGate(root).blockers.some((blocker) => blocker.includes('deck.pptx')));
});

test('evidence pack paths cannot escape the repository', (t) => {
  const { root } = repository(t, {
    'src/app.js': '1',
    'docs/release/records/sprint-1.json': JSON.stringify({ type: 'sprint-pass', sprint: 1, evidencePack: '../outside',
      sourceCommit: 'a'.repeat(40), passedAt: '2026-05-01T00:00:00Z', approvedBy: ['team'] }),
  });
  assert.ok(runReleaseGate(root).blockers.includes('sprint 1: evidence pack ../outside not found'));
});
