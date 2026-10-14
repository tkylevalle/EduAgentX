'use strict';

// Issue #20: Engine-side client for validation-activation's POST /fallback/select
// (Issue #14's route, used as-is). It returns the pinned bank without expected
// answers but never echoes the package version or digest, so the Engine binds
// the selection to the Active package it already fetched through governance.
const { DependencyError } = require('./sources');
const { fail } = require('./lifecycle');
const { validateFallbackSelection } = require('./fallback-form');

const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;

// "Reachable but refused", kept distinct from DependencyError ("down"). Follows
// the Engine's fail() convention. Status 409 because index.js's sendError only
// forwards 400/403/404/409, and an upstream 400/404 is not the learner's fault;
// the upstream status is kept for evidence.
const refused = (code, upstreamStatus, details) => Object.assign(fail(code, 409),
  { source: 'validation-activation', upstreamStatus, ...(details ? { details } : {}) });

function createFallbackSelect({
  validationUrl = process.env.VALIDATION_ACTIVATION_URL || 'http://validation-activation:4010',
  curriculumKey = process.env.CURRICULUM_INTERNAL_KEY,
  timeoutMs = 2500,
} = {}) {
  if (!curriculumKey) throw new Error('curriculum key required');
  return async function selectFallback({ pkg, reason, correlationId }) {
    // /packages/active returns packageId; accept id too, as generation.js does.
    const packageId = pkg?.packageId || pkg?.id;
    // Without all three the selection could not be bound to an exact package.
    if (!nonempty(packageId) || !nonempty(pkg.version) || !nonempty(pkg.digest)) throw fail('active_package_required');
    let response, text;
    try {
      response = await fetch(`${validationUrl}/fallback/select`, { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-service-key': curriculumKey,
          'x-actor-subject': 'examination-engine', 'x-correlation-id': correlationId || '' },
        body: JSON.stringify({ package_id: packageId, reason }), signal: AbortSignal.timeout(timeoutMs) });
      text = await response.text();
    } catch { throw new DependencyError('validation-activation'); }
    // validation-activation maps any internal failure to 503: it could not decide, so it is down, not refusing.
    if (response.status >= 500) throw new DependencyError('validation-activation', 502);
    let body = null;
    try { body = JSON.parse(text); } catch { body = null; }
    if (!response.ok) throw refused(nonempty(body?.error) ? body.error : 'fallback_select_refused', response.status);
    // Fail closed: a 200 is trusted only when its shape and package are exactly right.
    const checked = validateFallbackSelection(body);
    if (!checked.valid) throw refused('invalid_fallback_selection', response.status, checked.errors);
    if (body.packageId !== packageId) throw refused('fallback_package_mismatch', response.status);
    return { selection: body, packageVersion: pkg.version, packageDigest: pkg.digest };
  };
}

module.exports = { createFallbackSelect };
