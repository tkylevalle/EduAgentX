'use strict';
/**
 * Signal vocabulary — approved terms only, never collapsed into one score.
 * Each domain has its own vocabulary.
 */

// Assurance Posture vocabulary
const ASSURANCE_POSTURE = Object.freeze({
  VERIFIED: 'VERIFIED',
  UNVERIFIED: 'UNVERIFIED',
  SUSPENDED: 'SUSPENDED',
  REVOKED: 'REVOKED',
  INDETERMINATE: 'INDETERMINATE',
});

// Operational Health vocabulary
const OPERATIONAL_HEALTH = Object.freeze({
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  UNHEALTHY: 'UNHEALTHY',
  UNKNOWN: 'UNKNOWN', // after 15s without refresh
});

// KPI Evidence vocabulary
const KPI_EVIDENCE = Object.freeze({
  MET: 'MET',
  NOT_MET: 'NOT_MET',
  UNMEASURED: 'UNMEASURED',
  RED: 'RED',
});

// Attention severity
const ATTENTION_SEVERITY = Object.freeze({
  CRITICAL: 'CRITICAL',
  WARNING: 'WARNING',
  INFO: 'INFO',
});

const STALE_THRESHOLD_MS = 15000; // 15 seconds
const LATENCY_TARGET_MS = 5000;
const LATENCY_MAX_MS = 10000;

module.exports = { ASSURANCE_POSTURE, OPERATIONAL_HEALTH, KPI_EVIDENCE, ATTENTION_SEVERITY, STALE_THRESHOLD_MS };
