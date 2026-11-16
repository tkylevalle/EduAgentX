'use strict';
// Records written by main before this branch must still read. The fixture is
// main's own executor-provenance attempt, exported from a copy of its demo
// database: its run names a reference source whose code has changed since, so
// the source's digest is no longer in today's catalog.
const test = require('node:test');
const assert = require('node:assert/strict');
const { recordFromRows } = require('../store');
const { derive } = require('../lifecycle');
const execution = require('../../../packages/execution-provenance');
const rows = require('./fixtures/main-provenance-attempt.json');

test('an attempt recorded by main reads, though its reference source has changed since', () => {
  const record = recordFromRows(rows);
  assert.equal(execution.validRun(record.attempt.form.provenance), false, 'the source digest is not in the current catalog');
  const state = derive(record.attempt, record.events, record.responses);
  assert.equal(state.status, 'complete');
  assert.equal(state.result.passed, true);
});

test('the same history with a changed response or receipt is refused', () => {
  const tamperedResponse = structuredClone(rows);
  tamperedResponse.responses[0].response += ' edited';
  assert.throws(() => { const r = recordFromRows(tamperedResponse); derive(r.attempt, r.events, r.responses); });
  const tamperedReceipt = structuredClone(rows);
  const accepted = tamperedReceipt.events.find((event) => event.event_type === 'response_accepted');
  accepted.payload.executionEvidence.entryId = 'examination:r1:other';
  assert.throws(() => { const r = recordFromRows(tamperedReceipt); derive(r.attempt, r.events, r.responses); },
    (error) => error.code === 'provenance_conflict');
});
