'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, generateKeyPairSync, createHash } = require('node:crypto');
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
      createCredential: (decisionId) => issueCredential(evidence, { privateKey, decisionId,
        keyId: 'https://eduagentx.example/issuers/eduagentx#pg-test' }) };
    const store = createPgStore(pool);
    const [first, competing] = await Promise.all([store.issue(input), store.issue(input)]);
    assert.deepEqual([first.replay, competing.replay].sort(), [false, true]);
    assert.equal(first.credential.credentialId, competing.credential.credentialId);
    const restarted = createPgStore(pool);
    const saved = await restarted.findByAttempt(attemptId);
    assert.equal(saved.credential.compactJws, first.credential.compactJws);
    const origin = await restarted.findOriginByCredential(first.credential.credentialId);
    assert.deepEqual(origin, { schemaVersion: 'certification-origin/1.0.0', outcome: 'certified',
      credentialId: first.credential.credentialId, decisionId: first.decisionId, examinationId: attemptId,
      subjectId: evidence.subjectId, configurationFingerprint: evidence.subjectFingerprint,
      credentialDigest: `sha256:${createHash('sha256').update(first.credential.compactJws).digest('hex')}` });
    assert.equal(first.credential.credential.evidence.certificationDecisionId, origin.decisionId);
    assert.equal(await restarted.findOriginByCredential(randomUUID()), null);
    const freshPool = new Pool({ connectionString: url });
    try {
      assert.deepEqual(await createPgStore(freshPool).findOriginByCredential(first.credential.credentialId), origin);
      const replay = await createPgStore(freshPool).issue({ ...input,
        evidence: { ...evidence, subjectId: 'conflicting-replay' },
        createCredential: () => { throw new Error('replay must not sign'); } });
      assert.equal(replay.replay, true);
      assert.equal(replay.credential.compactJws, first.credential.compactJws);
      assert.deepEqual(await createPgStore(freshPool).findOriginByCredential(first.credential.credentialId), origin);
    } finally { await freshPool.end(); }
    assert.deepEqual(await restarted.counts(), { decisions: 1, credentials: 1 });
    await assert.rejects(pool.query('UPDATE certification_engine.decisions SET package_version=$1 WHERE examination_id=$2',
      ['2.0.0', attemptId]), /immutable certification evidence/);
    await assert.rejects(pool.query('DELETE FROM certification_engine.credentials WHERE decision_id=$1',
      [first.decisionId]), /immutable certification evidence/);
  } finally { await pool.end(); }
});


test('PostgreSQL retains signed synthetic/replay provenance with exactly-once issuance after restart', { skip: !url }, async () => {
  const p = require('../../../packages/execution-provenance');
  const { fixture } = require('../../../packages/execution-provenance/test/fixtures');
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query(fs.readFileSync(path.resolve(__dirname, '../schema.sql'), 'utf8'));
    for (const mode of ['synthetic','replay']) {
      const f = fixture(mode, `pg-${mode}`), examinationId = randomUUID();
      const items = require('../../examination-engine/standard-generator').createStandardItems({ packageDigest: f.pkg.digest,
        template: f.pkg.examTemplate, objectives: f.pkg.objectives, modules: f.pkg.modules, sources: f.pkg.sources, rubric: f.pkg.rubric });
      const summary = { schemaVersion: 'certification-provenance/1.0.0', run: f.run,
        training: { eventId: f.completion.eventId, completionDigest: p.hash(f.completion), coverage: f.completion.executionCoverage },
        examination: p.coverage(f.run, 'examination', items.map(i=>i.id),
          items.map(i=>p.receipt(f.run, 'examination', i, examinationId).executionEvidence), examinationId) };
      const { privateKey } = generateKeyPairSync('ed25519');
      const evidence = { examinationId, subjectId: f.run.agentLearnerKey, subjectFingerprint: f.run.configurationFingerprint,
        packageId: f.run.package.id, packageVersion: f.run.package.version, packageDigest: f.run.package.digest,
        templateId: 'template', templateVersion: '1.0.0', templateDigest: p.hash('template'), rubricId: 'rubric', rubricVersion: '1.0.0',
        rubricDigest: p.hash('rubric'), mode: 'standard', scores: { overallPercent: 90, tierPercents: { recall: 90, applied: 90, adversarial: 90 }, itemOutcomes: items.map(i=>({itemId:i.id})) },
        safetyResult: { passed: true, criticalViolationRuleIds: [], failureReasons: [] }, examinationEvidence: { examinationId, package: f.run.package, provenanceProfile: p.RUN, provenance: summary }, provenance: summary,
        decidedAt: new Date().toISOString() };
      Object.assign(evidence.examinationEvidence, { mode: evidence.mode, scores: evidence.scores, safetyResult: evidence.safetyResult });
      const input = { evidence, commandKey: examinationId, commandDigest: p.hash(examinationId),
        createCredential: decisionId => issueCredential(evidence, { privateKey, decisionId, environment: 'simulation', keyId: 'test-key', issuer: 'https://test.example' }) };
      const first = await createPgStore(pool).issue(input);
      const fresh = new Pool({ connectionString: url });
      try {
        const restarted = createPgStore(fresh), saved = await restarted.findByAttempt(examinationId);
        assert.deepEqual(saved.evidence.provenance, summary);
        assert.equal(saved.credential.compactJws, first.credential.compactJws);
        assert.equal(saved.credential.credential.environment, 'simulation'); assert.equal(saved.credential.credential.evidenceMode, mode);
        assert.equal(p.credentialProvenance(saved.credential.credential), true);
        const retry = await restarted.issue({ ...input, evidence: { ...evidence, provenance: null },
          createCredential: () => { throw new Error('replay must not sign'); } });
        assert.equal(retry.credential.compactJws, first.credential.compactJws);
        const count = await fresh.query('SELECT count(*)::int AS n FROM certification_engine.credentials WHERE decision_id=$1', [first.decisionId]);
        assert.equal(count.rows[0].n, 1);
      } finally { await fresh.end(); }
    }
  } finally { await pool.end(); }
});
