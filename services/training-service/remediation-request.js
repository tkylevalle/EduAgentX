'use strict';

// Validates a structured remediation request at the service boundary. Pure:
// it returns either { details } listing every invalid field, or { value }
// with only the known fields and a digest that identifies the request's
// content, so a reused requestId with different content is detectable.
//
// {
//   requestId, agentLearnerKey, packageId, packageVersion,
//   objectiveIds: [1..20 unique ids],
//   cause: { type, reference, evidenceDigest: 'sha256:<64 hex>', observedAt: ISO-8601, summary? },
//   evidence: { mode, environment }
// }

const { createHash } = require('node:crypto');
const { EVIDENCE_ENVIRONMENTS } = require('../../packages/external-agent-protocol');

const IDENTIFIER = /^[\x20-\x7e]{1,256}$/;
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const CAUSE_TYPES = Object.freeze(['examination_failure', 'skill_gap', 'operator_review']);
const MAX_OBJECTIVES = 20;
const MAX_SUMMARY_CHARS = 500;
const REQUEST_FIELDS = ['requestId', 'agentLearnerKey', 'packageId', 'packageVersion', 'objectiveIds', 'cause', 'evidence'];
const CAUSE_FIELDS = ['type', 'reference', 'evidenceDigest', 'observedAt', 'summary'];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = (value) => typeof value === 'string' && IDENTIFIER.test(value);

function parseRemediationRequest(body) {
  if (!isObject(body)) return { details: ['body'] };
  const details = Object.keys(body).filter((key) => !REQUEST_FIELDS.includes(key)).map((key) => `unexpected:${key}`);
  for (const field of ['requestId', 'agentLearnerKey', 'packageId', 'packageVersion']) {
    if (!id(body[field])) details.push(field);
  }
  const objectiveIds = body.objectiveIds;
  if (!Array.isArray(objectiveIds) || !objectiveIds.length || objectiveIds.length > MAX_OBJECTIVES ||
    !objectiveIds.every(id) || new Set(objectiveIds).size !== objectiveIds.length) details.push('objectiveIds');
  details.push(...causeDetails(body.cause));
  const evidence = body.evidence;
  if (!isObject(evidence) || !Object.hasOwn(EVIDENCE_ENVIRONMENTS, evidence.mode) ||
    EVIDENCE_ENVIRONMENTS[evidence.mode] !== evidence.environment) details.push('evidence');
  if (details.length) return { details };

  const cause = {
    type: body.cause.type, reference: body.cause.reference, evidenceDigest: body.cause.evidenceDigest,
    observedAt: body.cause.observedAt, summary: body.cause.summary ?? null,
  };
  const value = {
    requestId: body.requestId, agentLearnerKey: body.agentLearnerKey, packageId: body.packageId,
    packageVersion: body.packageVersion, objectiveIds: [...objectiveIds], cause,
    evidence: { mode: evidence.mode, environment: evidence.environment },
  };
  const { requestId, ...content } = value;
  return { value: { ...value, requestDigest: `sha256:${createHash('sha256').update(JSON.stringify(content)).digest('hex')}` } };
}

function causeDetails(cause) {
  if (!isObject(cause)) return ['cause'];
  const details = Object.keys(cause).filter((key) => !CAUSE_FIELDS.includes(key)).map((key) => `unexpected:cause.${key}`);
  if (!CAUSE_TYPES.includes(cause.type)) details.push('cause.type');
  if (!id(cause.reference)) details.push('cause.reference');
  if (typeof cause.evidenceDigest !== 'string' || !SHA256_DIGEST.test(cause.evidenceDigest)) details.push('cause.evidenceDigest');
  if (typeof cause.observedAt !== 'string' || !ISO_TIMESTAMP.test(cause.observedAt) ||
    Number.isNaN(Date.parse(cause.observedAt))) details.push('cause.observedAt');
  if (cause.summary !== undefined && (typeof cause.summary !== 'string' || !cause.summary.length ||
    cause.summary.length > MAX_SUMMARY_CHARS)) details.push('cause.summary');
  return details;
}

module.exports = { CAUSE_TYPES, parseRemediationRequest };
