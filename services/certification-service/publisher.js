'use strict';

// Transactional outbox for issued credentials. Issuance commits the decision
// and credential first; this publisher then, on every sweep tick, delivers each
// credential that has no publication row yet:
//   1. registers its status with credential-verification (so /verify can
//      answer active rather than indeterminate),
//   2. appends a credential.issued envelope to the Redis stream that
//      marketplace-service projects (contract: docs/contracts/marketplace.md),
//   3. tells the read-only monitoring projection.
// Only 1 and 2 must succeed before the row is marked published; a failure
// leaves it pending and the next tick retries. Delivery is at-least-once, so
// the event id is stable per credential and consumers remove duplicates by it.

const telemetry = require('../../packages/telemetry');

const BATCH_SIZE = 20;
const REQUEST_TIMEOUT_MS = 2000;

function envelopeFor(row) {
  return {
    eventId: `credential.issued:${row.credentialId}`,
    eventType: 'credential.issued',
    credentialId: row.credentialId,
    agentLearnerKey: row.subjectId,
    occurredAt: row.issuedAt,
    credential: { credentialId: row.credentialId, credential: row.credential, compactJws: row.compactJws },
  };
}

function createCredentialPublisher({ pool, redis = null, stream = 'certification.credentials',
  verificationUrl = null, verificationKey = null, monitoringUrl = null, fetchImpl = fetch } = {}) {
  async function post(url, body, headers = {}) {
    const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  }

  async function pending() {
    const { rows } = await pool.query(`SELECT c.credential_id, c.credential, c.compact_jws, c.issued_at, d.subject_id
      FROM certification_engine.credentials c JOIN certification_engine.decisions d USING (decision_id)
      LEFT JOIN certification_engine.credential_publications p USING (credential_id)
      WHERE p.credential_id IS NULL ORDER BY c.issued_at, c.credential_id LIMIT $1`, [BATCH_SIZE]);
    return rows.map((row) => ({ credentialId: row.credential_id, credential: row.credential, compactJws: row.compact_jws,
      issuedAt: new Date(row.issued_at).toISOString(), subjectId: row.subject_id }));
  }

  async function deliver(row) {
    if (verificationUrl) {
      await post(`${verificationUrl}/status/register`, { credentialId: row.credentialId },
        verificationKey ? { 'x-internal-service-key': verificationKey } : {});
    }
    if (redis) {
      if (!redis.isReady) throw new Error('redis_unavailable');
      await redis.xAdd(stream, '*', { envelope: JSON.stringify(envelopeFor(row)) });
    }
    await pool.query(`INSERT INTO certification_engine.credential_publications (credential_id, published_at)
      VALUES ($1, now()) ON CONFLICT (credential_id) DO NOTHING`, [row.credentialId]);
    if (monitoringUrl) {
      post(`${monitoringUrl}/events`, { type: 'credential.issued', agentId: row.subjectId,
        certificationId: row.credentialId, severity: 'INFO', source: 'certification-service' }).catch(() => {});
    }
  }

  async function publishPending() {
    let published = 0;
    for (const row of await pending()) {
      try {
        await deliver(row);
        published += 1;
      } catch (error) {
        telemetry.log('certification-service', 'credential_publication_deferred', { outcome: error.message });
        break; // keep issue order; retry from this credential on the next tick
      }
    }
    return published;
  }

  return { publishPending };
}

module.exports = { createCredentialPublisher, envelopeFor };
