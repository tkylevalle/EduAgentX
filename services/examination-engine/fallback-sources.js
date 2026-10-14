'use strict';

// Issue #20: Engine-side client for validation-activation's POST /fallback/select
// and /fallback/score (Issue #14's routes, used as-is). Select returns the pinned
// bank without expected answers but never echoes the package version or digest,
// so the Engine binds the selection to the Active package it already fetched
// through governance.
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

// One request path for both routes: same headers, timeout and outage/refusal split.
function createClient({ validationUrl, curriculumKey, timeoutMs }) {
  if (!curriculumKey) throw new Error('curriculum key required');
  return async function post(path, payload, correlationId, refusedCode) {
    let response, text;
    try {
      response = await fetch(`${validationUrl}${path}`, { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-service-key': curriculumKey,
          'x-actor-subject': 'examination-engine', 'x-correlation-id': correlationId || '' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(timeoutMs) });
      text = await response.text();
    } catch { throw new DependencyError('validation-activation'); }
    // validation-activation maps any internal failure to 503: it could not decide, so it is down, not refusing.
    if (response.status >= 500) throw new DependencyError('validation-activation', 502);
    let body = null, parsed = false;
    try { body = JSON.parse(text); parsed = true; } catch { body = null; }
    if (!response.ok) throw refused(nonempty(body?.error) ? body.error : refusedCode, response.status);
    return { status: response.status, body, parsed, text };
  };
}

const defaults = () => ({ validationUrl: process.env.VALIDATION_ACTIVATION_URL || 'http://validation-activation:4010',
  curriculumKey: process.env.CURRICULUM_INTERNAL_KEY, timeoutMs: 2500 });
// /packages/active returns packageId; accept id too, as generation.js does.
const packageIdOf = (pkg) => pkg?.packageId || pkg?.id;

function createFallbackSelect(options = {}) {
  const post = createClient({ ...defaults(), ...options });
  return async function selectFallback({ pkg, reason, correlationId }) {
    const packageId = packageIdOf(pkg);
    // Without all three the selection could not be bound to an exact package.
    if (!nonempty(packageId) || !nonempty(pkg.version) || !nonempty(pkg.digest)) throw fail('active_package_required');
    const { status, body } = await post('/fallback/select', { package_id: packageId, reason }, correlationId,
      'fallback_select_refused');
    // Fail closed: a 200 is trusted only when its shape and package are exactly right.
    const checked = validateFallbackSelection(body);
    if (!checked.valid) throw refused('invalid_fallback_selection', status, checked.errors);
    if (body.packageId !== packageId) throw refused('fallback_package_mismatch', status);
    return { selection: body, packageVersion: pkg.version, packageDigest: pkg.digest };
  };
}

function createFallbackScore(options = {}) {
  const post = createClient({ ...defaults(), ...options });
  return async function scoreFallback({ pkg, vaSelectionId, responses, correlationId }) {
    const packageId = packageIdOf(pkg);
    if (!nonempty(packageId)) throw fail('active_package_required');
    if (!nonempty(vaSelectionId)) throw fail('fallback_selection_required');
    const { body, parsed, text } = await post('/fallback/score',
      { package_id: packageId, attemptId: vaSelectionId, responses }, correlationId, 'fallback_score_refused');
    // Returned as-is: mapFallbackResult judges the result, not this network client.
    return parsed ? body : text;
  };
}

module.exports = { createFallbackSelect, createFallbackScore };
