'use strict';

// The scheduled source check (target design 3.2 step 7; assurance audit C5):
// the service fetches each pinned source itself instead of trusting evidence
// a caller supplies. A PDF must still match its pinned SHA-256. A legislation
// page must still contain every stored section the package quotes. An
// embedded sample policy has no public copy; its owner maintains it, so the
// job reports it as not fetchable. A detected change is recorded as Watch: a
// person classifies it (editorial, material or critical) through the
// freshness-check route, which creates the candidate or the quarantine. A
// source that cannot be fetched records nothing and is retried next run.

const { createHash } = require('node:crypto');
const { isDue } = require('./freshness');
const { normalise } = require('../../curriculum-engine/sections');

// A publication or an article page is well under this; anything larger is not the source.
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
// One slow publisher must not hold up the run.
const FETCH_TIMEOUT_MS = 20000;
const USER_AGENT = 'EduAgentX-freshness-check/1.0';
const ACTOR = 'freshness-job';
const NAMED_ENTITIES = Object.freeze({ amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' });

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

/** @param {string} html @returns {string} the page's visible text, entities decoded and whitespace collapsed */
function pageText(html) {
  const text = String(html)
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (entity, name) => NAMED_ENTITIES[name.toLowerCase()] ?? entity);
  return normalise(text);
}

async function download(fetchImpl, url) {
  const response = await fetchImpl(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`http_${response.status}`);
  if (Number(response.headers.get('content-length')) > MAX_SOURCE_BYTES) throw new Error('source_too_large');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_SOURCE_BYTES) throw new Error('source_too_large');
  return bytes;
}

/**
 * Fetches one source and compares it with what the package pinned.
 * @param {object} source  the package's source record
 * @param {object[]} sections  the package's stored sections of this source
 * @param {Function} fetchImpl  fetch
 * @returns {Promise<{ status: 'unchanged' | 'changed' | 'not_fetchable', contentSha256?: string, missingSectionIds?: string[], bytes?: number }>}
 */
async function observeSource(source, sections, fetchImpl) {
  if (source.snapshotKind === 'pdf') {
    const bytes = await download(fetchImpl, source.snapshotUrl);
    const contentSha256 = sha256(bytes);
    return { status: contentSha256 === source.contentSha256 ? 'unchanged' : 'changed', contentSha256, bytes: bytes.length };
  }
  if (source.snapshotKind === 'html-sections') {
    const pages = new Map();
    for (const url of [...new Set(sections.map((section) => section.url))]) pages.set(url, pageText((await download(fetchImpl, url)).toString('utf8')));
    const missingSectionIds = sections.filter((section) => !pages.get(section.url).includes(normalise(section.text))).map((section) => section.id);
    // Unchanged pages keep the pinned digest; a changed page set gets the digest of what was fetched.
    const contentSha256 = missingSectionIds.length ? sha256([...pages.values()].join('\n')) : source.contentSha256;
    return { status: missingSectionIds.length ? 'changed' : 'unchanged', contentSha256, missingSectionIds };
  }
  return { status: 'not_fetchable' };
}

/** @returns {object} freshness evidence in the shape classifyFreshness accepts */
function evidenceFor(source, observed, observedAt) {
  const changed = observed.status === 'changed';
  const what = source.snapshotKind === 'pdf' ? `the published file (${observed.bytes} bytes)` : 'the stored sections on the published pages';
  return {
    observedAt, evidenceUrl: source.snapshotUrl, snapshotReference: `${ACTOR} fetch at ${observedAt}`, contentSha256: observed.contentSha256,
    changeKind: changed ? 'watch' : 'unchanged',
    summary: changed
      ? `Automated check: ${what} no longer match the pinned content${observed.missingSectionIds?.length ? ` (sections not found: ${observed.missingSectionIds.join(', ')})` : ''}. A reviewer must classify the change.`
      : `Automated check: ${what} match the pinned content.`,
  };
}

/**
 * Checks every due source of every Active package and records the result.
 * @param {{ packageDb: object, record: (pkg: object, sourceId: string, evidence: object, actor: string) => Promise<object>,
 *   fetchImpl?: Function, now?: () => Date, intervalDays?: number }} deps  record: the freshness-check write the route uses
 * @returns {Promise<object[]>} one line per source: package, source, and checked, changed, skipped or unreachable
 */
async function runFreshnessJob({ packageDb, record, fetchImpl = fetch, now = () => new Date(), intervalDays }) {
  const report = [];
  for (const pkg of await packageDb.getActivePackages()) {
    const checks = await packageDb.getFreshnessChecks(pkg.id, pkg.version);
    const last = new Map(checks.map((check) => [check.sourceId, check.checkedAt]));
    for (const source of pkg.sources || []) {
      const line = { packageId: pkg.id, version: pkg.version, sourceId: source.id };
      if (!isDue(last.get(source.id), now(), intervalDays)) { report.push({ ...line, result: 'not_due' }); continue; }
      let observed;
      try { observed = await observeSource(source, (pkg.sourceSections || []).filter((section) => section.sourceId === source.id), fetchImpl); }
      catch (error) { report.push({ ...line, result: 'unreachable', reason: String(error.message || error) }); continue; }
      if (observed.status === 'not_fetchable') { report.push({ ...line, result: 'not_fetchable' }); continue; }
      const outcome = await record(pkg, source.id, evidenceFor(source, observed, now().toISOString()), ACTOR);
      report.push({ ...line, result: observed.status, classification: outcome.classification, missingSectionIds: observed.missingSectionIds || [] });
    }
  }
  return report;
}

module.exports = { ACTOR, MAX_SOURCE_BYTES, observeSource, pageText, runFreshnessJob };
