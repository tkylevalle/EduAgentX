'use strict';
// Curriculum routes: candidate package intake on curriculum-engine, and package
// governance on validation-activation (validate, review, resolve, activate,
// read) plus the two-person quarantine release. Each is forwarded only after
// the Gateway has verified the caller's token and role; the services trust the
// internal key and the subject derived here.

const telemetry = require('../../packages/telemetry');

/**
 * @param {import('express').Express} app
 * @param {{ requireRole: Function, proxyJson: Function, forwardJson: Function, proxyFailure: Function, serviceName: string,
 *   curriculumEngineUrl: string, curriculumInternalKey: string, validationActivationUrl: string,
 *   governanceApprovalStore: Map<string, object> }} deps  governanceApprovalStore holds first approvals awaiting a second
 */
function registerCurriculumRoutes(app, { requireRole, proxyJson, forwardJson, proxyFailure, serviceName,
  curriculumEngineUrl, curriculumInternalKey, validationActivationUrl, governanceApprovalStore }) {
  // Candidate package intake is admin-only. No Agent Learner route serves
  // these artifacts; activation and delivery are owned by later work.
  const curriculumHeaders = (req) => ({
    'x-internal-service-key': curriculumInternalKey,
    'x-actor-subject': req.auth.subject,
    'x-actor-role': req.auth.role,
  });
  app.post('/v1/admin/packages', requireRole('admin'), async (req, res) => {
    await proxyJson(req, res, `${curriculumEngineUrl}/internal/packages`, {
      method: 'POST', body: req.body, headers: curriculumHeaders(req),
    });
  });
  app.get('/v1/admin/packages/:packageId/:version', requireRole('admin'), async (req, res) => {
    await proxyJson(req, res,
      `${curriculumEngineUrl}/internal/packages/${encodeURIComponent(req.params.packageId)}/${encodeURIComponent(req.params.version)}`,
      { headers: curriculumHeaders(req) });
  });
  app.get('/v1/admin/packages/:packageId/:version/events', requireRole('admin'), async (req, res) => {
    await proxyJson(req, res,
      `${curriculumEngineUrl}/internal/packages/${encodeURIComponent(req.params.packageId)}/${encodeURIComponent(req.params.version)}/events`,
      { headers: curriculumHeaders(req) });
  });

  // Governance operations are forwarded only after Gateway JWT verification;
  // the downstream service trusts the internal key and the derived subject.
  app.post('/v1/admin/curriculum/packages', requireRole('admin'), async (req, res) => {
    await proxyJson(req, res, `${validationActivationUrl}/packages`,
      { method: 'POST', body: req.body, headers: curriculumHeaders(req) });
  });
  app.post('/v1/admin/curriculum/validate', requireRole('admin'), async (req, res) => {
    await proxyJson(req, res, `${validationActivationUrl}/validate`,
      { method: 'POST', body: req.body, headers: curriculumHeaders(req) });
  });
  app.post('/v1/curriculum/review', requireRole('reviewer', 'admin'), async (req, res) => {
    await proxyJson(req, res, `${validationActivationUrl}/review`,
      { method: 'POST', body: req.body, headers: curriculumHeaders(req) });
  });
  // A reviewer records how two reviewers' disagreement on a criterion was resolved.
  app.post('/v1/curriculum/review/resolutions', requireRole('reviewer', 'admin'), async (req, res) => {
    await proxyJson(req, res, `${validationActivationUrl}/review/resolutions`,
      { method: 'POST', body: req.body, headers: curriculumHeaders(req) });
  });
  // Every package and its state, so reviewers can find what awaits review.
  app.get('/v1/admin/curriculum/packages', requireRole('admin', 'reviewer'), async (req, res) => {
    await proxyJson(req, res, `${validationActivationUrl}/packages`, { headers: curriculumHeaders(req) });
  });
  app.post('/v1/admin/curriculum/activate', requireRole('admin'), async (req, res) => {
    await proxyJson(req, res, `${validationActivationUrl}/activate`,
      { method: 'POST', body: req.body, headers: curriculumHeaders(req) });
  });
  app.get('/v1/admin/curriculum/packages/:packageId/:version', requireRole('admin', 'reviewer'), async (req, res) => {
    await proxyJson(req, res,
      `${validationActivationUrl}/packages/${encodeURIComponent(req.params.packageId)}?version=${encodeURIComponent(req.params.version)}`,
      { headers: curriculumHeaders(req) });
  });

  // Issue #27: bounded Governance command, requiring two distinct approving
  // identities before it executes — the same two-person pattern already
  // used for curriculum review (two distinct reviewer subjects before
  // activation), now applied to quarantine release, one of the actions the
  // spec names as human-governance-controlled (corrections, key rotation,
  // policy changes, quarantine release). Either governance_operator or
  // admin may approve; any two DISTINCT subjects (not roles) complete it —
  // matching how /review counts distinct reviewer_id values regardless of
  // whether the caller was 'reviewer' or 'admin'.
  //
  // The Gateway never mutates state itself. On every call (first and
  // second) it rechecks authoritative state immediately before recording an
  // approval or acting — closing a real gap in validation-activation's own
  // restore route, which does not itself verify a scope is still
  // quarantined before restoring it. Only once two distinct, matching
  // approvals are gathered does it call the owning service, which performs
  // the mutation and records it in its own append-only evidence trail —
  // that evidence trail is the audit record for the action itself; the
  // pending-approval store here only ever tracks *who has approved so far*,
  // never a domain record.
  //
  // governance_operator (and viewer/evaluator/demo_operator) are
  // intentionally only ever added to routes meant for them — never to
  // curriculum/activate, training-remediations, or any other mutating
  // admin route — so none of these roles can edit a score, force a pass,
  // issue a credential, or touch immutable policy/evidence.
  app.post('/v1/admin/governance/packages/:packageId/quarantine-release',
    requireRole('governance_operator', 'admin'), async (req, res) => {
      const body = req.body;
      const scope = body?.scope;
      const checks = {
        version: typeof body?.version === 'string' && body.version.trim().length > 0,
        scope: Boolean(scope) && typeof scope === 'object' && !Array.isArray(scope) &&
          typeof scope.type === 'string' && typeof scope.id === 'string' && scope.id.trim().length > 0,
        reason: typeof body?.reason === 'string' && body.reason.trim().length > 0,
        evidenceReference: typeof body?.evidenceReference === 'string' && body.evidenceReference.trim().length > 0,
        restoredPackageId: typeof body?.restoredPackageId === 'string' && body.restoredPackageId.trim().length > 0,
      };
      const invalid = Object.keys(checks).filter((name) => !checks[name]);
      if (invalid.length) {
        return res.status(400).json({ apiVersion: 'v1', error: 'invalid_request', details: invalid, correlationId: req.correlationId });
      }

      let current;
      try {
        current = await forwardJson(req,
          `${validationActivationUrl}/packages/${encodeURIComponent(req.params.packageId)}?version=${encodeURIComponent(body.version)}`,
          { headers: curriculumHeaders(req) });
      } catch (error) {
        return proxyFailure(req, res, error);
      }
      if (current.status !== 200) return res.status(current.status).json(current.body);

      // Recheck authoritative state: the scope must be quarantined right now,
      // under this request, not merely when an operator last looked at it.
      // Done on every call, including the first approval, so a stale
      // approval can never be banked against a scope that is not (or is no
      // longer) quarantined.
      const stillQuarantined = (current.body.quarantinedScopes || [])
        .some((entry) => entry.scopeType === scope.type && entry.scopeId === scope.id);
      if (!stillQuarantined) {
        return res.status(409).json({ apiVersion: 'v1', error: 'scope_not_quarantined', correlationId: req.correlationId });
      }

      const key = `${req.params.packageId}:${scope.type}:${scope.id}`;
      const pending = governanceApprovalStore.get(key);
      const actor = req.auth.subject;

      if (!pending) {
        governanceApprovalStore.set(key, {
          firstActor: actor, firstRole: req.auth.role, version: body.version,
          restoredPackageId: body.restoredPackageId, evidenceReference: body.evidenceReference,
          reason: body.reason, recordedAt: new Date().toISOString(),
        });
        telemetry.log(serviceName, 'governance_approval_recorded',
          { correlationId: req.correlationId, packageId: req.params.packageId, scope, approvals: 1 });
        return res.status(202).json({
          apiVersion: 'v1', status: 'pending_second_approval', approvals: 1, requiredApprovals: 2,
          correlationId: req.correlationId,
        });
      }

      if (pending.firstActor === actor) {
        return res.status(409).json({ apiVersion: 'v1', error: 'duplicate_approver', correlationId: req.correlationId });
      }
      if (pending.version !== body.version || pending.restoredPackageId !== body.restoredPackageId ||
        pending.evidenceReference !== body.evidenceReference) {
        return res.status(409).json({ apiVersion: 'v1', error: 'approval_mismatch', correlationId: req.correlationId });
      }

      // Second, distinct, matching approval: execute. Clear the pending
      // entry first so this can never be completed twice, and combine both
      // approvers' stated reasons into the record the owning service keeps.
      governanceApprovalStore.delete(key);
      telemetry.log(serviceName, 'governance_second_approval_executing', {
        correlationId: req.correlationId, packageId: req.params.packageId, scope,
        firstActor: pending.firstActor, secondActor: actor,
      });
      const combinedReason = `Two-person governance approval. First approval by ${pending.firstActor}: ` +
        `${pending.reason} Second approval by ${actor}: ${body.reason}`;

      await proxyJson(req, res,
        `${validationActivationUrl}/packages/${encodeURIComponent(req.params.packageId)}/quarantines/restore`,
        {
          method: 'POST',
          headers: curriculumHeaders(req),
          body: {
            version: body.version,
            scope,
            reason: combinedReason,
            evidenceReference: body.evidenceReference,
            restoredPackageId: body.restoredPackageId,
          },
        });
    });
}

module.exports = { registerCurriculumRoutes };
