'use strict';
/**
 * Credential status store.
 * Suspension is reversible. Revocation is irreversible.
 * Historical status is preserved — never rewritten.
 *
 * Records are keyed by the credential's own UUID, so a caller may name a
 * credential by that UUID or by its full VC id (<credentialBase>/<uuid>).
 * When CREDENTIAL_STATUS_PATH is set the records are written to that file
 * after every change and read back on start, so a restart keeps status.
 */
const fs = require('node:fs');
const path = require('node:path');

const statusRecords = new Map(); // credential key → { status, history: [] }

const STATUS_TRANSITIONS = {
  active: ['suspended', 'revoked'],
  suspended: ['active', 'revoked'],
  revoked: [], // irreversible
};

function statusKey(credentialId) {
  if (typeof credentialId !== 'string') return credentialId;
  const slash = credentialId.lastIndexOf('/');
  return slash === -1 ? credentialId : credentialId.slice(slash + 1);
}

function persistencePath() {
  return process.env.CREDENTIAL_STATUS_PATH || null;
}

function load() {
  const file = persistencePath();
  if (!file || !fs.existsSync(file)) return;
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const [key, record] of Object.entries(saved)) statusRecords.set(key, record);
}

function save() {
  const file = persistencePath();
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(Object.fromEntries(statusRecords)));
  fs.renameSync(temporary, file);
}

const statusStore = {
  getStatus(credentialId) {
    const record = statusRecords.get(statusKey(credentialId));
    if (!record) return null; // INDETERMINATE
    return record.status;
  },

  getHistory(credentialId) {
    return statusRecords.get(statusKey(credentialId))?.history || [];
  },

  isKnown(credentialId) {
    return statusRecords.has(statusKey(credentialId));
  },

  register(credentialId) {
    const key = statusKey(credentialId);
    if (statusRecords.has(key)) return;
    statusRecords.set(key, {
      status: 'active',
      history: [{ status: 'active', at: new Date().toISOString(), reason: 'issued' }]
    });
    save();
  },

  transition(credentialId, newStatus, reason = '') {
    const record = statusRecords.get(statusKey(credentialId));
    if (!record) throw new Error(`credential ${credentialId} not found in status store`);

    const allowed = STATUS_TRANSITIONS[record.status] || [];
    if (!allowed.includes(newStatus))
      throw new Error(`cannot transition from ${record.status} to ${newStatus} — ${newStatus === 'active' && record.status === 'revoked' ? 'revocation is irreversible' : 'invalid transition'}`);

    record.history.push({ status: newStatus, at: new Date().toISOString(), reason });
    record.status = newStatus;
    save();
  },

  suspend(credentialId, reason) { this.transition(credentialId, 'suspended', reason); },
  reinstate(credentialId, reason) { this.transition(credentialId, 'active', reason); },
  revoke(credentialId, reason) { this.transition(credentialId, 'revoked', reason); },
};

load();

module.exports = { statusStore, statusKey };
