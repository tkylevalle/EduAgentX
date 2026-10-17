'use strict';
/**
 * W3C VC 2.0 verification engine.
 * Reports each check separately. Fails closed on tamper, unknown key/issuer, bad algorithm.
 */
const { verifyJws } = require('./signer');

const TRUSTED_ISSUERS = new Set([
  process.env.CREDENTIAL_ISSUER || 'did:example:eduagentx-dev-2026'
]);

/**
 * Verify a credential JWS and return a structured verification report.
 * Each check is reported independently.
 */
function verifyCredential(jws, publicKeyPem, statusStore = null) {
  const report = {
    signature: { status: 'UNCHECKED', reason: null },
    schema: { status: 'UNCHECKED', reason: null },
    time: { status: 'UNCHECKED', reason: null },
    suspension: { status: 'UNCHECKED', reason: null },
    revocation: { status: 'UNCHECKED', reason: null },
    issuerPolicy: { status: 'UNCHECKED', reason: null },
    credentialPolicy: { status: 'UNCHECKED', reason: null },
    overall: 'UNCHECKED',
    reasonCodes: [],
  };

  let credential;

  // ── 1. Signature ───────────────────────────────────────────────
  try {
    const result = verifyJws(jws, publicKeyPem);
    if (!result.valid) {
      report.signature = { status: 'FAIL', reason: 'signature_invalid' };
      report.reasonCodes.push('SIGNATURE_INVALID');
    } else {
      report.signature = { status: 'PASS', reason: null };
      credential = result.credential;
    }
  } catch (err) {
    report.signature = { status: 'FAIL', reason: err.message };
    report.reasonCodes.push('SIGNATURE_ERROR');
    report.overall = 'INVALID';
    return report;
  }

  // ── 2. Schema ──────────────────────────────────────────────────
  if (!credential) {
    report.overall = 'INVALID';
    return report;
  }
  const required = ['@context', 'type', 'id', 'issuer', 'issuanceDate', 'credentialSubject'];
  const missing = required.filter(f => !credential[f]);
  if (missing.length) {
    report.schema = { status: 'FAIL', reason: `missing fields: ${missing.join(', ')}` };
    report.reasonCodes.push('SCHEMA_INVALID');
  } else {
    report.schema = { status: 'PASS', reason: null };
  }

  // ── 3. Time validity ───────────────────────────────────────────
  const now = new Date();
  const issuance = new Date(credential.issuanceDate);
  const expiry = credential.expirationDate ? new Date(credential.expirationDate) : null;

  if (issuance > now) {
    report.time = { status: 'FAIL', reason: 'credential_not_yet_valid' };
    report.reasonCodes.push('NOT_YET_VALID');
  } else if (expiry && expiry < now) {
    report.time = { status: 'FAIL', reason: 'credential_expired' };
    report.reasonCodes.push('EXPIRED');
  } else {
    report.time = { status: 'PASS', reason: null };
  }

  // ── 4. Suspension ──────────────────────────────────────────────
  if (statusStore) {
    const status = statusStore.getStatus(credential.id);
    if (status === null) {
      report.suspension = { status: 'INDETERMINATE_STATUS', reason: 'status_unavailable' };
      report.reasonCodes.push('INDETERMINATE_STATUS');
    } else if (status === 'suspended') {
      report.suspension = { status: 'FAIL', reason: 'credential_suspended' };
      report.reasonCodes.push('SUSPENDED');
    } else {
      report.suspension = { status: 'PASS', reason: null };
    }

    // ── 5. Revocation ──────────────────────────────────────────
    if (status === 'revoked') {
      report.revocation = { status: 'FAIL', reason: 'credential_revoked' };
      report.reasonCodes.push('REVOKED');
    } else if (status === null) {
      report.revocation = { status: 'INDETERMINATE_STATUS', reason: 'status_unavailable' };
    } else {
      report.revocation = { status: 'PASS', reason: null };
    }
  } else {
    report.suspension = { status: 'INDETERMINATE_STATUS', reason: 'no_status_store' };
    report.revocation = { status: 'INDETERMINATE_STATUS', reason: 'no_status_store' };
    report.reasonCodes.push('INDETERMINATE_STATUS');
  }

  // ── 6. Issuer policy ───────────────────────────────────────────
  const issuer = typeof credential.issuer === 'string' ? credential.issuer : credential.issuer?.id;
  if (!TRUSTED_ISSUERS.has(issuer)) {
    report.issuerPolicy = { status: 'FAIL', reason: `untrusted_issuer: ${issuer}` };
    report.reasonCodes.push('UNTRUSTED_ISSUER');
  } else {
    report.issuerPolicy = { status: 'PASS', reason: null };
  }

  // ── 7. Credential policy ───────────────────────────────────────
  const types = credential.type || [];
  if (!types.includes('VerifiableCredential') || !types.includes('CompetencyCredential')) {
    report.credentialPolicy = { status: 'FAIL', reason: 'missing_required_type' };
    report.reasonCodes.push('INVALID_CREDENTIAL_TYPE');
  } else {
    report.credentialPolicy = { status: 'PASS', reason: null };
  }

  // ── Overall ────────────────────────────────────────────────────
  const hasIndeterminate = Object.values(report)
    .filter(v => v && typeof v === 'object' && v.status)
    .some(v => v.status === 'INDETERMINATE_STATUS');

  const hasFail = report.reasonCodes.some(c =>
    !['INDETERMINATE_STATUS'].includes(c)
  );

  if (hasFail) report.overall = 'INVALID';
  else if (hasIndeterminate) report.overall = 'INDETERMINATE';
  else report.overall = 'VALID';

  return report;
}

module.exports = { verifyCredential, TRUSTED_ISSUERS };
