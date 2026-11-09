"use strict";

// Executes real HTTP/Compose paths. Only sanitized observations leave this process.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createHash, randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const hero = require("../packages/hero-scenarios");
const { createLifecycleDriver } = require("../packages/demo-lifecycle");
const {
  createLifecycleMessage,
} = require("../packages/external-agent-protocol");
const {
  GatewayProtocolClient,
} = require("../services/synthetic-agent-learner/gateway-client");
const {
  createSyntheticAgentLearner,
} = require("../services/synthetic-agent-learner/learner");
const {
  createExamRunner,
} = require("../services/synthetic-agent-learner/exam-runner");
const {
  examAnswer,
} = require("../services/synthetic-agent-learner/exam-scenarios");

const config = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const env = config.environment;
const now = () => new Date().toISOString();
const hash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
const transportRetries = [];
async function transport(url, options) {
  try {
    return await fetch(url, options);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    // Re-send the identical request, retaining the server's command/message idempotency key.
    transportRetries.push({
      at: now(),
      path: new URL(url).pathname,
      method: options.method,
    });
    await sleep(500);
    return fetch(url, options);
  }
}
const client = (name) =>
  new GatewayProtocolClient({
    gatewayUrl: config.urls.gatewayUrl,
    clientId: env[`${name}_CLIENT_ID`],
    clientSecret: env[`${name}_CLIENT_SECRET`],
    fetchImpl: transport,
  });
const trusted = client("SYNTHETIC_EXECUTOR");
const legacy = client("AGENT");
const extraExecutors = [client("LIVE_AGENT"), client("REPLAY_AGENT")];
let admin;
let pkg;
let baseline;
const profile = "synthetic:competent:safe-escalation";
const driver = createLifecycleDriver({
  ...config.urls,
  curriculumInternalKey: env.CURRICULUM_INTERNAL_KEY,
  admin: {
    clientId: env.ADMIN_CLIENT_ID,
    clientSecret: env.ADMIN_CLIENT_SECRET,
  },
  reviewers: [1, 2].map((i) => ({
    clientId: env[`REVIEWER_${i}_CLIENT_ID`],
    clientSecret: env[`REVIEWER_${i}_CLIENT_SECRET`],
  })),
  candidate: require("../services/curriculum-engine/examples/ai-safety-candidate"),
});

async function http(url, method = "GET", body, headers = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      ...headers,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(90000),
  });
  return { status: response.status, body: await response.json() };
}
const gateway = (route, method, body) =>
  http(`${config.urls.gatewayUrl}${route}`, method, body, admin);
function compose(...args) {
  const [binary, ...prefix] = config.compose;
  const result = spawnSync(binary, [...prefix, ...args], {
    encoding: "utf8",
    timeout: 150000,
  });
  if (result.status !== 0)
    throw new Error(`compose operation failed: ${args.slice(0, 2).join(" ")}`);
  return result.stdout;
}
function sanitize(value) {
  if (typeof value === "string") {
    if (/^[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}$/.test(value))
      return { sha256: hash(value), omitted: "signed bytes" };
    return value;
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !/token|secret|password|private|prompt|rationale|response$|answer$|^form$|^items$/i.test(
              key,
            ),
        )
        .map(([key, child]) => [key, sanitize(child)]),
    );
  return value;
}
async function execute(number, identity, action) {
  const declared = hero.SCENARIOS.find((s) => s.number === number);
  const scenario = structuredClone(declared);
  if (scenario.learner) scenario.learner.identity = identity;
  scenario.package = pkg
    ? { id: pkg.packageId, version: pkg.version, digest: pkg.digest }
    : scenario.package;
  scenario.keys.issuerKeyId = config.issuerKeyId;
  const startedAt = now();
  let result;
  try {
    const observed = await action();
    const record = hero.createEvidenceRecord({
      scenario,
      runId: config.project,
      executorMode: "synthetic",
      startedAt,
      finishedAt: now(),
      artifacts: sanitize(observed.artifacts),
      checks: [{ name: observed.check, passed: true }],
      incident: scenario.injectedFault
        ? {
            affectedIds: observed.affectedIds || { runId: config.project },
            recoveryOutcome: observed.recoveryOutcome || "observed recovery",
            detectedAt: observed.detectedAt || startedAt,
            recoveredAt: now(),
          }
        : null,
      outcome: "passed",
    });
    const validation = hero.verifyEvidenceSet(scenario, [record]);
    assert.equal(validation.valid, true, JSON.stringify(validation.errors));
    result = {
      number,
      id: scenario.id,
      status: "PASS",
      startedAt,
      finishedAt: now(),
      declarationAdjustments: {
        learnerIdentity: identity,
        package: scenario.package,
        keyId: scenario.keys.issuerKeyId,
      },
      incidentSource: scenario.injectedFault
        ? "runner observation of actual injected fault; see monitoring separately"
        : null,
      record,
    };
  } catch (error) {
    result = {
      number,
      id: scenario.id,
      status: "FAIL",
      startedAt,
      finishedAt: now(),
      error: String(error.message).slice(0, 1800),
    };
  }
  results.push(result);
  fs.writeFileSync(
    path.join(config.out, `${number}-${scenario.id}.json`),
    JSON.stringify(result, null, 2),
  );
  console.log(
    `${number} ${scenario.id}: ${result.status}${result.error ? " " + result.error : ""}`,
  );
}
function blocked(number, reason, observations = {}) {
  const scenario = hero.SCENARIOS.find((s) => s.number === number);
  const result = {
    number,
    id: scenario.id,
    status: "BLOCKED",
    reason,
    observations: sanitize(observations),
    checkedAt: now(),
  };
  results.push(result);
  fs.writeFileSync(
    path.join(config.out, `${number}-${scenario.id}.json`),
    JSON.stringify(result, null, 2),
  );
  console.log(`${number} ${scenario.id}: BLOCKED ${reason}`);
}
async function training(agent = trusted, registration) {
  const trained = await createSyntheticAgentLearner({
    gatewayClient: agent,
  }).train({
    agentLearnerKey: agent.clientId,
    ...(agent !== legacy ? { executionProfile: profile } : {}),
    ...(registration ? { registration } : {}),
  });
  assert.equal(trained.outcome, "completed", JSON.stringify(trained));
  return trained;
}
async function examination(agent, trained, scenario = "safe-escalation") {
  const exam = await createExamRunner({ gatewayClient: agent }).examine({
    trainingSessionId: trained.sessionId,
    ...(agent !== legacy ? { executionProfile: profile } : {}),
    answerFor: (item, index) => examAnswer(scenario, item, index),
    gradingWaitMs: 90000,
  });
  assert.ok(
    ["complete", "agent_failed"].includes(exam.outcome),
    JSON.stringify(exam),
  );
  return exam;
}
async function registration(agent) {
  const r = await http(
    `${config.urls.gatewayUrl}/v1/registrations?agentLearnerKey=${encodeURIComponent(agent.clientId)}`,
    "GET",
    undefined,
    {
      authorization: `Bearer ${await agent.getAccessToken(randomUUID(), 5000)}`,
    },
  );
  assert.equal(r.status, 200);
  return r.body.registration;
}
async function publish(agent) {
  const r = await agent.interact(
    createLifecycleMessage({
      messageId: randomUUID(),
      correlationId: randomUUID(),
      idempotencyKey: randomUUID(),
      timeoutMs: 5000,
      evidence: { mode: "synthetic" },
      payload: {
        interactionType: "marketplace.listing.publish",
        data: { agentLearnerKey: agent.clientId, response: "publish" },
      },
    }),
  );
  assert.ok([200, 201].includes(r.status));
}
function requestContent(overrides = {}) {
  return {
    domain: "ai-agent-safety-secure-tool-use",
    requiredObjectiveIds: pkg.objectives.map((o) => o.id),
    minOverallPercent: 80,
    minAdversarialPercent: 70,
    maxCredentialAgeDays: 365,
    allowedAssessmentModes: ["standard"],
    requiredEnvironment: "simulation",
    title: "Isolated hero demonstration",
    ...overrides,
  };
}
async function request(overrides = {}) {
  const content = requestContent(overrides);
  const r = await gateway("/v1/marketplace/capability-requests", "POST", {
    idempotencyKey: randomUUID(),
    request: content,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.request.id;
  assert.equal(
    (
      await gateway(`/v1/marketplace/capability-requests/${id}/open`, "POST", {
        version: 1,
      })
    ).status,
    200,
  );
  return { id, content };
}
async function match(id, predicate) {
  let result;
  for (let i = 0; i < 40; i++) {
    const r = await gateway(
      `/v1/marketplace/capability-requests/${id}/matches`,
      "POST",
      { idempotencyKey: randomUUID() },
    );
    assert.equal(r.status, 201);
    result = r.body.matchResult;
    if (!predicate || predicate(result)) return result;
    await sleep(500);
  }
  throw new Error(
    "Matching observation timed out: " + JSON.stringify(sanitize(result)),
  );
}
async function certify(exam) {
  const issued = await driver.certify(exam.attempt.attemptId);
  const verified = await driver.verify(issued.compactJws);
  assert.equal(verified.overall, "VALID", JSON.stringify(verified));
  return issued;
}

async function main() {
  const auth = await http(`${config.urls.gatewayUrl}/v1/auth/tokens`, "POST", {
    clientId: env.ADMIN_CLIENT_ID,
    clientSecret: env.ADMIN_CLIENT_SECRET,
  });
  assert.equal(auth.status, 200);
  admin = { authorization: `Bearer ${auth.body.accessToken}` };
  await driver.ensurePackage();
  pkg = await driver.activePackage();
  await execute(1, trusted.clientId, async () => {
    const trained = await training(),
      reg = await registration(trusted),
      exam = await examination(trusted, trained);
    assert.equal(exam.outcome, "complete");
    const issued = await certify(exam);
    await publish(trusted);
    const req = await request();
    const matched = await match(req.id, (r) =>
      r.eligibleMatches.some((c) => c.credentialId === issued.credentialId),
    );
    baseline = { trained, reg, exam, issued, req, matched };
    return {
      check:
        "Authoritative lifecycle yields verified credential and Eligible match",
      artifacts: {
        registration: reg,
        packagePin: {
          id: pkg.packageId,
          version: pkg.version,
          digest: pkg.digest,
        },
        trainingRecord: trained,
        examinationResult: exam,
        credential: {
          credentialId: issued.credentialId,
          signedBytesSha256: hash(issued.compactJws),
        },
        verificationReport: await driver.verify(issued.compactJws),
        matchResult: matched,
      },
    };
  });
  await execute(2, legacy.clientId, async () => {
    const trained = await training(legacy),
      failed = await examination(legacy, trained, "unsafe-tool");
    assert.equal(failed.outcome, "agent_failed");
    const detail = await gateway(
      `/v1/admin/examinations/${failed.attempt.attemptId}`,
    );
    assert.ok(
      detail.body.attempt.assessment.criticalViolationRuleIds.length > 0,
    );
    assert.equal(
      (
        await gateway(
          `/v1/admin/certifications/by-examination/${failed.attempt.attemptId}`,
        )
      ).status,
      404,
    );
    let trace;
    for (let n = 0; n < 30; n++) {
      trace = (
        await gateway(
          `/v1/admin/examinations/${failed.attempt.attemptId}/remediation`,
        )
      ).body.trace;
      if (trace?.remediation?.delivery?.outcome === "delivered") break;
      await sleep(1000);
    }
    assert.equal(trace.remediation.delivery.outcome, "delivered");
    const remedial = await training(legacy),
      retake = await examination(legacy, remedial);
    assert.equal(retake.outcome, "complete");
    const issued = await certify(retake);
    assert.equal(
      (await gateway(`/v1/admin/examinations/${failed.attempt.attemptId}`)).body
        .attempt.status,
      "agent_failed",
    );
    return {
      check:
        "Critical violation blocks issuance, remediation leads to a separate passing attempt",
      artifacts: {
        firstAttemptResult: failed,
        criticalViolation:
          detail.body.attempt.assessment.criticalViolationRuleIds,
        remediationEvent: trace.remediation,
        reExaminationResult: retake,
        credential: { credentialId: issued.credentialId },
      },
      affectedIds: { attemptId: failed.attempt.attemptId },
      recoveryOutcome: "New attempt passed after targeted Training",
    };
  });
  await execute(3, trusted.clientId, async () => {
    assert.ok(baseline, "Scenario 1 prerequisite");
    const stoppedAt = now();
    compose("stop", "certification-service");
    let exam;
    try {
      exam = await examination(trusted, baseline.trained);
      assert.equal(exam.outcome, "complete");
      assert.equal(
        (
          await gateway(
            `/v1/admin/certifications/by-examination/${exam.attempt.attemptId}`,
          )
        ).status,
        502,
      );
    } finally {
      compose("start", "certification-service");
    }
    const restartedAt = now();
    for (let n = 0; n < 60; n++) {
      if ((await gateway("/v1/admin/certifications")).status === 200) break;
      await sleep(500);
    }
    let issued;
    let lastObservation;
    while (Date.now() - Date.parse(restartedAt) < 110000) {
      try {
        const observation = await gateway(
          `/v1/admin/certifications/by-examination/${exam.attempt.attemptId}`,
        );
        lastObservation = observation.status;
        if (observation.status === 200) {
          issued = observation.body.credential;
          break;
        }
      } catch {
        lastObservation = "transport_unavailable";
      }
      await sleep(500);
    }
    assert.ok(issued, `Issuer did not recover: ${lastObservation}`);
    assert.equal((await driver.verify(issued.compactJws)).overall, "VALID");
    const elapsedMs = Date.now() - Date.parse(restartedAt);
    assert.ok(elapsedMs <= 120000);
    const rows = (await gateway("/v1/admin/certifications?limit=200")).body
      .credentials;
    assert.equal(
      rows.filter((c) => c.credentialId === issued.credentialId).length,
      1,
    );
    const code =
      "(async()=>{const c=require('redis').createClient({url:process.env.REDIS_URL||'redis://redis:6379'});await c.connect();const rows=await c.xRange('certification.credentials','-','+');console.log(JSON.stringify(rows.map(r=>{const e=JSON.parse(r.message.envelope);return {eventId:e.eventId,credentialId:e.credentialId}})));await c.quit()})().catch(()=>process.exit(1))";
    const events = JSON.parse(
      compose("exec", "-T", "certification-service", "node", "-e", code),
    );
    assert.equal(
      events.filter((e) => e.credentialId === issued.credentialId).length,
      1,
    );
    return {
      check:
        "Unavailable issuer recovers to one credential and one observed issuance event within 120 seconds",
      artifacts: {
        passingExamination: exam,
        interruptionRecord: {
          stoppedAt,
          placement:
            "Issuer stopped before examination, held unavailable across completed passing evidence",
        },
        recoveryTimeline: {
          restartedAt,
          elapsedMs,
          targetMet: elapsedMs <= 60000,
        },
        credentialCount: 1,
        credentialIssuedEvents: events.filter(
          (e) => e.credentialId === issued.credentialId,
        ),
      },
    };
  });
  await execute(4, trusted.clientId, async () => {
    assert.ok(baseline, "Scenario 1 prerequisite");
    const original = await driver.verify(baseline.issued.compactJws),
      parts = baseline.issued.compactJws.split(".");
    const payload = JSON.parse(Buffer.from(parts[1], "base64url"));
    payload.credentialSubject.competency.scores.overallPercent = 1;
    parts[1] = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const edited = await driver.verify(parts.join("."));
    assert.equal(original.overall, "VALID");
    assert.equal(edited.overall, "INVALID");
    assert.equal(edited.signature.status, "FAIL");
    const after = await driver.verify(baseline.issued.compactJws);
    assert.equal(after.overall, "VALID");
    return {
      check:
        "Edited signed claim fails signature verification and original remains valid",
      artifacts: {
        originalVerification: original,
        editedVerification: edited,
        signatureFailure: edited.signature,
        originalReverification: after,
      },
    };
  });
  blocked(
    5,
    "Authoritative live execution is disabled and replay.review.json has zero approvals. Paid calls and reviewer attestations require separate authorization.",
    {
      review: JSON.parse(
        fs.readFileSync(
          "packages/execution-provenance/replay.review.json",
          "utf8",
        ),
      ),
    },
  );
  await execute(7, trusted.clientId, async () => {
    assert.ok(baseline, "Scenario 1 prerequisite");
    const trained = await training(legacy),
      exam = await examination(legacy, trained),
      issued = await certify(exam);
    await publish(legacy);
    const candidateKeys = [trusted.clientId, ...extraExecutors.map(agent => agent.clientId)];
    for (const agent of extraExecutors) {
      const trained = await training(agent),
        exam = await examination(agent, trained);
      await certify(exam);
      await publish(agent);
    }
    const req = await request({
      minOverallPercent: 100,
      minAdversarialPercent: 100,
    });
    const result = await match(
      req.id,
      (r) =>
        r.exclusions.some((e) => e.credentialId === issued.credentialId) &&
        candidateKeys.every((key) =>
          r.nearMatches.some((c) => c.agentLearnerKey === key),
        ),
    );
    assert.equal(result.nearMatches.length, 3);
    assert.ok(
      result.nearMatches.every(
        (c) =>
          c.eligible === false &&
          c.gaps.length > 0 &&
          c.checks.filter((k) => k.tag === "trust").every((k) => k.passed),
      ),
    );
    assert.ok(
      ![...result.eligibleMatches, ...result.nearMatches].some(
        (c) => c.credentialId === issued.credentialId,
      ),
    );
    for (let n = 1; n < result.nearMatches.length; n++) {
      const a = result.nearMatches[n - 1],
        b = result.nearMatches[n];
      assert.ok(
        a.gapCount < b.gapCount ||
          (a.gapCount === b.gapCount &&
            a.normalizedShortfall <= b.normalizedShortfall),
      );
    }
    return {
      check:
        "Real authoritative Near Match carries exact gaps, with legacy credential excluded from both lanes",
      artifacts: {
        capabilityRequest: req,
        matchResult: result,
        nearMatchExplanations: result.nearMatches,
        trustExclusions: result.exclusions,
      },
    };
  });
  await execute(6, trusted.clientId, async () => {
    assert.ok(baseline, "Scenario 1 prerequisite");
    const {
      DEFAULT_REGISTRATION,
    } = require("../services/synthetic-agent-learner/learner");
    const {
      createRegistrationMessage,
    } = require("../packages/external-agent-protocol");
    const changed = {
      ...DEFAULT_REGISTRATION,
      model: { provider: "synthetic", version: "hero-configuration-2" },
    };
    const reply = await trusted.register(
      createRegistrationMessage({
        messageId: randomUUID(),
        correlationId: randomUUID(),
        idempotencyKey: randomUUID(),
        timeoutMs: 5000,
        evidence: { mode: "synthetic" },
        payload: { ...changed, agentLearnerKey: trusted.clientId },
      }),
    );
    assert.ok([200, 201].includes(reply.status));
    const reg = await registration(trusted);
    assert.notEqual(
      reg.configurationFingerprint,
      baseline.reg.configurationFingerprint,
    );
    assert.ok(reg.configurationVersion > baseline.reg.configurationVersion);
    const after = await match(baseline.req.id, (r) =>
      r.exclusions.some(
        (e) =>
          e.credentialId === baseline.issued.credentialId &&
          e.reasons.some((k) => k.code === "FINGERPRINT_MISMATCH"),
      ),
    );
    assert.ok(
      ![...after.eligibleMatches, ...after.nearMatches].some(
        (e) => e.credentialId === baseline.issued.credentialId,
      ),
    );
    const trained = await training(trusted, changed),
      exam = await examination(trusted, trained),
      issued = await certify(exam);
    const fresh = await match(baseline.req.id, (r) =>
      r.eligibleMatches.some((e) => e.credentialId === issued.credentialId),
    );
    const old = (
      await gateway(
        `/v1/admin/certifications/by-examination/${baseline.exam.attempt.attemptId}`,
      )
    ).body.credential;
    assert.equal(old.compactJws, baseline.issued.compactJws);
    return {
      check:
        "Changed fingerprint excludes old credential, fresh configuration requires and receives its own certification",
      artifacts: {
        beforeMatch: baseline.matched,
        fingerprintChange: reg,
        afterMatch: after,
        recertification: {
          credentialId: issued.credentialId,
          matchResult: fresh,
          oldSignedBytesUnchanged: true,
        },
      },
    };
  });
  await execute(8, null, async () => {
    const content = requestContent({ domain: "medical-diagnosis" });
    const refused = await gateway(
      "/v1/marketplace/capability-requests",
      "POST",
      { idempotencyKey: randomUUID(), request: content },
    );
    assert.equal(refused.status, 400);
    assert.ok(
      refused.body.error === "domain_unsupported" ||
        refused.body.details?.includes("domain_unsupported"),
    );
    return {
      check:
        "Unsupported domain is refused before request creation and matching",
      artifacts: {
        capabilityRequest: content,
        refusalOutcome: refused,
        emptyResultLists: {
          matchingInvoked: false,
          createdRequestId: refused.body.request?.id ?? null,
          observation:
            "Creation was refused. No match result or result arrays were returned.",
        },
      },
    };
  });
  blocked(
    9,
    "A real Capability Backup must execute another member's setup/scenario and record acting Primary/new Secondary. No second participant has performed this drill.",
  );
  const summary = {
    schemaVersion: "hero-stack-run/1.0.0",
    project: config.project,
    gitCommit: config.gitCommit,
    sourceSha256: config.sourceSha256,
    catalogPr: 85,
    catalogRevision: "99233b10c825ac37cb2f9b2927a3685589a104da",
    mainRevision: "a2db4a4",
    finishedAt: now(),
    transportRetries,
    results: results
      .sort((a, b) => a.number - b.number)
      .map(({ record, ...r }) => r),
    counts: {
      passed: results.filter((r) => r.status === "PASS").length,
      failed: results.filter((r) => r.status === "FAIL").length,
      blocked: results.filter((r) => r.status === "BLOCKED").length,
    },
    limitations: [
      "Catalog identity/key/package values were adapted explicitly to the actual isolated stack.",
      "Runner-authored fault observations do not prove automatic persistent Monitoring incident coverage.",
      "Examination/Curriculum reviewer identities here are test principals exercising software policy, not independent human review.",
    ],
  };
  assert.deepEqual(hero.findSecrets(summary), []);
  fs.writeFileSync(
    path.join(config.out, "summary.json"),
    JSON.stringify(summary, null, 2),
  );
  fs.writeFileSync(
    path.join(config.out, "monitoring-snapshot.json"),
    JSON.stringify(
      sanitize((await gateway("/v1/admin/monitoring/snapshot")).body),
      null,
      2,
    ),
  );
  console.log(JSON.stringify(summary.counts));
  process.exitCode = summary.counts.failed ? 1 : 0;
}
main().catch((error) => {
  console.error(String(error.message).slice(0, 1500));
  process.exitCode = 1;
});
