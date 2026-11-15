'use strict';
const { randomUUID } = require('node:crypto');
const execution = require('..');
const candidate = require('../../../services/curriculum-engine/examples/ai-safety-candidate');
const session = require('../../../services/training-service/session');
const { completionPolicy } = require('../../../services/training-service/plan');
const { sha256 } = require('../../../services/curriculum-engine/model');

function fixture(mode = 'synthetic', actor = 'provenance-agent') {
  const pkg = structuredClone(candidate);
  pkg.packageId = pkg.manifest.packageId; pkg.version = pkg.manifest.version; pkg.state = 'Active';
  pkg.digest = sha256(pkg); pkg.quarantinedScopes = []; pkg.certificationBlocked = false;
  const registration = { agentLearnerKey: actor, configurationFingerprint: execution.hash({ actor }), configurationVersion: 1 };
  const profile = mode === 'replay' ? 'replay:reference-safe' : 'synthetic:competent:safe-escalation';
  const replayReview = { schemaVersion: 'execution-replay-review/1.0.0', capturedBy: 'capturer', reviews: ['a', 'b'].map((reviewer) => (
    { reviewer, digest: execution.source('replay:reference-safe').digest, reviewedAt: '2026-11-04T00:00:00.000Z' })) };
  const enrollment = execution.enrollments([{ subject: actor, evidenceMode: mode, sources: [profile] }], { replayReview });
  const authority = execution.authority(enrollment, { subject: actor, role: 'agent' }, profile);
  const evidence = { mode, environment: 'simulation' };
  const trainingPackage = { id: pkg.packageId, version: pkg.version, digest: pkg.digest, state: 'Active', payload: pkg };
  let index = 0;
  const input = (extra = {}) => ({ sessionId: randomUUID(), agentLearnerKey: actor, actor,
    now: '2026-11-04T00:00:00.000Z', correlationId: 'provenance-test', policy: completionPolicy(),
    idempotencyKey: `request-${++index}`, requestFingerprint: `request-${index}`, trustedExecution: authority, evidence, ...extra });
  const started = session.decideStart(trainingPackage, registration, null, input());
  const run = started.session.provenance;
  const events = [...started.events];
  let completion;
  for (let n = 0; n < started.session.deliveryPlan.length; n++) {
    const delivery = session.decideContinue(trainingPackage, session.deriveSessionState(events), input({ session: started.session, registration }));
    events.push(...delivery.events);
    const item = delivery.response.item;
    const produced = execution.receipt(run, 'training', item, null, '2026-11-04T00:00:00.000Z');
    const result = session.decideSubmit(trainingPackage, session.deriveSessionState(events), input({ session: started.session,
      registration, deliveryItemId: item.deliveryItemId, submittedResponse: produced.response,
      responseDigest: execution.responseHash(produced.response), responseLength: produced.response.length,
      executionEvidence: produced.executionEvidence }));
    events.push(...result.events); completion = result.completion;
  }
  return { pkg, registration, authority, evidence, run, completion, events, trainingPackage, session: started.session, profile };
}
module.exports = { fixture };
