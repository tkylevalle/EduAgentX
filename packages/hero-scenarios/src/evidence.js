'use strict';

const { createHash } = require('node:crypto');
const { EVIDENCE_MODES, INCIDENT_FIELDS } = require('./scenarios');

const SCHEMA = 'hero-evidence/1';
const SECRET_KEYS = new Set(['privatekey', 'signingkey', 'token', 'accesstoken', 'refreshtoken', 'password',
  'secret', 'clientsecret', 'apikey', 'rawanswer', 'expectedanswer', 'graderrationale', 'prompt']);
const JWS_SHAPE = /^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/;

const filled = (value) => (typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
const digestOf = (body) => createHash('sha256').update(canonical(body)).digest('hex');
const environmentFor = (mode) => (mode === 'live' ? 'live' : 'simulation');

// The modes a scenario may be run in: its own mode, plus replay when it has a
// replay alternative, plus live when a live run is optional.
function allowedModes(scenario) {
  const modes = new Set([scenario.evidenceMode]);
  if (scenario.live) {
    modes.add('replay');
    if (scenario.live.optional) modes.add('live');
  }
  return modes;
}
function identityFor(scenario, mode) {
  if (mode === 'replay' && scenario.live) return scenario.live.replayAlternative.executorIdentity;
  if (mode === 'live' && scenario.learner && scenario.learner.executorMode !== 'live') return 'live-agent-learner-dev';
  return scenario.learner ? scenario.learner.identity : null;
}

// Find secrets or raw credentials anywhere in the record.
function findSecrets(value, path = 'record') {
  const found = [];
  if (Array.isArray(value)) value.forEach((item, i) => found.push(...findSecrets(item, `${path}[${i}]`)));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_KEYS.has(key.toLowerCase())) found.push(`${path}.${key}`);
      else found.push(...findSecrets(child, `${path}.${key}`));
    }
  } else if (typeof value === 'string' && (JWS_SHAPE.test(value) || /^Bearer\s/i.test(value))) {
    found.push(path);
  }
  return found;
}

function createEvidenceRecord({ scenario, runId, executorMode, startedAt, finishedAt, artifacts = {}, checks = [], incident = null, outcome }) {
  if (!allowedModes(scenario).has(executorMode)) {
    throw new Error(`${scenario.id} cannot be run in ${executorMode} mode`);
  }
  let composedIncident = null;
  if (incident) {
    const fault = scenario.injectedFault;
    if (!fault) throw new Error(`${scenario.id} declares no fault, so it cannot have an incident`);
    composedIncident = {
      category: fault.assuranceIncident.category,
      severity: fault.assuranceIncident.severity,
      affectedIds: incident.affectedIds,
      cause: fault.assuranceIncident.cause,
      detection: fault.assuranceIncident.detection,
      safeState: fault.safeState.state,
      retryFallbackActions: fault.retryFallback,
      recoveryOutcome: incident.recoveryOutcome,
      detectedAt: incident.detectedAt,
      recoveredAt: incident.recoveredAt,
    };
  }
  const body = {
    schema: SCHEMA, scenarioId: scenario.id, runId, evidenceMode: executorMode, executorMode,
    environment: environmentFor(executorMode), learnerIdentity: identityFor(scenario, executorMode),
    startedAt, finishedAt, artifacts, checks, incident: composedIncident, outcome, noSecretsIncluded: true,
  };
  return Object.freeze({ ...body, digest: digestOf(body) });
}

function verifyEvidenceRecord(record, scenario) {
  const errors = [];
  const fail = (message) => errors.push(message);
  if (!record || typeof record !== 'object') return { valid: false, errors: ['record must be an object'] };

  if (record.schema !== SCHEMA) fail(`schema must be ${SCHEMA}`);
  if (record.scenarioId !== scenario.id) fail('scenarioId does not match the scenario');
  if (!filled(record.runId)) fail('runId is missing');
  if (!EVIDENCE_MODES.includes(record.evidenceMode)) fail('evidenceMode is invalid');
  if (record.evidenceMode !== record.executorMode) fail('evidenceMode must equal the executor mode that produced the run');
  if (!allowedModes(scenario).has(record.executorMode)) fail(`${scenario.id} cannot be run in ${record.executorMode} mode`);
  if (record.environment !== environmentFor(record.executorMode)) fail('environment does not match the evidence mode');
  if (record.learnerIdentity !== identityFor(scenario, record.executorMode)) fail('learner identity does not match the declared executor');

  const started = Date.parse(record.startedAt);
  const finished = Date.parse(record.finishedAt);
  if (Number.isNaN(started) || Number.isNaN(finished)) fail('startedAt and finishedAt must be valid timestamps');
  else if (finished < started) fail('finishedAt is before startedAt');

  if (!Array.isArray(record.checks) || record.checks.length === 0) fail('checks must be a non-empty list');
  else if (!record.checks.every((check) => filled(check && check.name) && typeof check.passed === 'boolean')) fail('every check needs a name and a passed flag');
  if (!filled(record.outcome)) fail('outcome is missing');
  if (!record.artifacts || typeof record.artifacts !== 'object') fail('artifacts must be an object');

  if (record.incident !== null && record.incident !== undefined) {
    const fault = scenario.injectedFault;
    if (!fault) fail('scenario declares no fault, so the record cannot carry an incident');
    else {
      for (const field of INCIDENT_FIELDS) {
        const value = record.incident[field];
        if (!filled(value) || (Array.isArray(value) && value.length === 0)) fail(`incident is missing ${field}`);
      }
      if (record.incident.safeState !== fault.safeState.state) fail('incident Safe State differs from the declared Safe State');
      if (record.incident.category !== fault.assuranceIncident.category) fail('incident category differs from the declaration');
    }
  }

  if (record.noSecretsIncluded !== true) fail('noSecretsIncluded must be true');
  for (const path of findSecrets(record)) fail(`secret or raw credential found at ${path}`);

  const { digest, ...body } = record;
  if (digest !== digestOf(body)) fail('digest does not match the record contents');
  return { valid: errors.length === 0, errors };
}

// All the records kept for one scenario must together cover the scenario.
function verifyEvidenceSet(scenario, records) {
  const errors = [];
  if (!Array.isArray(records) || records.length === 0) return { valid: false, errors: ['no evidence records'] };
  records.forEach((record, i) => {
    const result = verifyEvidenceRecord(record, scenario);
    result.errors.forEach((message) => errors.push(`record ${i}: ${message}`));
  });
  const covered = new Set(records.flatMap((record) => Object.keys((record && record.artifacts) || {})));
  const missing = scenario.evidenceRequired.filter((key) => !covered.has(key));
  if (missing.length) errors.push(`missing evidence artifacts: ${missing.join(', ')}`);
  if (scenario.kind === 'fault' && !records.some((record) => record && record.incident)) errors.push('no record carries the Assurance Incident');
  if (scenario.kind === 'fault' && scenario.evidenceMode === 'live') {
    const modes = new Set(records.map((record) => record && record.evidenceMode));
    if (!modes.has('live') || !modes.has('replay')) errors.push('live fault scenarios need both a live record and a replay record');
  }
  return { valid: errors.length === 0, errors };
}

module.exports = { createEvidenceRecord, verifyEvidenceRecord, verifyEvidenceSet, findSecrets, canonical, digestOf, SCHEMA };
