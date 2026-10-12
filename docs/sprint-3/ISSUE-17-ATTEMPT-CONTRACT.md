# Issue #17 — examination attempt lifecycle

Issue #17 extends the existing Examination Engine aggregate and Issue #16
start/read contracts. It does not implement Issue #18's grading algorithm,
Issue #20 fallback attempts, or Issue #21 remediation. PostgreSQL remains the
authoritative store; this lifecycle introduces no Redis dependency.

## Immutable configuration and responses

The existing attempt manifest and sequence-1 `attempt_started` event remain
valid. The learner fingerprint, package/template/rubric pins, assessment mode,
generated items and form digest, start time, and deadline cannot change after
admission. Lifecycle evidence is appended to that manifest rather than
rewriting it.

The first accepted response for an item is final. An identical response can
replay the accepted effect; a different response conflicts. There is no answer
revision operation. Invalid requests and invalid transitions are rejected
without turning a malformed HTTP request into learner failure.

Responses are restricted durable material. Learner/admin status projections,
Assurance Console JSON and HTML, ordinary logs, and lifecycle event payloads
must not expose answers, hidden grader material, or unrestricted grading
details.

## Public state and deadlines

| State | Meaning |
|---|---|
| `in_progress` | Collecting responses, or all responses received and awaiting a trusted valid result. |
| `complete` | A trusted valid passing assessment result was accepted. |
| `agent_failed` | A trusted valid failing assessment result was accepted, or the learner missed the response deadline. |
| `system_aborted` | A system/infrastructure/governance failure prevented a valid outcome. No accepted grade is produced. |

Terminal states are mutually exclusive and immutable. Receiving all 15
responses is an internal condition, not the public `complete` result.

`deadlineAt` bounds response acceptance. Every response must be accepted
strictly before the deadline. Once all 15 responses have been accepted on
time, the attempt stays `in_progress` awaiting trusted grading even after
`deadlineAt`. Grading delay alone is not learner timeout. The pinned deadline
is never extended by a retry or restart. The existing 60-minute local default
remains a technical default, not a release-duration approval.

Expiry is reconciled durably on reads and writes, at service startup, and by
a small runtime sweep every 30 seconds. Attempts with all 15 responses
accepted on time are excluded from learner-timeout reconciliation. Restart
resumes from PostgreSQL evidence; the interval does not own or reconstruct
attempt truth.

If governance revalidation fails after admission but before form delivery,
the admitted aggregate must retain a durable system-failure disposition rather
than leaving an undisclosed active attempt. Package/fingerprint checks on form
delivery continue to apply.

## Commands and atomicity

Learner response submission uses the authenticated learner identity through
the Gateway; identity cannot be supplied in the body. The Engine endpoint is
`POST /internal/attempts/:id/responses`, with:

```json
{
  "idempotencyKey": "caller-owned-key",
  "expectedSequence": 1,
  "itemId": "locked-item-id",
  "response": "learner response"
}
```

Lifecycle command receipts are durable. The same key and semantic payload
replay the original effect; the same key with changed meaning conflicts.
The response's `receipt` preserves the original acceptance state and sequence,
while `attempt` reports the current durable lifecycle state. A response retry
after finalization therefore retains its original receipt without presenting
the attempt as still active. Exact replay is checked before rejecting a
now-stale expected sequence.
Aggregate identity, stable event identity, expected sequence, current state,
and locked item references prevent duplicate, skipped, or out-of-order
effects.

Competing writers serialize inside a PostgreSQL transaction. Response/result
persistence, append-only lifecycle events, and accepted-command receipts commit
together or roll back together. No acknowledgement invents an uncommitted
effect. Retrying after restart uses the same durable evidence.

## Issue #18 integration

`POST /internal/attempts/:id/finalize` is a trusted Engine operation, not a
public learner or Console command. It requires the separate
`EXAMINATION_GRADING_KEY` in `x-internal-grading-key`, the internal service
credential, and examiner role. The command binds its idempotency key, expected
sequence, stable event ID, form digest, rubric digest, and response-set digest
to the complete persisted attempt. Its exact body is:

```json
{
  "idempotencyKey": "grader-owned-key",
  "expectedSequence": 16,
  "eventId": "stable-grading-event-id",
  "formDigest": "locked-form-digest",
  "rubricDigest": "locked-rubric-digest",
  "responseSetDigest": "persisted-response-set-digest",
  "result": {
    "schemaVersion": "examination-result/1.0.0",
    "valid": true,
    "passed": true
  }
}
```

Additional result fields are rejected. A valid passing result ends in
`complete`; a valid failing result ends in `agent_failed`. `grade_recorded`
and its terminal event are appended in one transaction. Missing or malformed
result evidence cannot become an accepted grade or pass. This interface accepts
a trusted decision; it does not calculate or validate grading accuracy.

The equally protected `GET /internal/attempts/:id/grading-input` returns the
locked form, its governing digests, the response-set digest, and restricted
persisted responses to Issue #18's grader. This route is unavailable to public
Gateway and Console clients. If the separate grading credential is not
configured, trusted grading routes are unavailable; start/read remains usable.

The trusted abort operation uses `POST /internal/attempts/:id/abort` with
`idempotencyKey`, `expectedSequence`, `eventId`, and `reason`. Reasons are
limited to `infrastructure_failure`, `governance_changed`, or
`grading_unavailable`. Finalization and abort compete for one terminal outcome.
A result cannot be accepted for an aborted attempt. Issue #18 owns rubric
execution and grading accuracy; Issue #17 tests use deterministic result
fixtures through this boundary.

## Read-only evidence

Learner and admin projections report the same durable state, aggregate
`sequence`, `responsesReceived`, and `responseCollectionComplete`, plus
`terminalReason` and the applicable `completedAt`, `failedAt`, or `abortedAt`.
Learner start/read routes deliver the allowlisted form only while the attempt
is `in_progress` and before its deadline. Expired or terminal attempts return
lifecycle summaries. Lifecycle command responses also return lifecycle
summaries without forms. A timely complete response set can still await
grading after expiry without reopening question delivery.
The Console preserves its governing-identifier/item-reference view and adds
these lifecycle fields. It neither changes attempts nor fetches learner forms
or response material. An unavailable or unrecognized upstream state is shown
as unavailable instead of inferred as `in_progress`.

## Verification

Focused domain/HTTP tests cover immutable configuration, response finality and
replay, changed-payload conflicts, sequence ordering, terminal exclusivity,
timeouts, trusted result admission, and projection redaction. Real PostgreSQL
tests exercise concurrent commands, durable replay/restart, rollback, and
terminal races. The Examination PostgreSQL suite must be run explicitly;
the repository unit runner does not discover its `integration/` directory.
