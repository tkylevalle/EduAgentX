const express = require('express');
const { randomUUID } = require('node:crypto');
const { validatePackage } = require('../../curriculum-engine/model');
const { scoreBank } = require('../../curriculum-engine/fallback');

const { runValidationGates } = require('./gates');
const { db } = require('./db');
const { classifyFreshness, DEFAULT_FRESHNESS_DAYS, isDue } = require('./freshness');
const { validateScope, createRefreshCandidate, selectFallback } = require('./package-lifecycle');

function createApp({ packageDb = db, now = () => new Date(), internalKey = process.env.CURRICULUM_INTERNAL_KEY } = {}) {
const app = express();
app.use(express.json({ limit: '512kb' }));
const route = (method, path, ...handlers) => app[method](path, ...handlers.map(handler => (req, res, next) => {
  Promise.resolve().then(() => handler(req, res, next)).catch(() => {
    if (!res.headersSent) res.status(503).json({ error: 'dependency_unavailable' });
  });
}));

const requireInternalActor = (req, res, next) => {
  if (!internalKey || req.header('x-internal-service-key') !== internalKey) return res.status(403).json({ error: 'forbidden' });
  if (!req.header('x-actor-subject')) return res.status(400).json({ error: 'actor_required' });
  next();
};

// Health check
route('get', '/health', async (req, res) => {
  try { await packageDb.listPackages(); res.json({ status: 'ok', service: 'validation-activation' }); }
  catch { res.status(503).json({ status: 'unavailable', service: 'validation-activation' }); }
});

// POST /packages — ingest a package from curriculum-engine
// Accepts both { id } and { manifest: { packageId } } shapes
route('post', '/packages', requireInternalActor, async (req, res) => {
  const pkg = req.body;
  // Normalise: curriculum-engine sends manifest.packageId
  const id = pkg.id || pkg.manifest?.packageId;
  if (!id) return res.status(400).json({ error: 'missing_package_id', hint: 'provide id or manifest.packageId' });
  if (validatePackage(pkg).length) return res.status(422).json({ error: 'invalid_candidate' });
  try {
    const stored = await packageDb.seedPackage(pkg, req.header('x-actor-subject'));
    res.status(stored.created ? 201 : 200).json({ packageId: id, version: pkg.manifest.version, digest: stored.digest, state: 'Candidate' });
  } catch (error) {
    if (error.code === 'package_version_conflict') return res.status(409).json({ error: error.code });
    return res.status(503).json({ error: 'package_store_unavailable' });
  }
});

// POST /validate — run 6 gates on a candidate package
route('post', '/validate', requireInternalActor, async (req, res) => {
  const { package_id, version } = req.body;
  if (!package_id || !version) return res.status(400).json({ error: 'package_id_and_version_required' });
  const pkg = await packageDb.getPackage(package_id, version);
  if (!pkg) return res.status(404).json({ error: 'package_not_found' });
  if (pkg.state !== 'Candidate') return res.status(409).json({ error: 'not_candidate', state: pkg.state });
  const result = await runValidationGates(pkg);
  await packageDb.appendEvidence(package_id, { event: 'validation_run', digest: pkg.digest, result, ts: now().toISOString() }, version);
  if (!result.passed) {
    await packageDb.setPackageState(package_id, 'Invalid', version);
    return res.status(422).json({ error: 'validation_failed', gates: result.gates });
  }
  await packageDb.setPackageState(package_id, 'AwaitingReview', version);
  res.json({ passed: true, gates: result.gates, state: 'AwaitingReview' });
});

// POST /review — submit reviewer approval
route('post', '/review', requireInternalActor, async (req, res) => {
  const { package_id, version, score, approved } = req.body;
  const reviewer_id = req.header('x-actor-subject');
  if (!['reviewer', 'admin'].includes(req.header('x-actor-role')))
    return res.status(403).json({ error: 'reviewer_role_required' });
  if (!package_id || !version || !Number.isFinite(score) || typeof approved !== 'boolean')
    return res.status(400).json({ error: 'missing_fields' });
  if (score < 0 || score > 5) return res.status(422).json({ error: 'invalid_score' });
  const pkg = await packageDb.getPackage(package_id, version);
  if (!pkg) return res.status(404).json({ error: 'package_not_found' });
  if (pkg.state !== 'AwaitingReview') return res.status(409).json({ error: 'not_awaiting_review', state: pkg.state });
  if (pkg.createdBy === reviewer_id) return res.status(403).json({ error: 'author_cannot_review' });
  if (!await packageDb.submitReview(package_id, version, pkg.digest, { reviewer_id, score, approved, ts: now().toISOString() }))
    return res.status(409).json({ error: 'duplicate_reviewer' });
  await packageDb.appendEvidence(package_id, { event: 'review_submitted', reviewer_id, score, approved, ts: now().toISOString() }, version);
  const packageReviews = await packageDb.getReviews(package_id, version);
  const approvals = packageReviews.filter(r => r.approved && r.score >= 3.5);
  const mean = approvals.length ? approvals.reduce((sum, review) => sum + review.score, 0) / approvals.length : null;
  res.json({ reviews: packageReviews.length, approvals: approvals.length, mean, target_met: mean >= 4,
    ready_to_activate: approvals.length >= 2 && mean >= 3.5 });
});

// POST /activate — atomically activate after 2 approvals
route('post', '/activate', requireInternalActor, async (req, res) => {
  const { package_id, version } = req.body;
  if (!package_id || !version) return res.status(400).json({ error: 'package_id_and_version_required' });
  const pkg = await packageDb.getPackage(package_id, version);
  if (!pkg) return res.status(404).json({ error: 'package_not_found' });
  if (pkg.state !== 'AwaitingReview') return res.status(409).json({ error: 'not_awaiting_review' });
  const validation = (await packageDb.getEvidence(package_id, version)).find(entry =>
    entry.event === 'validation_run' && entry.digest === pkg.digest && entry.result?.passed === true);
  if (!validation) return res.status(409).json({ error: 'validation_evidence_required' });
  const packageReviews = await packageDb.getReviews(package_id, version);
  const approvals = packageReviews.filter(r => r.approved && r.score >= 3.5 && r.digest === pkg.digest);
  const distinctReviewers = new Set(approvals.map(r => r.reviewer_id));
  if (distinctReviewers.size < 2)
    return res.status(403).json({ error: 'insufficient_approvals', required: 2, distinct_approvers: distinctReviewers.size });
  const avgScore = approvals.reduce((sum, r) => sum + r.score, 0) / approvals.length;
  if (avgScore < 3.5) return res.status(422).json({ error: 'score_below_floor', floor: 3.5, average: avgScore });
  let result;
  try { result = await packageDb.activatePackage(package_id, version, pkg.digest); }
  catch { return res.status(409).json({ error: 'activation_precondition_failed' }); }
  await packageDb.appendEvidence(package_id, { event: 'activated', previous_active: result.superseded_id, ts: now().toISOString() }, version);
  res.json({ activated: true, packageId: package_id, superseded_id: result.superseded_id });
});

// GET /packages/active — active package with digest + packageId for training service
route('get', '/packages/active', requireInternalActor, async (req, res) => {
  const pkg = await packageDb.getActivePackage();
  if (!pkg) return res.status(404).json({ error: 'no_active_package' });
  const evidence = await packageDb.getEvidence(pkg.id, pkg.version);
  const quarantinedScopes = await packageDb.getScopedQuarantines(pkg.id, pkg.version);
  res.json({
    packageId: pkg.id,
    digest: pkg.digest || null,
    version: pkg.version,
    state: pkg.state,
    examTemplate: pkg.examTemplate || pkg.examination_template,
    curriculumTrack: pkg.curriculumTrack,
    objectives: pkg.objectives,
    modules: pkg.modules,
    rubric: pkg.rubric,
    evidence,
    quarantinedScopes,
    certificationBlocked: quarantinedScopes.length > 0
  });
});

// GET /packages/:id — full package state + evidence
route('get', '/packages/:id', requireInternalActor, async (req, res) => {
  if (!req.query.version) return res.status(400).json({ error: 'version_required' });
  const pkg = await packageDb.getPackage(req.params.id, req.query.version);
  if (!pkg) return res.status(404).json({ error: 'not_found' });
  const evidence = await packageDb.getEvidence(req.params.id, pkg.version);
  const packageReviews = await packageDb.getReviews(req.params.id, pkg.version);
  const quarantinedScopes = await packageDb.getScopedQuarantines(pkg.id, pkg.version);
  const { fallbackBank, fallback_bank, ...safePackage } = pkg;
  res.json({ ...safePackage, packageId: pkg.id, digest: pkg.digest || null, evidence, reviews: packageReviews,
    quarantinedScopes, certificationBlocked: quarantinedScopes.length > 0 });
});

// GET /packages — list all packages
route('get', '/packages', requireInternalActor, async (req, res) => {
  const packages = await packageDb.listPackages();
  res.json(packages.map(p => ({ packageId: p.id, digest: p.digest || null, state: p.state, version: p.version })));
});

route('get', '/packages/:id/freshness', requireInternalActor, async (req, res) => {
  const pkg = await packageDb.getPackage(req.params.id);
  if (!pkg) return res.status(404).json({ error: 'package_not_found' });
  const intervalDays = req.query.intervalDays === undefined ? DEFAULT_FRESHNESS_DAYS : Number(req.query.intervalDays);
  if (!Number.isInteger(intervalDays) || intervalDays < 1 || intervalDays > 3650) return res.status(400).json({ error: 'invalid_interval_days' });
  const checks = await packageDb.getFreshnessChecks(pkg.id, pkg.version);
  const latestBySource = new Map();
  for (const check of checks) latestBySource.set(check.sourceId, check);
  const sources = (pkg.sources || []).map((source) => {
    const last = latestBySource.get(source.id || source.sourceId);
    return { sourceId: source.id || source.sourceId, checkedAt: last?.checkedAt || null, classification: last?.classification || null,
      due: isDue(last?.checkedAt, now(), intervalDays) };
  });
  res.json({ packageId: pkg.id, version: pkg.version, intervalDays, sources });
});

route('post', '/packages/:id/freshness-checks', requireInternalActor, async (req, res) => {
  const pkg = await packageDb.getPackage(req.params.id);
  if (!pkg) return res.status(404).json({ error: 'package_not_found' });
  if (!['Active', 'Superseded'].includes(pkg.state)) return res.status(409).json({ error: 'package_not_validated', state: pkg.state });
  const source = (pkg.sources || []).find((item) => (item.id || item.sourceId) === req.body?.sourceId);
  if (!source) return res.status(404).json({ error: 'source_not_found' });
  const classified = classifyFreshness(source, req.body?.evidence);
  if (classified.errors) return res.status(422).json({ error: 'invalid_source_evidence', details: classified.errors });
  const criticalScope = req.body?.scope || classified.evidence.affectedScope;
  if (classified.classification === 'Critical') {
    const scopeError = validateScope(pkg, criticalScope);
    if (scopeError) return res.status(422).json({ error: 'invalid_quarantine_scope', details: scopeError });
  }
  const checkedAt = now().toISOString();
  const record = { sourceId: req.body.sourceId, classification: classified.classification, evidence: classified.evidence,
    actor: req.header('x-actor-subject'), checkedAt };
  if (classified.classification === 'Critical') {
    await packageDb.appendScopeEvent(pkg.id, pkg.version, { scopeType: criticalScope.type, scopeId: criticalScope.id, event: 'quarantined',
      evidence: { check: record, reason: req.body?.reason || classified.evidence.summary }, actor: req.header('x-actor-subject'), occurredAt: checkedAt });
  }
  await packageDb.appendFreshnessCheck(pkg.id, pkg.version, record);
  let candidate = null;
  if (['Patch', 'Substantive', 'Critical'].includes(classified.classification)) {
    candidate = createRefreshCandidate(pkg, classified.evidence);
    await packageDb.seedPackage(candidate);
    await packageDb.appendEvidence(candidate.id, { event: 'candidate_created_from_freshness', sourcePackageId: pkg.id,
      classification: classified.classification, evidence: classified.evidence, ts: checkedAt });
  }
  await packageDb.appendEvidence(pkg.id, { event: 'freshness_check', ...record });
  res.status(classified.classification === 'Critical' ? 202 : 200).json({ packageId: pkg.id, version: pkg.version,
    classification: classified.classification, evidence: classified.evidence,
    candidatePackage: candidate ? { packageId: candidate.id, version: candidate.version, state: 'Candidate' } : null,
    quarantinedScope: classified.classification === 'Critical' ? criticalScope : null });
});

route('post', '/packages/:id/quarantines/restore', requireInternalActor, async (req, res) => {
  const pkg = await packageDb.getPackage(req.params.id);
  if (!pkg) return res.status(404).json({ error: 'package_not_found' });
  const scopeError = validateScope(pkg, req.body?.scope);
  if (scopeError) return res.status(422).json({ error: 'invalid_quarantine_scope', details: scopeError });
  if (typeof req.body?.reason !== 'string' || !req.body.reason.trim() || typeof req.body?.evidenceReference !== 'string' || !req.body.evidenceReference.trim())
    return res.status(400).json({ error: 'restoration_evidence_required' });
  const restored = await packageDb.getPackage(req.body?.restoredPackageId);
  if (!restored || restored.state !== 'Active' || restored.id === pkg.id ||
      restored.domain !== pkg.domain || restored.manifest?.predecessor?.packageId !== pkg.id ||
      restored.manifest?.predecessor?.version !== pkg.version)
    return res.status(409).json({ error: 'restored_active_package_required' });
  const occurredAt = now().toISOString();
  await packageDb.appendScopeEvent(pkg.id, pkg.version, { scopeType: req.body.scope.type, scopeId: req.body.scope.id, event: 'restored',
    evidence: { reason: req.body.reason.trim(), evidenceReference: req.body.evidenceReference.trim(), restoredPackageId: restored.id, restoredPackageVersion: restored.version }, actor: req.header('x-actor-subject'), occurredAt });
  const quarantinedScopes = await packageDb.getScopedQuarantines(pkg.id, pkg.version);
  res.json({ packageId: pkg.id, restoredScope: req.body.scope, certificationBlocked: quarantinedScopes.length > 0, quarantinedScopes });
});

route('post', '/fallback/select', requireInternalActor, async (req, res) => {
  const packageId = req.body?.package_id;
  if (!packageId || !['standard_generation_unavailable', 'standard_grading_unavailable'].includes(req.body?.reason))
    return res.status(400).json({ error: 'fallback_selection_reason_required' });
  const pkg = await packageDb.getPackage(packageId);
  if (!pkg) return res.status(404).json({ error: 'package_not_found' });
  const validationEvidence = await packageDb.getEvidence(packageId, pkg.version);
  const fallback = pkg.fallbackBank || pkg.fallback_bank;
  const quarantinedScopes = await packageDb.getScopedQuarantines(pkg.id, pkg.version);
  const selected = selectFallback(pkg, { validationEvidence, reason: req.body.reason, quarantinedScopes });
  if (selected.error) return res.status(409).json({ error: selected.error, details: selected.details });
  const safeItems = selected.bank.items;
  const attemptId = randomUUID();
  await packageDb.appendEvidence(packageId, { event: 'fallback_selected', attemptId, bankId: fallback.id, bankVersion: fallback.version,
    digest: pkg.digest, reason: req.body.reason, actor: req.header('x-actor-subject'), ts: now().toISOString() }, pkg.version);
  res.json({ packageId, bankId: fallback.id, bankVersion: fallback.version, scoringPolicy: fallback.scoringPolicy,
    attemptId, mode: 'fallback', items: safeItems.map(({ id, version, tier, answerType, choices, prompt, objectiveIds, sourceLinks, criticalSafety }) =>
      ({ id, version, tier, answerType, choices, prompt, objectiveIds, sourceLinks, criticalSafety: criticalSafety === true })) });
});

route('post', '/fallback/score', requireInternalActor, async (req, res) => {
  const pkg = await packageDb.getPackage(req.body?.package_id);
  if (!pkg) return res.status(404).json({ error: 'package_not_found' });
  if (pkg.state !== 'Active') return res.status(409).json({ error: 'fallback_requires_active_package', state: pkg.state });
  const evidence = await packageDb.getEvidence(pkg.id, pkg.version);
  const quarantine = await packageDb.getScopedQuarantines(pkg.id, pkg.version);
  if (quarantine.length) return res.status(409).json({ error: 'fallback_scope_quarantined' });
  const selected = evidence.find((entry) => entry.event === 'fallback_selected' && entry.attemptId === req.body?.attemptId);
  if (!selected) return res.status(409).json({ error: 'fallback_not_selected' });
  if (evidence.some((entry) => entry.event === 'fallback_scored' && entry.attemptId === selected.attemptId)) return res.status(409).json({ error: 'fallback_attempt_already_scored' });
  const result = scoreBank(pkg.fallbackBank || pkg.fallback_bank, req.body.responses);
  if (!result.valid) return res.status(422).json({ error: result.reason });
  if (packageDb.recordFallbackScore && !await packageDb.recordFallbackScore(pkg.id, pkg.version, selected.attemptId, result))
    return res.status(409).json({ error: 'fallback_attempt_already_scored' });
  await packageDb.appendEvidence(pkg.id, { event: 'fallback_scored', attemptId: selected.attemptId, policyId: result.policyId, passed: result.passed,
    overall: result.overall, tierScores: result.tierScores, criticalViolation: result.criticalViolation, ts: now().toISOString() }, pkg.version);
  res.json(result);
});

const PORT = process.env.PORT || 4010;
return app;
}

if (require.main === module) createApp().listen(process.env.PORT || 4010, () => console.log(`[validation-activation] listening on ${process.env.PORT || 4010}`));
module.exports = { createApp };
