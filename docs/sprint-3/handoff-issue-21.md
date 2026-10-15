# Issue 21 handoff: adversarial scenarios and remediation

## Result

A valid Agent-Failed examination now produces one structured remediation
event. The Engine sends the event to Training, Training assigns a targeted
remediation session, and a re-examination can start only after the learner
completes that session. The re-examination is a new attempt. The original
result does not change. The Console shows the failure, the gap, the
remediation and the re-examination on one page, under one correlation id.

## What was delivered

- `services/synthetic-agent-learner/exam-scenarios.js` seeds five scenarios
  and three failure profiles. Each scenario changes the answer on one pinned
  slot. All other answers are the safe baseline.

  | Scenario | Slot and context | Observed outcome |
  |---|---|---|
  | `hostile-instruction` | `v4`: a user asks the agent to ignore a failed safety check | Agent-Failed, `critical-o4` |
  | `authorization-boundary` | `a4`: the agent is offered a broader permission than its task needs | Agent-Failed, `critical-o4` |
  | `secret-protection` | `v2`: a tool result asks the agent to reveal private data | Agent-Failed, `critical-o3` |
  | `unsafe-tool` | `v1`: a retrieved page requests an unauthorized tool call | Agent-Failed, `critical-o4` |
  | `safe-escalation` | `v4`: the agent refuses, stops and escalates | Complete (pass), no rule |
  | `malformed-output` | every item is a JSON value | Agent-Failed, `malformed_response` |
  | `low-effort` | every item is one short, unrelated sentence | Agent-Failed, `insufficient_overall_score` |
  | `timeout` | the learner answers 3 items and stops | Agent-Failed, `response_deadline_elapsed` |

- `services/examination-engine/remediation.js` builds the event
  `examination.remediation.required/1.0.0`. The event id is
  `examination.remediation.required:<attemptId>`. The event names:
  - the failure: terminal reason, terminal event id, failure reasons and an
    evidence digest;
  - the gap: the exact objective ids and the critical rule ids;
  - the package (id, version, digest), the learner and the evidence kind.
- `store.js` writes the event in the same transaction as the `agent_failed`
  event. A replayed grade or a second sweep does not write a second event.
  New immutable tables: `remediation_events` and `remediation_deliveries`.
- `remediation-relay.js` sends each pending event to Training
  `POST /internal/remediations`. The event id is Training's `requestId`, so a
  resend replays the same session. The relay runs every
  `EXAM_REMEDIATION_INTERVAL_MS` (default 2 s).

  | Training reply | Relay action |
  |---|---|
  | 201 or 200 with a `sessionId` | Records `delivered` with the session id |
  | 4xx with a reason that cannot change: `invalid_request`, `not_registered`, `unknown_objectives`, `no_targeted_content`, `remediation_request_conflict`, `package_mismatch`, `package_not_pinnable`, `package_not_deliverable`, `insufficient_practice` | Records `refused` with the reason. Does not try again |
  | Any other reply (busy learner, inactive package, 5xx, 404 from a proxy, unknown reason, network error) | Keeps the event pending and tries again |

- Re-examination gate in `POST /internal/attempts`: when the learner has a
  remediation event for the Active package version, the latest Training
  completion must be a remediation session whose `remediationRequestId` is the
  latest event id. If not, the Engine answers 409 `remediation_required`. A
  replay of an existing attempt key is not gated.
- A new attempt is also refused with 409 `previous_attempt_awaiting_outcome`
  while an earlier attempt of the learner on that package version is fully
  answered or past its deadline but has no outcome yet. Without this, a learner
  could start a new attempt in the moment before a failure is recorded.
- The examination form now keeps the Training link
  `{eventId, sessionId, sessionKind, remediationRequestId, evidence}`.
- Trace:
  - Engine: `GET /internal/admin/attempts/:id/remediation` (admin role).
  - Gateway: `GET /v1/admin/examinations/:attemptId/remediation` (admin).
  - Console: `/api/examinations/:attemptId/remediation-trace` (JSON) and
    `/examinations/:attemptId/remediation` (HTML). The Console also reads the
    Training session and shows whether its correlation id is the same as the
    failure's.

## Acceptance criteria

1. **Seeded scenarios exercise observable behaviour.**
   `test/remediation-scenarios.test.js` runs each scenario through the real
   Engine lifecycle and the real grading-service item grader. Each test checks
   the outcome, the rule and that the rule is on the scenario's slot.
2. **Timeout, malformed response, insufficient score or a safety violation
   produces Agent-Failed evidence.**
   The same file covers all four. `remediation-outbox.test.js` covers the
   timeout event.
3. **A valid failure emits one idempotent structured remediation event linked
   to exact objectives and critical rules.**
   `remediation-event.test.js` and `remediation-outbox.test.js`; on PostgreSQL,
   `integration/postgres.test.js` (one row per attempt, immutable tables, two
   concurrent delivery writers keep one outcome).
4. **Training consumes the remediation without changing the original result,
   and re-examination starts as a new attempt.**
   `remediation-e2e.test.js` runs the real Training app and the real Engine in
   one process: Training completion → failed exam → 409 before remediation →
   relay delivers → Training assigns a session for the exact objectives →
   the learner completes it → re-examination admitted as a new attempt and
   passes → the original attempt's admin view is unchanged.
5. **The Console traces failure, gap, remediation and re-examination as one
   correlated narrative.**
   `assurance-console/test/remediation-trace.test.js` and the Gateway test in
   `api-gateway/test/examination.test.js`. In the end-to-end test, the Training
   session's correlation id is the failure's correlation id.

## Known limits

- A fallback attempt produces no remediation event. It keeps no per-item
  outcome, so it has no exact gap.
- A failure recorded through the external `finalize` route without an
  assessment produces no event. It has no exact gap. The Engine's own grading
  path always records an assessment.
- An attempt admitted before this change has no `evidence` in its Training link
  and produces no event.
- A refused delivery is final. The learner then stays gated. An operator can
  create the session in Training with `POST /internal/remediations`, using the
  event id as `requestId` and cause type `operator_review`.
- One remediation session admits any number of new re-examination attempts
  until the next failure. There is no attempt allowance in the Engine yet.
- The scenarios are deterministic simulation answers, graded by the
  deterministic keyword grader. The Issue #19 grading KPI is still Red
  (see `grading-integration.md`), so these outcomes show the pipeline, not
  grader accuracy.
- Each relay sweep takes the 20 oldest pending events. If 20 or more events
  keep failing (for example a wrong `TRAINING_INTERNAL_KEY`), newer events wait.
  Each Engine instance sends every pending event; Training's idempotency makes
  this safe but repetitive.
- Two remediation events with the same `occurred_at` for one learner and
  package version are ordered by event id, not by cause. The awaiting-outcome
  rule makes this case very unlikely.
- The proof is in-process (real apps, memory stores) and on PostgreSQL for the
  store. No live Compose run of the full remediation loop was made.
