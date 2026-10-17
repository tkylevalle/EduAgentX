'use strict';
/**
 * Credential status store.
 * Suspension is reversible. Revocation is irreversible.
 * Historical status is preserved — never rewritten.
 */
const statusRecords = new Map(); // credentialId → { status, history: [] }

const STATUS_TRANSITIONS = {
  active: ['suspended', 'revoked'],
  suspended: ['active', 'revoked'],
  revoked: [], // irreversible
};

const statusStore = {
  getStatus(credentialId) {
    const record = statusRecords.get(credentialId);
    if (!record) return null; // INDETERMINATE
    return record.status;
  },

  getHistory(credentialId) {
    return statusRecords.get(credentialId)?.history || [];
  },

  register(credentialId) {
    if (statusRecords.has(credentialId)) return;
    statusRecords.set(credentialId, {
      status: 'active',
      history: [{ status: 'active', at: new Date().toISOString(), reason: 'issued' }]
    });
  },

  transition(credentialId, newStatus, reason = '') {
    const record = statusRecords.get(credentialId);
    if (!record) throw new Error(`credential ${credentialId} not found in status store`);

    const allowed = STATUS_TRANSITIONS[record.status] || [];
    if (!allowed.includes(newStatus))
      throw new Error(`cannot transition from ${record.status} to ${newStatus} — ${newStatus === 'active' && record.status === 'revoked' ? 'revocation is irreversible' : 'invalid transition'}`);

    record.history.push({ status: newStatus, at: new Date().toISOString(), reason });
    record.status = newStatus;
  },

  suspend(credentialId, reason) { this.transition(credentialId, 'suspended', reason); },
  reinstate(credentialId, reason) { this.transition(credentialId, 'active', reason); },
  revoke(credentialId, reason) { this.transition(credentialId, 'revoked', reason); },
};

module.exports = { statusStore };
