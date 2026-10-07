# Issue 13 handoff: Practice, remediation, and progress

## What was delivered

- **Bounded practice.** A delivery item is now a `lesson` or a `practice` item (`kind`, default `lesson`; any other value makes the package undeliverable). Each item accepts one response of at most `TRAINING_MAX_RESPONSE_CHARS` characters (default 4000). A longer response gets 422 `response_too_long`, and an unknown body field gets 400 `unexpected:<field>`. Training stores only the SHA-256 digest and length of a response. It never grades. Every delivered item states `modelWeightsModified: false` in its `bounds`, and every accepted submit reply states it at the top level. Each practice event records `itemKind`, `moduleId` and `objectiveIds`.
- **Completion policy.** `TRAINING_MIN_PRACTICE_PER_MODULE` (default 1) sets how many practice items each module must hold and the learner must complete. A package with fewer gets 409 `insufficient_practice` at start. The policy is stored on each session (`completion_policy`), so a later config change does not move the goal of a running session. Sessions from Issue 12 get the legacy policy `training-completion/0`, which needs no practice.
- **Targeted remediation.** `POST /v1/admin/training-remediations` (admin only; Gateway → `POST /internal/remediations`) creates a session in the new `assigned` status. The session holds only the delivery items linked to the requested objectives. The learner starts it with the normal `training.session.start`. The request keeps its causing evidence (`cause.type`, `reference`, `evidenceDigest`, `observedAt`, optional `summary`), the operator subject as `requestedBy`, and a digest of the request. A replay of the same `requestId` returns the stored response. The same `requestId` with different content gets 409 `remediation_request_conflict`.
- **Objective-level progress.** Each session stores its delivery plan without the text (`delivery_plan`). Session reads include `objectiveProgress`, which gives planned and completed items and practice per objective, and `plannedItems`, `resumeCount` and `kind`.
- **One completion event.** When a session completes, the same transaction writes one `training.session.completed:<sessionId>` envelope to the immutable `completion_events` outbox. `session_id` is UNIQUE, and the partial unique index `one_terminal_event` lets each session have only one terminal event (completed or blocked). A completed session stays completed: a later package or configuration change does not block it, and a retry replays the stored reply. Issue 12 could block a completed session. If a database already holds such a session, the schema skips the index with a warning, so the service still starts. `GET /v1/admin/training-completion-events` reads the outbox.
- **Completion relay.** When `REDIS_URL` is set, a background relay (`relay.js`) publishes each outbox envelope to the Redis Stream `TRAINING_COMPLETION_STREAM` (default `training.session.completed`) with `XADD`. Each stream entry has the fields `eventId` and `envelope` (the JSON envelope). The relay records the stream id in the immutable `completion_publications` table, so it sends each event once in normal operation. If Training stops between the send and the record, the event is sent again: delivery is at least once, and a consumer must remove duplicates by `eventId`. While Redis is down, nothing is sent and the events wait in the outbox; Training still starts and serves requests. A PostgreSQL advisory lock lets only one Training instance relay at a time. The relay runs every second and sends at most 100 events per run, oldest first. A send that gets no reply in 5 seconds stops the run and is tried again on the next run. The relay logs `redis_connection_error` once when Redis goes down and `redis_connection_restored` when it comes back.
- **Session timeout.** An `open` session with no event for `TRAINING_SESSION_TIMEOUT_MINUTES` (default 1440, which is 24 hours; at most 5256000, which is 10 years; `0` turns it off) is ended with `session_blocked` and the reason `session_timed_out`. This happens on the learner's next request, which gets 409 `training_blocked`, or by a background sweep that runs every minute. The sweep takes the same per-learner lock as a request, so a session gets only one terminal event. If the sweep cannot end one session, it logs `session_expiry_failed` and continues with the others. The block event keeps the session's evidence mode, and its actor is `training-service`. After a timeout, the next start opens a new session. An `assigned` remediation does not time out, because it waits for its learner.
- **Monitoring signals.** `GET /v1/admin/training-metrics` returns the counts started, completed, remediated, resumed, aborted, open and assigned, plus `completionRate` (completed / started; `null` before any start), `byKind` and `abortReasons`. "Aborted" means that Training blocked the session (`session_blocked`), and this includes a timeout (`abortReasons.session_timed_out`). It also returns `trace`, which lists the session IDs behind each count, and `completionEvents {total, published, pending}` for the relay. A resume now appends a `session_resumed` event, so resumes can be counted.
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
| New tables | — | `completion_events` (immutable, one per session), `completion_publications` (immutable, one per published event) |
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
- abandoned sessions (inside the timeout, so they count as `open`)

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

- training-service: 70 tests pass. New files: `test/plan.test.js`, `test/practice-remediation.test.js`, `test/metrics.test.js`, `test/kpi.test.js`, `test/expiry.test.js`, `test/relay.test.js` and `test/example-package.test.js`, plus five new route tests in `test/app.test.js`. A regression test checks that a completed session stays completed after its package is quarantined.
- curriculum-engine: 12 tests pass. The 2 new ones check the lesson and practice item in each example module, and refuse an unknown item `kind`. curriculum-index: 7 tests pass.
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
  8. Run the expiry sweep: it ends the idle legacy session once with `session_timed_out` and does not touch the completed session.
  9. With a real Redis 7: the relay sends nothing while another connection holds the relay lock, then publishes the one completion once, and an UPDATE on `completion_publications` is refused.
- With Redis unreachable, the relay sends nothing, logs `redis_connection_error`, and the process stays up.
- `scripts/smoke.sh` step 15: an agent gets 403 on training metrics, and an admin gets 200 with `completionRate`.

## Known limits

- **Packages without practice are refused.** The curriculum-engine example (now `0.1.5-draft`) has one lesson and one practice item per module, and curriculum-engine refuses an item `kind` other than `lesson` or `practice`. A package from another source that has only lessons is still refused with `insufficient_practice`. An operator can set `TRAINING_MIN_PRACTICE_PER_MODULE=0` for a lessons-only demo.
- **Remediation needs a free learner.** It is refused with `session_in_progress` while the learner has an open or assigned session. Training does not replace a running session for the learner; an abandoned one ends at the timeout.
- **Remediation always uses the current Active package.** The request must name the Active package and version.
- **No consumer reads the stream yet.** Examination (#16) must read `training.session.completed` with a consumer group and remove duplicates by `eventId`. The stream has no length cap.
- **Metrics read every session.** `GET /internal/metrics` reads all sessions on each call. `trace` lists at most 200 IDs per counter, but the counts always cover every session. This is acceptable at Sprint 2 volume.
- **Lists are capped.** The session list returns the 100 newest sessions, and the completion outbox read returns the 100 newest events. The Console says when it shows fewer sessions than exist.
- **The sweep scans every session.** It finds idle sessions with one grouped query over all events each minute. This is acceptable at Sprint 2 volume.
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
