const express = require('express');
const crypto = require('crypto');
const app = express();
app.use(express.json());

const { runValidationGates } = require('./gates');
const { submitReview, getReviews } = require('./reviews');
const { activatePackage } = require('./activation');
const { db } = require('./db');

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'validation-activation' });
});

// POST /packages — ingest a package from curriculum-engine
// Accepts both { id } and { manifest: { packageId } } shapes
app.post('/packages', async (req, res) => {
  const pkg = req.body;
  // Normalise: curriculum-engine sends manifest.packageId
  const id = pkg.id || pkg.manifest?.packageId;
  if (!id) return res.status(400).json({ error: 'missing_package_id', hint: 'provide id or manifest.packageId' });
  const normalised = { ...pkg, id };
  const digest = crypto.createHash('sha256').update(JSON.stringify(normalised)).digest('hex');
  await db.seedPackage({ ...normalised, digest });
  res.status(201).json({ packageId: id, digest, state: 'Candidate' });
});

// POST /validate — run 6 gates on a candidate package
app.post('/validate', async (req, res) => {
  const { package_id } = req.body;
  if (!package_id) return res.status(400).json({ error: 'missing_package_id' });
  const pkg = await db.getPackage(package_id);
  if (!pkg) return res.status(404).json({ error: 'package_not_found' });
  if (pkg.state !== 'Candidate') return res.status(409).json({ error: 'not_candidate', state: pkg.state });
  const result = await runValidationGates(pkg);
  await db.appendEvidence(package_id, { event: 'validation_run', result, ts: new Date().toISOString() });
  if (!result.passed) {
    await db.setPackageState(package_id, 'Invalid');
    return res.status(422).json({ error: 'validation_failed', gates: result.gates });
  }
  await db.setPackageState(package_id, 'AwaitingReview');
  res.json({ passed: true, gates: result.gates, state: 'AwaitingReview' });
});

// POST /review — submit reviewer approval
app.post('/review', async (req, res) => {
  const { package_id, reviewer_id, score, approved } = req.body;
  if (!package_id || !reviewer_id || score === undefined || approved === undefined)
    return res.status(400).json({ error: 'missing_fields' });
  const pkg = await db.getPackage(package_id);
  if (!pkg) return res.status(404).json({ error: 'package_not_found' });
  if (pkg.state !== 'AwaitingReview') return res.status(409).json({ error: 'not_awaiting_review', state: pkg.state });
  const existing = await getReviews(package_id);
  if (existing.find(r => r.reviewer_id === reviewer_id)) return res.status(409).json({ error: 'duplicate_reviewer' });
  if (score < 3.5) return res.status(422).json({ error: 'score_below_floor', min: 3.5, received: score });
  await submitReview(package_id, { reviewer_id, score, approved, ts: new Date().toISOString() });
  await db.appendEvidence(package_id, { event: 'review_submitted', reviewer_id, score, approved, ts: new Date().toISOString() });
  const reviews = await getReviews(package_id);
  const approvals = reviews.filter(r => r.approved && r.score >= 3.5);
  res.json({ reviews: reviews.length, approvals: approvals.length, ready_to_activate: approvals.length >= 2 });
});

// POST /activate — atomically activate after 2 approvals
app.post('/activate', async (req, res) => {
  const { package_id } = req.body;
  if (!package_id) return res.status(400).json({ error: 'missing_package_id' });
  const pkg = await db.getPackage(package_id);
  if (!pkg) return res.status(404).json({ error: 'package_not_found' });
  if (pkg.state !== 'AwaitingReview') return res.status(409).json({ error: 'not_awaiting_review' });
  const reviews = await getReviews(package_id);
  const approvals = reviews.filter(r => r.approved && r.score >= 3.5);
  const distinctReviewers = new Set(approvals.map(r => r.reviewer_id));
  if (distinctReviewers.size < 2)
    return res.status(403).json({ error: 'insufficient_approvals', required: 2, distinct_approvers: distinctReviewers.size });
  const avgScore = approvals.reduce((sum, r) => sum + r.score, 0) / approvals.length;
  if (avgScore < 4.0) return res.status(422).json({ error: 'score_below_target', target: 4.0, average: avgScore });
  const result = await activatePackage(package_id);
  await db.appendEvidence(package_id, { event: 'activated', previous_active: result.superseded_id, ts: new Date().toISOString() });
  res.json({ activated: true, packageId: package_id, superseded_id: result.superseded_id });
});

// GET /packages/active — active package with digest + packageId for training service
app.get('/packages/active', async (req, res) => {
  const pkg = await db.getActivePackage();
  if (!pkg) return res.status(404).json({ error: 'no_active_package' });
  const evidence = await db.getEvidence(pkg.id);
  res.json({
    packageId: pkg.id,
    digest: pkg.digest || null,
    version: pkg.version,
    state: pkg.state,
    examTemplate: pkg.examination_template,
    fallbackBank: pkg.fallback_bank,
    objectives: pkg.objectives,
    modules: pkg.modules,
    rubric: pkg.rubric,
    evidence
  });
});

// GET /packages/:id — full package state + evidence
app.get('/packages/:id', async (req, res) => {
  const pkg = await db.getPackage(req.params.id);
  if (!pkg) return res.status(404).json({ error: 'not_found' });
  const evidence = await db.getEvidence(req.params.id);
  const reviews = await getReviews(req.params.id);
  res.json({ packageId: pkg.id, digest: pkg.digest || null, ...pkg, evidence, reviews });
});

// GET /packages — list all packages
app.get('/packages', async (req, res) => {
  const packages = await db.listPackages();
  res.json(packages.map(p => ({ packageId: p.id, digest: p.digest || null, state: p.state, version: p.version })));
});

const PORT = process.env.PORT || 4010;
app.listen(PORT, () => console.log(`[validation-activation] listening on ${PORT}`));
