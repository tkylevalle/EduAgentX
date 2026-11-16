const express = require('express');
const { randomUUID } = require('node:crypto');
const { validatePackage } = require('../../curriculum-engine/model');
const { deliveryChoices, scoreBank } = require('../../curriculum-engine/fallback');

const { runValidationGates } = require('./gates');
const { db } = require('./db');
const { classifyFreshness, DEFAULT_FRESHNESS_DAYS, isDue } = require('./freshness');
const { validateScope, createRefreshCandidate, selectFallback } = require('./package-lifecycle');
const { runFreshnessJob } = require('./freshness-job');
const { MAX_COMMENT_CHARS, MAX_RESOLUTION_CHARS, REVIEW_POLICY, citedSources, reviewScore, reviewState, sourceChecksError } = require('./reviews');
const telemetry = require('../../../packages/telemetry');

function createApp({ packageDb = db, now = () => new Date(), internalKey = process.env.CURRICULUM_INTERNAL_KEY, fetchImpl = fetch } = {}) {
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

// The reviews and resolutions of one package version, read together, and the
// review state they give.
async function loadReviewState(pkg) {
  const [reviews, resolutions] = await Promise.all([packageDb.getReviews(pkg.id, pkg.version), packageDb.getResolutions(pkg.id, pkg.version)]);
  return { reviews, resolutions, state: reviewState(pkg, reviews, resolutions) };
}

// Activation failures the store raises on purpose; any other error is the
// store's own and may carry database text, so it is logged, not returned.
const ACTIVATION_PRECONDITIONS = new Set(['activation_precondition_failed', 'stale_candidate', 'insufficient_approvals']);

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

// POST /review — a reviewer's scores for every rubric criterion, their checks
// of every cited source, a comment and an approval decision. The reviewer is
// the authenticated subject; the score is the rubric-weighted mean of the
// criterion scores (reviews.js).
route('post', '/review', requireInternalActor, async (req, res) => {
  const { package_id, version, criterionScores, sourceChecks, approved, comment = '' } = req.body;
  const reviewer_id = req.header('x-actor-subject');
  if (!['reviewer', 'admin'].includes(req.header('x-actor-role')))
    return res.status(403).json({ error: 'reviewer_role_required' });
  if (!package_id || !version || typeof approved !== 'boolean' || typeof comment !== 'string' || comment.length > MAX_COMMENT_CHARS)
    return res.status(400).json({ error: 'missing_fields' });
  const pkg = await packageDb.getPackage(package_id, version);
  if (!pkg) return res.status(404).json({ error: 'package_not_found' });
  if (pkg.state !== 'AwaitingReview') return res.status(409).json({ error: 'not_awaiting_review', state: pkg.state });
  if (pkg.createdBy === reviewer_id) return res.status(403).json({ error: 'author_cannot_review' });
  const scored = reviewScore(pkg.rubric, criterionScores);
  if (scored.error) return res.status(422).json({ error: scored.error, criteria: (pkg.rubric?.criteria || []).map((criterion) => criterion.id) });
  const sourceError = sourceChecksError(pkg, sourceChecks, approved);
  if (sourceError) return res.status(422).json({ error: sourceError, sources: citedSources(pkg) });
  const review = { reviewer_id, score: scored.score, approved, criterionScores, sourceChecks, comment: comment.trim(), ts: now().toISOString() };
  if (!await packageDb.submitReview(package_id, version, pkg.digest, review))
    return res.status(409).json({ error: 'duplicate_reviewer' });
  await packageDb.appendEvidence(package_id, { event: 'review_submitted', ...review }, version);
  const { state } = await loadReviewState(pkg);
  res.json({ score: scored.score, ...state });
});

// POST /review/resolutions — how a disagreement on one criterion was resolved,
// recorded once, by one of the reviewers who disagree.
route('post', '/review/resolutions', requireInternalActor, async (req, res) => {
  const { package_id, version, criterionId, resolution } = req.body;
  const actor = req.header('x-actor-subject');
  if (!['reviewer', 'admin'].includes(req.header('x-actor-role'))) return res.status(403).json({ error: 'reviewer_role_required' });
  if (!package_id || !version || typeof criterionId !== 'string' || typeof resolution !== 'string' || !resolution.trim() ||
    resolution.length > MAX_RESOLUTION_CHARS) return res.status(400).json({ error: 'missing_fields' });
  const pkg = await packageDb.getPackage(package_id, version);
  if (!pkg) return res.status(404).json({ error: 'package_not_found' });
  // Once a package has left review, its record is closed.
  if (pkg.state !== 'AwaitingReview') return res.status(409).json({ error: 'not_awaiting_review', state: pkg.state });
  const { state } = await loadReviewState(pkg);
  const open = state.disagreements.find((item) => item.criterionId === criterionId);
  if (!open) return res.status(409).json({ error: 'no_open_disagreement', criterionId });
  if (!Object.hasOwn(open.scores, actor)) return res.status(403).json({ error: 'only_a_disagreeing_reviewer_may_resolve' });
  if (!await packageDb.addResolution(package_id, version, { criterionId, resolvedBy: actor, resolution: resolution.trim() }))
    return res.status(409).json({ error: 'already_resolved' });
  await packageDb.appendEvidence(package_id, { event: 'review_disagreement_resolved', criterionId, resolvedBy: actor,
    resolution: resolution.trim(), ts: now().toISOString() }, version);
  res.json({ criterionId, resolvedBy: actor });
});

// POST /activate — atomically activate once the review state is ready
route('post', '/activate', requireInternalActor, async (req, res) => {
  const { package_id, version } = req.body;
  if (!package_id || !version) return res.status(400).json({ error: 'package_id_and_version_required' });
  const pkg = await packageDb.getPackage(package_id, version);
  if (!pkg) return res.status(404).json({ error: 'package_not_found' });
  if (pkg.state !== 'AwaitingReview') return res.status(409).json({ error: 'not_awaiting_review' });
  const validation = (await packageDb.getEvidence(package_id, version)).find(entry =>
    entry.event === 'validation_run' && entry.digest === pkg.digest && entry.result?.passed === true);
  if (!validation) return res.status(409).json({ error: 'validation_evidence_required' });
  const { state } = await loadReviewState(pkg);
  if (state.approvals < state.required)
    return res.status(403).json({ error: 'insufficient_approvals', required: state.required, distinct_approvers: state.approvals });
  if (state.mean < state.floor) return res.status(422).json({ error: 'score_below_floor', floor: state.floor, average: state.mean });
  if (state.disagreements.length) return res.status(409).json({ error: 'unresolved_review_disagreement', disagreements: state.disagreements });
  let result;
  try { result = await packageDb.activatePackage(package_id, version, pkg.digest); }
  catch (error) {
    if (ACTIVATION_PRECONDITIONS.has(error.message)) return res.status(409).json({ error: 'activation_precondition_failed', reason: error.message });
    telemetry.log('validation-activation', 'activation_failed', { operation: 'activate', outcome: error.code || error.name });
    return res.status(503).json({ error: 'package_store_unavailable' });
  }
  await packageDb.appendEvidence(package_id, { event: 'activated', previous_active: result.superseded_id, ts: now().toISOString() }, version);
  res.json({ activated: true, packageId: package_id, superseded_id: result.superseded_id });
});

// GET /packages/active[?domain=<domainId>|?packageId=<id>] — the Active package
// for one domain, with digest + packageId. With several domains active and no
// selector, the caller must say which: guessing would examine the wrong domain.
route('get', '/packages/active', requireInternalActor, async (req, res) => {
  const { domain, packageId } = req.query;
  if ([domain, packageId].some((value) => value !== undefined && (typeof value !== 'string' || !value.trim())))
    return res.status(400).json({ error: 'invalid_selector' });
  const matches = (await packageDb.getActivePackages()).filter((value) =>
    (!domain || value.manifest?.domainId === domain) && (!packageId || value.id === packageId));
  if (!matches.length) return res.status(404).json({ error: 'no_active_package' });
  if (matches.length > 1) return res.status(409).json({ error: 'domain_required', domains: matches.map((value) => value.manifest?.domainId) });
  const [pkg] = matches;
  const evidence = await packageDb.getEvidence(pkg.id, pkg.version);
  const quarantinedScopes = await packageDb.getScopedQuarantines(pkg.id, pkg.version);
  res.json({
    packageId: pkg.id,
    digest: pkg.digest || null,
    version: pkg.version,
    state: pkg.state,
    domainId: pkg.manifest?.domainId || null,
    examTemplate: pkg.examTemplate || pkg.examination_template,
    curriculumTrack: pkg.curriculumTrack,
    sources: pkg.sources,
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
  const [evidence, quarantinedScopes, { reviews: packageReviews, resolutions, state }] = await Promise.all([
    packageDb.getEvidence(pkg.id, pkg.version), packageDb.getScopedQuarantines(pkg.id, pkg.version), loadReviewState(pkg)]);
  const { fallbackBank, fallback_bank, ...safePackage } = pkg;
  res.json({ ...safePackage, packageId: pkg.id, digest: pkg.digest || null, evidence, reviews: packageReviews, resolutions,
    openDisagreements: state.disagreements, reviewState: state, reviewPolicy: REVIEW_POLICY, citedSources: citedSources(pkg),
    quarantinedScopes, certificationBlocked: quarantinedScopes.length > 0 });
});

// GET /packages — list all packages
// Packages people review or that are Active carry their approval count, so a
// console can list them without reading each package in full.
const COUNTED_STATES = ['AwaitingReview', 'Active'];
route('get', '/packages', requireInternalActor, async (req, res) => {
  const packages = await packageDb.listPackages();
  res.json(await Promise.all(packages.map(async (p) => ({ packageId: p.id, digest: p.digest || null, state: p.state, version: p.version,
    domainId: p.manifest?.domainId ?? null,
    ...(COUNTED_STATES.includes(p.state) ? (({ approvals, required }) => ({ approvals, required }))((await loadReviewState(p)).state) : {}) }))));
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

// Records one source check, from a person (the route below) or the scheduled
// job; returns { status, body }. A Patch, Substantive or Critical change makes
// a refresh candidate; a Critical one also quarantines its scope.
async function recordFreshnessCheck(pkg, sourceId, evidence, actor, { scope, reason } = {}) {
  const source = (pkg.sources || []).find((item) => (item.id || item.sourceId) === sourceId);
  if (!source) return { status: 404, body: { error: 'source_not_found' } };
  const classified = classifyFreshness(source, evidence);
  if (classified.errors) return { status: 422, body: { error: 'invalid_source_evidence', details: classified.errors } };
  const criticalScope = scope || classified.evidence.affectedScope;
  if (classified.classification === 'Critical') {
    const scopeError = validateScope(pkg, criticalScope);
    if (scopeError) return { status: 422, body: { error: 'invalid_quarantine_scope', details: scopeError } };
  }
  const checkedAt = now().toISOString();
  const record = { sourceId, classification: classified.classification, evidence: classified.evidence, actor, checkedAt };
  if (classified.classification === 'Critical') {
    await packageDb.appendScopeEvent(pkg.id, pkg.version, { scopeType: criticalScope.type, scopeId: criticalScope.id, event: 'quarantined',
      evidence: { check: record, reason: reason || classified.evidence.summary }, actor, occurredAt: checkedAt });
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
  return { status: classified.classification === 'Critical' ? 202 : 200, body: { packageId: pkg.id, version: pkg.version,
    classification: classified.classification, evidence: classified.evidence,
    candidatePackage: candidate ? { packageId: candidate.id, version: candidate.version, state: 'Candidate' } : null,
    quarantinedScope: classified.classification === 'Critical' ? criticalScope : null } };
}

route('post', '/packages/:id/freshness-checks', requireInternalActor, async (req, res) => {
  const pkg = await packageDb.getPackage(req.params.id);
  if (!pkg) return res.status(404).json({ error: 'package_not_found' });
  if (!['Active', 'Superseded'].includes(pkg.state)) return res.status(409).json({ error: 'package_not_validated', state: pkg.state });
  const { status, body } = await recordFreshnessCheck(pkg, req.body?.sourceId, req.body?.evidence, req.header('x-actor-subject'),
    { scope: req.body?.scope, reason: req.body?.reason });
  res.status(status).json(body);
});

// The scheduled source check (C5), run on demand by an admin. The schedule
// itself runs it every FRESHNESS_JOB_INTERVAL_MS (see startFreshnessSchedule).
// One run at a time: a run asked for while one is in flight gets that run's
// report, so a timer tick and an admin's request never check a source twice.
let freshnessRun = null;
async function runFreshnessOnce() {
  const report = await runFreshnessJob({ packageDb, fetchImpl, now, record: recordFreshnessCheck });
  for (const line of report.filter((item) => item.result === 'record_failed')) {
    telemetry.log('validation-activation', 'freshness_record_failed', { operation: 'freshness', outcome: `${line.status}:${line.error}` });
  }
  return report;
}
const runFreshness = () => {
  freshnessRun ??= runFreshnessOnce().finally(() => { freshnessRun = null; });
  return freshnessRun;
};
route('post', '/freshness/run', requireInternalActor, async (req, res) => {
  if (req.header('x-actor-role') !== 'admin') return res.status(403).json({ error: 'admin_role_required' });
  res.json({ ranAt: now().toISOString(), sources: await runFreshness() });
});
app.locals.runFreshness = runFreshness;

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
    // Options are shuffled per attempt (audit A10); scoring compares values.
    attemptId, mode: 'fallback', items: safeItems.map(({ id, version, tier, answerType, choices, prompt, objectiveIds, sourceLinks, criticalSafety }) =>
      ({ id, version, tier, answerType, choices: Array.isArray(choices) ? deliveryChoices(choices, `${attemptId}:${id}`) : choices,
        prompt, objectiveIds, sourceLinks, criticalSafety: criticalSafety === true })) });
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

// Runs the source check on a timer; the timer never keeps the process alive.
// Off unless FRESHNESS_JOB_INTERVAL_MS is set, so tests and local runs fetch nothing.
function startFreshnessSchedule(app, intervalMs = Number(process.env.FRESHNESS_JOB_INTERVAL_MS)) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return null;
  // One allowlisted log record per run: how many sources ended in each result.
  const run = () => app.locals.runFreshness()
    .then((report) => telemetry.log('validation-activation', 'freshness_run', { operation: 'freshness',
      outcome: Object.entries(report.reduce((counts, line) => ({ ...counts, [line.result]: (counts[line.result] || 0) + 1 }), {}))
        .map(([result, count]) => `${result}=${count}`).join(' ') || 'no_active_package' }))
    .catch((error) => telemetry.log('validation-activation', 'freshness_run', { operation: 'freshness', outcome: `failed:${error.code || error.name}` }));
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return timer;
}

if (require.main === module) {
  const app = createApp();
  app.listen(process.env.PORT || 4010, () => console.log(`[validation-activation] listening on ${process.env.PORT || 4010}`));
  startFreshnessSchedule(app);
}
module.exports = { createApp, startFreshnessSchedule };
