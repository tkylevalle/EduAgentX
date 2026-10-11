'use strict';

const { createHash } = require('node:crypto');

const FRESHNESS_CLASSES = Object.freeze(['No Change', 'Watch', 'Patch', 'Substantive', 'Critical']);
const CHANGE_KIND_TO_CLASS = Object.freeze({ watch: 'Watch', editorial: 'Patch', material: 'Substantive', critical: 'Critical' });
const DEFAULT_FRESHNESS_DAYS = 30;

function contentDigest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isDue(lastCheckedAt, now = new Date(), intervalDays = DEFAULT_FRESHNESS_DAYS) {
  const interval = Number(intervalDays);
  if (!Number.isFinite(interval) || interval < 1 || interval > 3650) throw new TypeError('intervalDays must be between 1 and 3650');
  if (!lastCheckedAt) return true;
  const checked = new Date(lastCheckedAt).getTime();
  if (!Number.isFinite(checked)) return true;
  return now.getTime() - checked >= interval * 24 * 60 * 60 * 1000;
}

function classifyFreshness(source, evidence) {
  const errors = [];
  const required = ['observedAt', 'evidenceUrl', 'snapshotReference', 'contentSha256', 'changeKind', 'summary'];
  for (const field of required) if (typeof evidence?.[field] !== 'string' || !evidence[field].trim()) errors.push(`${field} is required`);
  if (evidence && !/^\d{4}-\d\d-\d\dT/.test(evidence.observedAt || '')) errors.push('observedAt must be an ISO timestamp');
  if (evidence && !/^[a-f0-9]{64}$/.test(evidence.contentSha256 || '')) errors.push('contentSha256 must be a SHA-256 digest');
  if (source?.canonicalUrl !== evidence?.evidenceUrl && source?.snapshotUrl !== evidence?.evidenceUrl) errors.push('evidenceUrl must match the pinned official source URL');
  if (evidence && evidence.contentSha256 !== source?.contentSha256 && !CHANGE_KIND_TO_CLASS[evidence.changeKind]) errors.push('changed content requires changeKind: watch, editorial, material, or critical');
  if (evidence && evidence.contentSha256 === source?.contentSha256 && evidence.changeKind !== 'unchanged') errors.push('unchanged content requires changeKind: unchanged');
  if (errors.length) return { errors };
  const classification = evidence.contentSha256 === source.contentSha256
    ? 'No Change'
    : CHANGE_KIND_TO_CLASS[evidence.changeKind];
  return {
    classification,
    evidence: {
      sourceId: source.id || source.sourceId,
      sourceUrl: evidence.evidenceUrl,
      snapshotReference: evidence.snapshotReference,
      previousContentSha256: source.contentSha256,
      observedContentSha256: evidence.contentSha256,
      previousEdition: source.edition || source.editionOrVersion || null,
      observedEdition: evidence.edition || null,
      observedAt: evidence.observedAt,
      changeKind: evidence.changeKind,
      summary: evidence.summary.trim(),
      affectedScope: evidence.affectedScope || null,
    },
  };
}

function verifySnapshot(bytes, expectedSha256) {
  if (!Buffer.isBuffer(bytes) || !/^[a-f0-9]{64}$/.test(expectedSha256 || '')) return false;
  return contentDigest(bytes) === expectedSha256;
}

module.exports = { FRESHNESS_CLASSES, CHANGE_KIND_TO_CLASS, DEFAULT_FRESHNESS_DAYS, isDue, classifyFreshness, verifySnapshot };
