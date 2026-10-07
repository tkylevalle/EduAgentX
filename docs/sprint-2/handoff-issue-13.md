# Issue 13 handoff: Practice, remediation, and progress

## What was delivered

- **Bounded practice.** A delivery item is now a `lesson` or a `practice` item (`kind`, default `lesson`; any other value makes the package undeliverable). Each item accepts one response of at most `TRAINING_MAX_RESPONSE_CHARS` characters (default 4000). A longer response gets 422 `response_too_long`, and an unknown body field gets 400 `unexpected:<field>`. Training stores only the SHA-256 digest and length of a response. It never grades. Every delivered item states `modelWeightsModified: false` in its `bounds`, and every accepted submit reply states it at the top level. Each practice event records `itemKind`, `moduleId` and `objectiveIds`.
- **Completion policy.** `TRAINING_MIN_PRACTICE_PER_MODULE` (default 1) sets how many practice items each module must hold and the learner must complete. A package with fewer gets 409 `insufficient_practice` at start. The policy is stored on each session (`completion_policy`), so a later config change does not move the goal of a running session. Sessions from Issue 12 get the legacy policy `training-completion/0`, which needs no practice.
- **Targeted remediation.** `POST /v1/admin/training-remediations` (admin only; Gateway → `POST /internal/remediations`) creates a session in the new `assigned` status. The session holds only the delivery items linked to the requested objectives. The learner starts it with the normal `training.session.start`. The request keeps its causing evidence (`cause.type`, `reference`, `evidenceDigest`, `observedAt`, optional `summary`), the operator subject as `requestedBy`, and a digest of the request. A replay of the same `requestId` returns the stored response. The same `requestId` with different content gets 409 `remediation_request_conflict`.
- **Objective-level progress.** Each session stores its delivery plan without the text (`delivery_plan`). Session reads include `objectiveProgress`, which gives planned and completed items and practice per objective, and `plannedItems`, `resumeCount` and `kind`.
- **One completion event.** When a session completes, the same transaction writes one `training.session.completed:<sessionId>` envelope to the immutable `completion_events` outbox. `session_id` is UNIQUE, and the partial unique index `one_terminal_event` lets each session have only one terminal event (completed or blocked). A completed session stays completed: a later package or configuration change does not block it, and a retry replays the stored reply. Issue 12 could block a completed session. If a database already holds such a session, the schema skips the index with a warning, so the service still starts. `GET /v1/admin/training-completion-events` reads the outbox.
- **Monitoring signals.** `GET /v1/admin/training-metrics` returns the counts started, completed, remediated, resumed, aborted, open and assigned, plus `completionRate` (completed / started; `null` before any start), `byKind` and `abortReasons`. "Aborted" means that Training blocked the session (`session_blocked`). A session that the learner leaves stays `open`; there is no timeout. It also returns `trace`, which lists the session IDs behind each count. A resume now appends a `session_resumed` event, so resumes can be counted.
- **Assurance Console.** The Training section shows a metrics block (Started, Completed, Remediated, Resumed, Aborted, Completion rate). It shows a Kind column that names the remediation cause and objectives, and an Objective progress column (completed / planned items per objective; "not tracked" for Issue 12 sessions). It also shows assigned remediation as current work. `/api/training-metrics` serves the same data. A metrics outage is shown as "Training metrics unavailable" and does not hide the session list.
- **KPI.** `services/training-service/kpi/` holds the controlled dataset and its runner. The result is in `evidence/sprint-2/training-completion-kpi.json`.

### Remediation request

```json
{
  "requestId": "req-1",
  "agentLearnerKey": "synthetic-agent-learner-dev",
  "packageId": "demo-ai-safety", "packageVersion": "1.0.0",
  "objectiveIds": ["o2"],
  "cause": {
    "type": "examination_failure",
    "reference": "attempt-7",
    "evidenceDigest": "sha256:<64 hex>",
    "observedAt": "2026-10-07T09:00:00Z",
    "summary": "optional, at most 500 characters"
  },
  "evidence": { "mode": "synthetic", "environment": "simulation" }
}
```

`cause.type` is `examination_failure`, `skill_gap` or `operator_review`. `objectiveIds` holds 1–20 unique IDs. The package must be the current Active package. The Gateway refuses any other field with 400 `invalid_request` and `unexpected:<field>`, before it calls Training. Training also refuses any other field and checks the request in this order: `session_in_progress`, `not_registered`, `package_not_active`, `package_mismatch`, `package_not_pinnable`, `package_not_deliverable`, `unknown_objectives` (422), `no_targeted_content` (422), `insufficient_practice`.

### Completion event (outbox envelope)

`eventId`, `eventType` (`training.session.completed`), `schemaVersion` (`1.0.0`), `occurredAt`, `correlationId`, `agentLearnerKey`, `configurationFingerprint`, `configurationVersion`, `sessionId`, `sessionKind`, `remediationRequestId`, `package {id, version, digest}`, `completionPolicy`, `completion {plannedItems, completedItems, practiceCompleted, modules, objectiveIds}`, `evidence {mode, environment}`.

### Session model changes (for #14 and #16)

| Item | Issue 12 | Issue 13 |
|---|---|---|
| Event types | 5 | adds `session_resumed`, `remediation_assigned` |
| Derived status | `open`, `completed`, `blocked` | adds `assigned` (remediation not started yet) |
| Session columns | — | `kind`, `remediation`, `completion_policy`, `delivery_plan` |
| Event columns | — | `item_kind` |
| New table | — | `completion_events` (immutable, one per session) |
| Internal routes | 5 | adds `POST /internal/remediations`, `GET /internal/metrics`, `GET /internal/completion-events` |

`schema.sql` is still idempotent and runs at every start. It adds the new columns with defaults that keep Issue 12 rows valid, and it replaces the two CHECK constraints.

## Expected training completion KPI

| Item | Value |
|---|---|
| Dataset | `services/training-service/kpi/completion-dataset.v1.json`, version 1.0.0, 36 scenarios (25 expected to complete) |
| Formula | scenarios with the exact expected outcome / all scenarios. The status uses the lower of this ratio and the same ratio over the scenarios expected to complete (`completionOfCompletable`), so correct refusals cannot hide a session that should have completed. |
| Environment | training-service `createApp` over HTTP, in-memory store, fake package and registry sources |
| Result | **1.0 (36/36), Green**; completion of completable scenarios 1.0 (25/25). Acceptance Floor 0.90, Initial Target 0.95 |
| Invariants | false completions 0, duplicate completion events 0, replays that appended 0, writes during an outage 0, replies that did not state `modelWeightsModified: false` 0 (360 replies checked) |
| Session signals over the dataset | started 33, completed 25, remediated 5, resumed 7, aborted 5, open 3, assigned 1; completion rate 0.7576 |

The scenarios are in these categories:
- clean runs
- retries with the same key
- simulated restarts over the same store
- package and registry outages
- append collisions
- Quarantined, Candidate, Superseded, digest and configuration changes
- bounded-practice refusals
- remediation
- abandoned sessions

A scenario has the exact expected outcome only if all of these are true:
- Its final status and block reason match the expected outcome.
- It has exactly one completion event if it completed, and none if it did not.
- Every step returned the status the dataset requires.

`test/kpi.test.js` does these checks:
- It asserts the Floor and that the run reports the Target.
- It proves the runner finds a wrong expectation and reports a false completion as Red.
- It proves that 19 correct refusals cannot hide one session that should have completed: the run is Red.
- It fails if the committed evidence report differs from a fresh measurement.

The first run found that the dataset was wrong: it expected a Superseded package to block a running session. Issue 12 lets that session finish, so the scenario was corrected. A Candidate scenario that must block was added.

The completion rate (0.76) is a different number from the KPI. Blocked and abandoned sessions lower the completion rate on purpose. The KPI measures whether each session ends the way it should.

Re-run and update the evidence:

```bash
node services/training-service/kpi/measure.js --write
```

Any change to the dataset gives it a new digest and a new baseline. Under KPI Change Control, keep the earlier results visible.

## Verification

- training-service: 62 tests pass. New files: `test/plan.test.js`, `test/practice-remediation.test.js`, `test/metrics.test.js` and `test/kpi.test.js`, plus five new route tests in `test/app.test.js`. A regression test checks that a completed session stays completed after its package is quarantined.
- api-gateway: 21 tests pass. The 3 new ones cover these points:
  - Remediation is admin only.
  - An unknown field is refused before Training is called, and the admin is the actor.
  - Metrics and the outbox are admin-only reads.
  - Without the internal key, the routes give 503.
- assurance-console: 5 tests pass. The 2 new ones cover the metrics block, the remediation row, the objective progress column, and a metrics outage.
- PostgreSQL 16, as a one-off check with a scratch script that is not in the repository:
  1. Apply the Issue 12 schema and insert a legacy session.
  2. Apply the Issue 13 schema twice. The legacy row gets `kind=standard` and the legacy policy.
  3. Through the real pg store, assign a remediation, replay it, start and resume the session, and complete it.
  4. Read the outbox and the metrics.
  5. Quarantine the package after completion. The session stays completed.
  6. Apply the Issue 13 schema to an Issue 12 database that has a session with both a completion and a block. The schema applies twice, skips `one_terminal_event`, and raises the warning.
  7. Confirm that the database refuses a second terminal event (`one_terminal_event`), an UPDATE on `completion_events` (immutable trigger), and an unknown event type (`session_events_event_type_check`).
- `scripts/smoke.sh` step 15: an agent gets 403 on training metrics, and an admin gets 200 with `completionRate`.

## Known limits

- **Real packages have no practice items.** The curriculum-engine example and anything validation-activation can hold today have only lessons. With the default policy they are refused with `insufficient_practice`. Content (#9/#14) must add `kind: "practice"` items, or an operator can set `TRAINING_MIN_PRACTICE_PER_MODULE=0` for a lessons-only demo. The dev stub (`dev/stub-package-service.js`) now has one practice item per module.
- **Remediation needs a free learner.** It is refused with `session_in_progress` while the learner has an open or assigned session. Training does not end or replace a running session for the learner.
- **Remediation always uses the current Active package.** The request must name the Active package and version.
- **No relay reads the outbox.** Nothing publishes `completion_events` to Redis yet. Examination (#16) can read `GET /internal/completion-events` or add a relay.
- **Metrics read every session.** `GET /internal/metrics` reads all sessions on each call. `trace` lists at most 200 IDs per counter, but the counts always cover every session. This is acceptable at Sprint 2 volume.
- **Lists are capped.** The session list returns the 100 newest sessions, and the completion outbox read returns the 100 newest events. The Console says when it shows fewer sessions than exist.
- **Abandoned sessions stay open.** Nothing ends a session that the learner leaves. It counts as `open`, not as aborted.
- **The KPI runs in memory.** It uses the in-memory store. The PostgreSQL path is covered by the store tests and the one-off PostgreSQL check above, not by the KPI runner.
- **The Console was checked by its HTML only.** It was not rendered and checked visually.

## Acceptance criteria review

**1. Practice interactions are bounded, tied to module/objective identifiers, and never modify Agent Learner model weights. — Met.**
Proof:
- `plan.js`: `ITEM_KINDS`, `completionPolicy` and `deliveryPlan`.
- `session.js` `decideSubmit`: one response per item, `response_too_long`, `modelWeightsModified: false`.
- `index.js`: `BODY_FIELDS`.
- Tests: `test/plan.test.js` and `test/practice-remediation.test.js`; `test/app.test.js` ("submit enforces the response cap and refuses unexpected body fields").
- KPI invariant `weightsNotConfirmedUnchanged = 0` over 360 replies.

**2. A structured remediation request assigns targeted content while preserving the evidence that caused the request. — Met.**
Proof:
- `remediation-request.js`, `decideRemediation` and `targetPlan`/`sessionPlan`.
- The `remediation` column and the `remediation_request_once` unique index.
- Tests: `test/app.test.js` ("a remediation request assigns targeted content that the learner then starts and completes", "remediation requests are validated and refused while another session is in progress"); the Gateway test "an admin remediation request reaches Training unchanged with the admin as actor, and unknown fields are refused".

**3. Completion requires the configured module/practice conditions and emits one idempotent event. — Met.**
Proof:
- `completionStatus` and `practiceShortfall` in `plan.js`.
- `completionEnvelope` and `tx.insertCompletion` in the same transaction as `session_completed`.
- The `completion_events` primary key and UNIQUE `session_id`, and `one_terminal_event`.
- Tests: `test/app.test.js` ("completion emits exactly one completion event, readable from the outbox"); the PostgreSQL check.
- KPI invariant `duplicateCompletionEvents = 0`.

**4. Started, completed, remediated, resumed, and aborted counts plus completion rate are traceable in read-only views. — Met.**
Proof:
- `metrics.js`: counts plus `trace` session IDs.
- The Gateway's `GET /v1/admin/training-metrics` (admin only, GET only).
- The Console metrics block.
- Tests: `test/metrics.test.js`; `test/app.test.js` ("metrics count started, completed, remediated, resumed and aborted sessions"); `assurance-console/test/training-sessions.test.js`.

**5. The controlled dataset measures at least 90% expected completion and reports the 95% Target. — Met.**
Proof: `evidence/sprint-2/training-completion-kpi.json` (1.0, Green, Floor 0.90, Target 0.95) and `test/kpi.test.js`.
Gap: the measurement runs against the in-memory store and the fake sources, not the Docker stack.
