'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, generateKeyPairSync } = require('node:crypto');
const { Pool } = require('pg');
const { createPgStore } = require('../store');
const { issueCredential } = require('../evidence');

const url = process.env.CERTIFICATION_TEST_DATABASE_URL;
test('PostgreSQL persists one immutable decision and credential across concurrency and restart', { skip: !url }, async () => {
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query(fs.readFileSync(path.resolve(__dirname, '../schema.sql'), 'utf8'));
    const attemptId = randomUUID();
    const { privateKey } = generateKeyPairSync('ed25519');
    const evidence = { examinationId: attemptId, subjectId: 'pg-agent', subjectFingerprint: 'sha256:pg',
      packageId: 'pkg', packageVersion: '1.0.0', packageDigest: 'sha256:pkg',
      templateId: 'template', templateVersion: '1.0.0', templateDigest: 'sha256:template',
      rubricId: 'rubric', rubricVersion: '1.0.0',
      rubricDigest: 'sha256:rubric', mode: 'standard', scores: { overallPercent: 100 },
      safetyResult: { passed: true, criticalViolationRuleIds: [] },
      examinationEvidence: { examinationId: attemptId, completedAt: new Date().toISOString() },
      decidedAt: new Date().toISOString() };
    const input = { evidence, commandKey: `examination:${attemptId}`, commandDigest: 'digest',
      createCredential: () => issueCredential(evidence, { privateKey,
        keyId: 'https://eduagentx.example/issuers/eduagentx#pg-test' }) };
    const store = createPgStore(pool);
    const [first, competing] = await Promise.all([store.issue(input), store.issue(input)]);
    assert.deepEqual([first.replay, competing.replay].sort(), [false, true]);
    assert.equal(first.credential.credentialId, competing.credential.credentialId);
    const restarted = createPgStore(pool);
    const saved = await restarted.findByAttempt(attemptId);
    assert.equal(saved.credential.compactJws, first.credential.compactJws);
    assert.deepEqual(await restarted.counts(), { decisions: 1, credentials: 1 });
    await assert.rejects(pool.query('UPDATE certification_engine.decisions SET package_version=$1 WHERE examination_id=$2',
      ['2.0.0', attemptId]), /immutable certification evidence/);
    await assert.rejects(pool.query('DELETE FROM certification_engine.credentials WHERE decision_id=$1',
      [first.decisionId]), /immutable certification evidence/);
  } finally { await pool.end(); }
});
