'use strict';

const { sha256 } = require('../curriculum-engine/model');
const { checkAssessment } = require('./assessment');
const KEY = /^[\x20-\x7e]{1,256}$/;
const REASONS = ['infrastructure_failure', 'governance_changed', 'grading_unavailable'];
const terminalTypes = { attempt_completed: 'complete', agent_failed: 'agent_failed', system_aborted: 'system_aborted' };
const fail = (code, status = 409) => Object.assign(new Error(code), { code, status });
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === fields.length && fields.every((key) => Object.hasOwn(value, key));

function validateCommand(command) {
  if (!command || !['response', 'finalize', 'abort', 'timeout', 'system_abort'].includes(command.type))
    throw fail('invalid_request', 400);
  if (!Number.isFinite(Date.parse(command.now))) throw fail('invalid_request', 400);
  if (command.type === 'timeout') return;
  if (command.type === 'system_abort') {
    if (!REASONS.includes(command.reason)) throw fail('invalid_request', 400);
    return;
  }
  if (typeof command.idempotencyKey !== 'string' || !KEY.test(command.idempotencyKey) ||
    !Number.isSafeInteger(command.expectedSequence) || command.expectedSequence < 1) throw fail('invalid_request', 400);
  if (command.type === 'response') {
    if (typeof command.itemId !== 'string' || !command.itemId || typeof command.response !== 'string' ||
      !command.response.trim() || command.response.length > 16000 || command.response.includes('\0') ||
      Buffer.from(command.response, 'utf8').toString('utf8') !== command.response) throw fail('invalid_request', 400);
  } else {
    if (typeof command.eventId !== 'string' || !KEY.test(command.eventId)) throw fail('invalid_request', 400);
    if (command.type === 'abort' && !REASONS.includes(command.reason)) throw fail('invalid_request', 400);
    if (command.type === 'finalize' && (!exact(command.result, ['schemaVersion', 'valid', 'passed']) ||
      command.result.schemaVersion !== 'examination-result/1.0.0' || command.result.valid !== true ||
      typeof command.result.passed !== 'boolean' ||
      ['formDigest', 'rubricDigest', 'responseSetDigest'].some((key) => typeof command[key] !== 'string' || !command[key])))
      throw fail('invalid_result', 400);
  }
}

function commandDigest(attemptId, command) {
  const semantic = { attemptId, type: command.type, expectedSequence: command.expectedSequence };
  for (const name of ['itemId', 'response', 'eventId', 'formDigest', 'rubricDigest', 'responseSetDigest', 'result', 'reason',
    'assessment'])
    if (command[name] !== undefined) semantic[name] = command[name];
  return sha256(semantic);
}

// The event log is authoritative. There is no separately mutable status column.
function derive(attempt, events, responses) {
  const state = { status: 'in_progress', sequence: 0, responsesReceived: 0, responseCollectionComplete: false,
    terminalReason: null, completedAt: null, failedAt: null, abortedAt: null, assessment: null, result: null };
  if (sha256(attempt.form) !== attempt.formDigest || attempt.form.subject.agentLearnerKey !== attempt.agentLearnerKey ||
    attempt.form.subject.configurationFingerprint !== attempt.configurationFingerprint || attempt.form.mode !== attempt.mode ||
    sha256(attempt.form.package) !== sha256(attempt.package) || Date.parse(attempt.deadlineAt) <= Date.parse(attempt.startedAt))
    throw fail('invalid_manifest');
  const answered = new Set(), identities = new Set();
  let grade = null, previousTime = Date.parse(attempt.startedAt);
  const orderedDigest = () => sha256(attempt.form.items.flatMap((item) => {
    const response = responses.find((value) => value.itemId === item.id && answered.has(item.id));
    return response ? [{ itemId: item.id, responseDigest: response.responseDigest }] : [];
  }));
  for (const event of events) {
    const time = Date.parse(event.occurredAt);
    if (event.seq !== state.sequence + 1 || state.status !== 'in_progress' || !Number.isFinite(time) || time < previousTime ||
      (event.eventId && identities.has(event.eventId)) || (event.attemptId && event.attemptId !== attempt.attemptId))
      throw fail('invalid_event_history');
    if (event.eventId) identities.add(event.eventId);
    if (event.seq === 1) {
      if (event.eventType !== 'attempt_started' || time !== Date.parse(attempt.startedAt)) throw fail('invalid_event_history');
    } else if (event.eventType === 'response_accepted') {
      const row = responses.find((r) => r.itemId === event.payload?.itemId);
      if (grade || !row || answered.has(row.itemId) || !attempt.form.items.some((item) => item.id === row.itemId) ||
        time >= Date.parse(attempt.deadlineAt) || row.seq !== event.seq || Date.parse(row.acceptedAt) !== time ||
        row.responseDigest !== event.payload.responseDigest || sha256(row.response) !== row.responseDigest)
        throw fail('invalid_event_history');
      answered.add(row.itemId);
      state.responsesReceived++;
    } else if (event.eventType === 'grade_recorded') {
      const payload = event.payload;
      if (grade || answered.size !== attempt.form.items.length || !payload ||
        !exact(payload.result, ['schemaVersion','valid','passed']) || payload.result.schemaVersion !== 'examination-result/1.0.0' ||
        payload.result.valid !== true || typeof payload.result.passed !== 'boolean' || payload.formDigest !== attempt.formDigest ||
        payload.rubricDigest !== attempt.form.rubric.digest || payload.responseSetDigest !== orderedDigest() ||
        (payload.assessment !== undefined && !checkAssessment(payload.assessment, attempt.form, payload.result.passed)))
        throw fail('invalid_event_history');
      grade = payload.result;
      state.assessment = payload.assessment ?? null;
      state.result = payload.result;
    } else if (terminalTypes[event.eventType]) {
      const reason = event.payload?.reason;
      if ((event.eventType === 'attempt_completed' && (!grade?.passed || reason !== 'valid_passing_result')) ||
        (event.eventType === 'agent_failed' && (grade ? grade.passed || reason !== 'valid_failing_result' :
          reason !== 'response_deadline_elapsed' || answered.size === attempt.form.items.length || time < Date.parse(attempt.deadlineAt))) ||
        (event.eventType === 'system_aborted' && (grade || !REASONS.includes(reason)))) throw fail('invalid_event_history');
      state.status = terminalTypes[event.eventType];
      state.terminalReason = reason;
      state[{ complete: 'completedAt', agent_failed: 'failedAt', system_aborted: 'abortedAt' }[state.status]] = event.occurredAt;
    } else throw fail('invalid_event_history');
    state.sequence = event.seq;
    previousTime = time;
  }
  if (state.sequence === 0 || (grade && state.status === 'in_progress')) throw fail('invalid_event_history');
  state.responseCollectionComplete = answered.size === attempt.form.items.length;
  if (responses.length !== answered.size || new Set(responses.map((r) => r.itemId)).size !== responses.length)
    throw fail('invalid_response_history');
  return { ...attempt, ...state, responseSetDigest: orderedDigest(), events, responses };
}

function stateReceipt(snapshot) {
  const state = {};
  for (const key of ['status', 'sequence', 'responsesReceived', 'responseCollectionComplete', 'terminalReason',
    'completedAt', 'failedAt', 'abortedAt']) state[key] = snapshot[key];
  return state;
}

function isResponseExpired(snapshot, now) {
  return snapshot.status === 'in_progress' && !snapshot.responseCollectionComplete && Date.parse(now) >= Date.parse(snapshot.deadlineAt);
}

module.exports = { fail, validateCommand, commandDigest, derive, stateReceipt, isResponseExpired, REASONS };
