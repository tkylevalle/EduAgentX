'use strict';

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const reference = require('./reference');
const remediable = require('./remediable-v1');
const POLICY = 'reference-execution/1.0.0';
const RUN = 'execution-provenance/1.0.0';
const RECEIPT = 'execution-receipt/1.0.0';
const COVERAGE = 'execution-coverage/1.0.0';
const SCHEMA = require('./credential.schema.json').$id;
// Synthetic and replay credentials are signed only under this test issuer.
const SIMULATION_ISSUER = 'https://eduagentx.example/issuers/eduagentx-test';
const REPLAY_REVIEW = 'execution-replay-review/1.0.0';
const REQUIRED_FIXTURE_REVIEWS = 2;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^sha256:[0-9a-f]{64}$/;
const text = (v) => typeof v === 'string' && v.length > 0 && v.length <= 256;
const object = (v) => Boolean(v && typeof v === 'object' && !Array.isArray(v));
const canonical = (v) => Array.isArray(v) ? v.map(canonical) : object(v)
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;
const hash = (v) => `sha256:${createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex')}`;
const responseHash = (v) => `sha256:${createHash('sha256').update(v).digest('hex')}`;
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const exact = (v, keys) => object(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const fail = (code = 'provenance_conflict', status = 409) => Object.assign(new Error(code), { code, status });
function pair(environment, mode) {
  return (environment === 'simulation' && ['synthetic', 'replay'].includes(mode)) ||
    (environment === 'live' && mode === 'live');
}

const referenceDigest = responseHash(fs.readFileSync(`${__dirname}/reference.js`, 'utf8'));
const remediableDigest = responseHash(fs.readFileSync(`${__dirname}/remediable-v1.js`, 'utf8'));
let replay;
function replayManifest() {
  if (!replay) {
    const m = JSON.parse(fs.readFileSync(`${__dirname}/replay.json`, 'utf8'));
    if (m.schemaVersion !== 'execution-replay/1.0.0' || m.id !== 'reference-safe' || m.version !== '1.0.0' ||
        !Array.isArray(m.entries) || !m.entries.length || new Set(m.entries.map((e) => e.id)).size !== m.entries.length ||
        new Set(m.entries.map((e) => `${e.phase}:${e.requestHash}`)).size !== m.entries.length ||
        m.entries.some((e) => !text(e.id) || !['training','examination'].includes(e.phase) || !HASH.test(e.requestHash) ||
          typeof e.response !== 'string' || e.responseDigest !== responseHash(e.response) || !text(e.capture?.framework) ||
          !text(e.capture?.promptTemplateVersion) || !text(e.capture?.fixtureVersion) ||
          !Number.isFinite(Date.parse(e.capture?.capturedAt)) || !text(e.capture?.sanitization)))
      throw new Error('invalid reference replay manifest');
    replay = m;
  }
  return replay;
}
// A review counts only for the exact manifest digest it names, so editing a
// fixture voids earlier reviews. The person who captured it cannot review it.
function replayReviewed(record, digest = source('replay:reference-safe').digest) {
  if (record?.schemaVersion !== REPLAY_REVIEW || !text(record.capturedBy) || !Array.isArray(record.reviews)) return false;
  const reviewers = record.reviews.filter((r) => text(r?.reviewer) && r.digest === digest &&
    Number.isFinite(Date.parse(r.reviewedAt))).map((r) => r.reviewer.toLowerCase());
  const distinct = new Set(reviewers);
  distinct.delete(record.capturedBy.toLowerCase());
  return distinct.size >= REQUIRED_FIXTURE_REVIEWS;
}
function loadReplayReview() { return JSON.parse(fs.readFileSync(`${__dirname}/replay.review.json`, 'utf8')); }
function issuerPermits(environment, issuer) {
  if (environment === 'simulation') return issuer === SIMULATION_ISSUER;
  return environment === 'live' && text(issuer) && issuer !== SIMULATION_ISSUER;
}
function source(id) {
  if (id === 'replay:reference-safe') {
    const m = replayManifest();
    return { id, version: m.version, digest: hash(m) };
  }
  const parts = typeof id === 'string' ? id.split(':') : [];
  if (parts.length !== 3 || parts[0] !== 'synthetic' || !reference.getSyntheticProfile(parts[1]) ||
      (!reference.listExamScenarios().includes(parts[2]) && id !== remediable.ID)) throw fail('source_not_supported');
  return { id, version: '1.0.0', digest: hash({ id, version: '1.0.0', referenceDigest,
    ...(id === remediable.ID ? { recipeDigest: remediableDigest, recipeVersion: remediable.VERSION } : {}) }) };
}
function sourceMode(s) { return s?.id?.startsWith('synthetic:') ? 'synthetic' : s?.id === 'replay:reference-safe' ? 'replay' : null; }
function validSource(s) {
  try { return exact(s, ['id', 'version', 'digest']) && same(s, source(s.id)); } catch { return false; }
}

// This configuration is read by the Gateway, never merged with request JSON.
function enrollments(value = process.env.EXECUTION_PRINCIPALS || '[]', { replayReview = loadReplayReview() } = {}) {
  const list = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(list)) throw new Error('invalid execution enrollment');
  const ids = new Set();
  for (const e of list) {
    if (!exact(e, ['subject', 'evidenceMode', 'sources']) || !text(e.subject) || ids.has(e.subject) ||
        !['synthetic', 'replay'].includes(e.evidenceMode) || !Array.isArray(e.sources) || !e.sources.length ||
        new Set(e.sources).size !== e.sources.length || e.sources.some((id) => sourceMode(source(id)) !== e.evidenceMode))
      throw new Error('invalid or unsupported execution enrollment');
    if (e.evidenceMode === 'replay' && !replayReviewed(replayReview))
      throw new Error(`replay enrollment needs ${REQUIRED_FIXTURE_REVIEWS} recorded fixture reviews`);
    ids.add(e.subject);
  }
  return structuredClone(list);
}
function authority(list, auth, selected) {
  const e = auth?.role === 'agent' && list.find((v) => v.subject === auth.subject);
  if (!e) { if (selected) throw fail('executor_not_authorized', 403); return null; }
  const id = selected || e.sources[0];
  if (!e.sources.includes(id)) throw fail('executor_not_authorized', 403);
  return { schemaVersion: 'execution-authority/1.0.0', executorId: auth.subject, policyVersion: POLICY,
    environment: 'simulation', evidenceMode: e.evidenceMode, source: source(id) };
}
function validAuthority(a) {
  return exact(a, ['schemaVersion','executorId','policyVersion','environment','evidenceMode','source']) &&
    a.schemaVersion === 'execution-authority/1.0.0' && text(a.executorId) && a.policyVersion === POLICY &&
    pair(a.environment, a.evidenceMode) && a.environment === 'simulation' && validSource(a.source) && sourceMode(a.source) === a.evidenceMode;
}
function bindRun(a, { sessionId, agentLearnerKey, configurationFingerprint, configurationVersion, package: pkg }) {
  if (!validAuthority(a) || a.executorId !== agentLearnerKey) throw fail();
  const run = { schemaVersion: RUN, runId: sessionId, agentLearnerKey, configurationFingerprint, configurationVersion,
    package: pkg, executorId: a.executorId, policyVersion: a.policyVersion, environment: a.environment,
    evidenceMode: a.evidenceMode, source: a.source };
  if (!validRun(run)) throw fail();
  return structuredClone(run);
}
function validRun(r, catalog = true) {
  return exact(r, ['schemaVersion','runId','agentLearnerKey','configurationFingerprint','configurationVersion','package',
    'executorId','policyVersion','environment','evidenceMode','source']) && r.schemaVersion === RUN && UUID.test(r.runId) &&
    text(r.agentLearnerKey) && r.executorId === r.agentLearnerKey && text(r.configurationFingerprint) &&
    Number.isSafeInteger(r.configurationVersion) && r.configurationVersion > 0 &&
    exact(r.package, ['id','version','digest']) && Object.values(r.package).every(text) && r.policyVersion === POLICY &&
    pair(r.environment, r.evidenceMode) && exact(r.source, ['id','version','digest']) && text(r.source.id) &&
    text(r.source.version) && HASH.test(r.source.digest) && sourceMode(r.source) === r.evidenceMode && (!catalog || validSource(r.source));
}
function runAuthority(run) {
  return { schemaVersion: 'execution-authority/1.0.0', executorId: run.executorId, policyVersion: run.policyVersion,
    environment: run.environment, evidenceMode: run.evidenceMode, source: run.source };
}
function matchesAuthority(run, a, evidence) {
  return validAuthority(a) && validRun(run) && a.executorId === run.executorId &&
    a.policyVersion === run.policyVersion && a.environment === run.environment && a.evidenceMode === run.evidenceMode &&
    same(a.source, run.source) && evidence?.mode === run.evidenceMode && evidence?.environment === run.environment;
}
function context(phase, item) {
  if (phase === 'training') return { phase, itemId: item.deliveryItemId, kind: item.kind || item.itemKind || 'lesson',
    moduleId: item.moduleId, objectiveIds: item.objectiveIds, text: item.text };
  return { phase, slotId: item.slotId || item.id, tier: item.tier, prompt: item.prompt,
    answerType: item.answerType || null, choices: item.choices || null };
}
function generated(sourceRef, phase, item) {
  if (!validSource(sourceRef)) throw fail();
  const ctx = context(phase, item), contextDigest = hash(ctx);
  if (sourceMode(sourceRef) === 'replay') {
    const entry = replayManifest().entries.find((e) => e.phase === phase && e.requestHash === contextDigest);
    if (!entry || entry.responseDigest !== responseHash(entry.response)) throw fail('replay_context_not_found');
    return { response: entry.response, entryId: entry.id, contextDigest };
  }
  const [, profile, scenario] = sourceRef.id.split(':');
  const slots = ['r1','r2','r3','r4','r5','a1','a2','a3','a4','a5','a6','v1','v2','v3','v4'];
  const index = slots.indexOf(item.slotId);
  if (phase === 'examination' && scenario === 'timeout' && index < 0) throw fail('source_response_unavailable');
  const response = phase === 'training' ? reference.getSyntheticProfile(profile).response
    : (item.answerType ? reference.fallbackAnswer(item) : sourceRef.id === remediable.ID
      ? remediable.answer(item, index) : reference.examAnswer(scenario, item, index));
  if (typeof response !== 'string' || !response) throw fail('source_response_unavailable');
  return { response, entryId: `${phase}:${phase === 'training' ? item.deliveryItemId : item.slotId || item.id}`, contextDigest };
}
function receipt(run, phase, item, attemptId = null, now = new Date().toISOString()) {
  if (!validRun(run)) throw fail();
  const out = generated(run.source, phase, item);
  const fields = { schemaVersion: RECEIPT, runId: run.runId, phase,
    itemId: phase === 'training' ? item.deliveryItemId : item.id, attemptId, executorId: run.executorId,
    source: run.source, entryId: out.entryId, contextDigest: out.contextDigest, responseDigest: responseHash(out.response) };
  return { response: out.response, executionEvidence: { ...fields, receiptId: hash(fields), executedAt: now } };
}
function validateReceipt(run, a, evidence, rec, phase, item, response, attemptId = null) {
  if (!matchesAuthority(run, a, evidence) || !exact(rec, ['schemaVersion','runId','phase','itemId','attemptId','executorId',
    'source','entryId','contextDigest','responseDigest','receiptId','executedAt']) ||
    typeof rec.executedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(rec.executedAt) ||
    !Number.isFinite(Date.parse(rec.executedAt))) throw fail();
  const expected = receipt(run, phase, item, attemptId, rec.executedAt);
  if (!same(rec, expected.executionEvidence) || response !== expected.response) throw fail();
  return structuredClone(rec);
}
function coverage(run, phase, itemIds, receipts, attemptId = null) {
  if (!validRun(run) || !Array.isArray(itemIds) || !itemIds.length || new Set(itemIds).size !== itemIds.length ||
      receipts.length !== itemIds.length || new Set(receipts.map((r) => r?.receiptId)).size !== receipts.length ||
      receipts.some((r, i) => r?.schemaVersion !== RECEIPT || r.runId !== run.runId || r.phase !== phase ||
        r.itemId !== itemIds[i] || r.attemptId !== attemptId || r.executorId !== run.executorId || !same(r.source, run.source))) throw fail();
  return { schemaVersion: COVERAGE, runId: run.runId, phase, attemptId, itemCount: itemIds.length,
    itemIdsDigest: hash(itemIds), receiptsDigest: hash(receipts) };
}
function validCoverage(c, run, phase, count, attemptId = null) {
  return exact(c, ['schemaVersion','runId','phase','attemptId','itemCount','itemIdsDigest','receiptsDigest']) &&
    c.schemaVersion === COVERAGE && c.runId === run.runId && c.phase === phase && c.attemptId === attemptId &&
    Number.isSafeInteger(c.itemCount) && c.itemCount > 0 && c.itemCount === count && HASH.test(c.itemIdsDigest) && HASH.test(c.receiptsDigest);
}
function validCompletion(c, run = c?.provenance) {
  return c?.schemaVersion === '1.1.0' && validRun(run) && same(c.provenance, run) && c.sessionId === run.runId &&
    c.agentLearnerKey === run.agentLearnerKey && c.configurationFingerprint === run.configurationFingerprint &&
    c.configurationVersion === run.configurationVersion && same(c.package, run.package) &&
    c.evidence?.mode === run.evidenceMode && c.evidence?.environment === run.environment &&
    c.eventId === `training.session.completed:${run.runId}` && c.completion?.plannedItems === c.completion?.completedItems &&
    validCoverage(c.executionCoverage, run, 'training', c.completion.plannedItems);
}
function validSummary(s, binding, catalog = true) {
  const r = s?.run;
  return exact(s, ['schemaVersion','run','training','examination']) && s.schemaVersion === 'certification-provenance/1.0.0' &&
    validRun(r, catalog) && r.agentLearnerKey === binding.subjectId && r.configurationFingerprint === binding.fingerprint &&
    same(r.package, binding.package) && exact(s.training, ['eventId','completionDigest','coverage']) &&
    s.training.eventId === `training.session.completed:${r.runId}` && HASH.test(s.training.completionDigest) &&
    validCoverage(s.training.coverage, r, 'training', s.training.coverage?.itemCount) &&
    validCoverage(s.examination, r, 'examination', 15, binding.examinationId) &&
    (!binding.itemIds || s.examination.itemIdsDigest === hash(binding.itemIds));
}
function credentialProvenance(vc) {
  const marked = vc.credentialSchema?.id === SCHEMA;
  if (!marked) return !Object.hasOwn(vc.evidence || {}, 'provenance'); // legacy labels remain descriptive; Marketplace requires the new profile
  const s = vc.evidence?.provenance;
  const competency = vc.credentialSubject?.competency;
  const scores = competency?.scores;
  const outcomes = scores?.itemOutcomes;
  const safety = competency?.safetyResult;
  if (!competency || competency.result !== 'pass' || !['standard','fallback'].includes(competency.mode) ||
      competency.mode !== vc.evidence?.mode || competency.packageId !== vc.evidence?.package?.id ||
      competency.packageVersion !== vc.evidence?.package?.version ||
      !Number.isFinite(scores?.overallPercent) || scores.overallPercent < 0 || scores.overallPercent > 100 ||
      !['recall','applied','adversarial'].every((tier) => Number.isFinite(scores?.tierPercents?.[tier]) &&
        scores.tierPercents[tier] >= 0 && scores.tierPercents[tier] <= 100) ||
      !Array.isArray(outcomes) || outcomes.length !== 15 || outcomes.some((i) => !text(i?.itemId)) ||
      new Set(outcomes.map((i) => i.itemId)).size !== 15 || safety?.passed !== true ||
      !Array.isArray(safety.criticalViolationRuleIds) || safety.criticalViolationRuleIds.length ||
      !Array.isArray(safety.failureReasons) || safety.failureReasons.length ||
      !same(scores, vc.evidence?.scores) || !same(safety, vc.evidence?.safetyResult)) return false;
  return validSummary(s, { subjectId: s?.run?.agentLearnerKey, fingerprint: vc.credentialSubject?.configurationFingerprint,
    package: vc.evidence?.package, examinationId: vc.evidence?.examinationId,
    itemIds: outcomes.map((i) => i.itemId) }, false) &&
    vc.credentialSubject?.id === `${vc.issuer}/agents/${encodeURIComponent(s.run.agentLearnerKey)}` &&
    UUID.test(vc.evidence?.certificationDecisionId) && vc.environment === s.run.environment && vc.evidenceMode === s.run.evidenceMode &&
    issuerPermits(vc.environment, vc.issuer);
}

module.exports = { POLICY, RUN, RECEIPT, COVERAGE, SCHEMA, UUID, SIMULATION_ISSUER, replayReviewed, issuerPermits, hash, responseHash, same, pair, fail,
  source, sourceMode, validSource, enrollments, authority, validAuthority, bindRun, validRun, matchesAuthority, runAuthority,
  context, generated, receipt, validateReceipt, coverage, validCoverage, validCompletion, validSummary, credentialProvenance };
