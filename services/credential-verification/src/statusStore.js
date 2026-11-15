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

// A refused change (unknown credential, invalid transition) is the caller's
// problem; any other error from the store means the change was not persisted.
class StatusTransitionError extends Error {}

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
  let saved;
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    // Starting empty would turn revoked credentials back into unknown ones.
    throw new Error(`credential status file ${file} is unreadable (${error.message}); refusing to start`);
  }
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

  /** @param {string} credentialId @returns {number | null} the credential's status list index, or null when it has none */
  getIndex(credentialId) {
    const index = statusRecords.get(statusKey(credentialId))?.statusListIndex;
    return Number.isSafeInteger(index) ? index : null;
  },

  isKnown(credentialId) {
    return statusRecords.has(statusKey(credentialId));
  },

  // statusListIndex: the credential's bit in the signed status lists, chosen by
  // the issuer before signing. One index belongs to one credential.
  register(credentialId, statusListIndex = null) {
    const key = statusKey(credentialId);
    const existing = statusRecords.get(key);
    if (existing) {
      if (statusListIndex !== null && existing.statusListIndex !== statusListIndex)
        throw new StatusTransitionError(`credential ${credentialId} is registered with another status list index`);
      return;
    }
    if (statusListIndex !== null && [...statusRecords.values()].some((record) => record.statusListIndex === statusListIndex))
      throw new StatusTransitionError(`status list index ${statusListIndex} belongs to another credential`);
    statusRecords.set(key, {
      status: 'active', ...(statusListIndex !== null ? { statusListIndex } : {}),
      history: [{ status: 'active', at: new Date().toISOString(), reason: 'issued' }]
    });
    try { save(); } catch (error) { statusRecords.delete(key); throw error; }
  },

  /** @param {string} status @returns {number[]} the list indices of credentials in this status */
  indicesWith(status) {
    return [...statusRecords.values()].filter((record) => record.status === status && Number.isSafeInteger(record.statusListIndex))
      .map((record) => record.statusListIndex);
  },

  transition(credentialId, newStatus, reason = '') {
    const key = statusKey(credentialId);
    const record = statusRecords.get(key);
    if (!record) throw new StatusTransitionError(`credential ${credentialId} not found in status store`);

    const allowed = STATUS_TRANSITIONS[record.status] || [];
    if (!allowed.includes(newStatus))
      throw new StatusTransitionError(`cannot transition from ${record.status} to ${newStatus} — ${newStatus === 'active' && record.status === 'revoked' ? 'revocation is irreversible' : 'invalid transition'}`);

    // Memory changes only once the new record is on disk.
    // Keep the record's other fields, such as its status list index.
    statusRecords.set(key, { ...record, status: newStatus, history: [...record.history, { status: newStatus, at: new Date().toISOString(), reason }] });
    try { save(); } catch (error) { statusRecords.set(key, record); throw error; }
  },

  suspend(credentialId, reason) { this.transition(credentialId, 'suspended', reason); },
  reinstate(credentialId, reason) { this.transition(credentialId, 'active', reason); },
  revoke(credentialId, reason) { this.transition(credentialId, 'revoked', reason); },
};

load();

module.exports = { statusStore, statusKey, StatusTransitionError };
