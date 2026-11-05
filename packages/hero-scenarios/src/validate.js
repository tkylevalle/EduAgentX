'use strict';

const { SAFE_STATES, EVIDENCE_MODES, FAULT_FIELDS, REQUIRED_DEMONSTRATIONS } = require('./scenarios');

const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const BOUND_FIELDS = ['maxCalls', 'maxTokens', 'maxRuntimeSeconds', 'maxSpendUsd'];
const filled = (value) => (typeof value === 'string' ? value.trim().length > 0 : value !== null && value !== undefined);
const positive = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0;

function validateFault(scenario, report) {
  const fault = scenario.injectedFault;
  if (!fault || typeof fault !== 'object') return report('fault scenario must declare an injected fault');
  for (const field of FAULT_FIELDS) if (!filled(fault[field])) report(`injected fault is missing ${field}`);
  if (fault.safeState) {
    if (!SAFE_STATES.includes(fault.safeState.state)) report(`Safe State must be one of ${SAFE_STATES.join(', ')}`);
    if (!filled(fault.safeState.description)) report('Safe State needs a description');
  }
  const incident = fault.assuranceIncident;
  if (incident) {
    for (const field of ['category', 'cause', 'detection']) if (!filled(incident[field])) report(`Assurance Incident is missing ${field}`);
    if (!SEVERITIES.includes(incident.severity)) report(`Assurance Incident severity must be one of ${SEVERITIES.join(', ')}`);
    if (!Array.isArray(incident.affectedIdTypes) || incident.affectedIdTypes.length === 0) report('Assurance Incident needs affectedIdTypes');
  }
}

function validateLive(live, report) {
  for (const field of BOUND_FIELDS) if (!positive(live.bounds && live.bounds[field])) report(`live run needs a bound for ${field}`);
  const alt = live.replayAlternative;
  if (!alt) return report('live run needs a verified replay alternative');
  if (alt.evidenceMode !== 'replay') report('replay alternative must be labelled replay');
  for (const field of ['executorIdentity', 'fixtureRef', 'approval']) if (!filled(alt[field])) report(`replay alternative is missing ${field}`);
}

function validateScenario(scenario) {
  if (!scenario || typeof scenario !== 'object') return ['scenario must be an object'];
  const errors = [];
  const report = (message) => errors.push(`${scenario.id || 'unknown'}: ${message}`);

  for (const field of ['id', 'title', 'kind', 'expected', 'reset']) if (!filled(scenario[field])) report(`missing ${field}`);
  if (!['clean', 'fault', 'refusal'].includes(scenario.kind)) report('kind must be clean, fault or refusal');
  if (!Array.isArray(scenario.steps) || scenario.steps.length === 0) report('steps must be a non-empty list');
  if (!Array.isArray(scenario.evidenceRequired) || scenario.evidenceRequired.length === 0) report('evidenceRequired must be a non-empty list');
  if (!EVIDENCE_MODES.includes(scenario.evidenceMode)) report(`evidenceMode must be one of ${EVIDENCE_MODES.join(', ')}`);

  // Isolation: test keys, simulated tools, an isolated test learner.
  if (!scenario.keys || scenario.keys.kind !== 'test') report('must use test keys');
  if (!Array.isArray(scenario.tools)) report('tools must be a list');
  else for (const tool of scenario.tools) if (!/^simulated-/.test(tool)) report(`tool ${tool} is not simulated`);
  if (scenario.usesLearner === false) {
    if (scenario.learner !== null) report('learner must be null when usesLearner is false');
  } else if (!scenario.learner || scenario.learner.isolated !== true) {
    report('learner must be an isolated test Agent Learner');
  } else {
    if (!/-dev$/.test(scenario.learner.identity || '')) report('learner identity must be a dev or test identity');
    if (!EVIDENCE_MODES.includes(scenario.learner.executorMode)) report('learner executorMode is invalid');
    else if (scenario.learner.executorMode !== scenario.evidenceMode) report('evidenceMode must match the learner executorMode');
  }

  if (scenario.kind === 'fault') validateFault(scenario, report);
  else if (scenario.injectedFault !== null) report('only fault scenarios may declare an injected fault');

  if (scenario.live) validateLive(scenario.live, report);
  if (scenario.evidenceMode === 'live' && !scenario.live) report('live evidence needs bounds and a replay alternative');
  return errors;
}

function validateCatalog(catalog) {
  const errors = [];
  if (!Array.isArray(catalog)) return { valid: false, errors: ['catalog must be a list'] };
  catalog.forEach((scenario) => errors.push(...validateScenario(scenario)));

  const ids = catalog.map((scenario) => scenario && scenario.id);
  for (const id of REQUIRED_DEMONSTRATIONS) if (!ids.includes(id)) errors.push(`catalog: missing demonstration ${id}`);
  for (const id of ids) if (!REQUIRED_DEMONSTRATIONS.includes(id)) errors.push(`catalog: unexpected demonstration ${id}`);
  if (new Set(ids).size !== ids.length) errors.push('catalog: duplicate scenario ids');
  const faults = catalog.filter((scenario) => scenario && scenario.kind === 'fault').length;
  if (faults !== 6) errors.push(`catalog: expected 6 fault scenarios, found ${faults}`);
  return { valid: errors.length === 0, errors };
}

module.exports = { validateScenario, validateCatalog, SEVERITIES, BOUND_FIELDS };
