# Internal curriculum freshness and fallback contract

These routes belong to `validation-activation` (port 4010). They are internal
service APIs and must not be exposed through the public API Gateway. Mutation
routes require `x-internal-service-key` and a non-empty `x-actor-subject`.

## Freshness checks

`GET /packages/:id/freshness?intervalDays=30` returns the latest recorded check
for every source in the package and whether it is due. The default interval is
30 days; valid explicit values are integers from 1 through 3650. A source with
no previous check is due.

`POST /packages/:id/freshness-checks` accepts an authenticated evidence record:

```json
{
  "sourceId": "nist-rmf",
  "evidence": {
    "observedAt": "2026-10-11T12:00:00.000Z",
    "evidenceUrl": "https://official-publisher.example/document",
    "snapshotReference": "capture-2026-10-11",
    "contentSha256": "<64 lowercase hexadecimal characters>",
    "changeKind": "unchanged | watch | editorial | material | critical",
    "summary": "What changed and why it matters",
    "edition": "optional publisher edition"
  },
  "scope": { "type": "delivery_item", "id": "m1-lesson-1" }
}
```

Evidence must identify the publisher URL and retained snapshot, include the
observed timestamp and SHA-256, and describe the change. An unchanged hash must
use `changeKind: "unchanged"` and is classified `No Change`. Changed hashes map `watch` to `Watch`, `editorial` to
`Patch`, `material` to `Substantive`, and `critical` to `Critical`. `Patch`,
`Substantive`, and `Critical` checks create a separate Candidate Package; the
checked package remains unchanged. A Critical check requires a scope that
resolves to one existing source, module, objective, or delivery item and records
quarantine before returning.

`POST /packages/:id/quarantines/restore` accepts:

```json
{
  "scope": { "type": "delivery_item", "id": "m1-lesson-1" },
  "reason": "Correction independently reviewed",
  "evidenceReference": "review-record-123",
  "restoredPackageId": "ai-safety-2026-10-11"
}
```

The replacement must be a different Active package. Scope restoration is
recorded as an append-only event. Training and index retrieval use the current
scope state; related certification must remain blocked while a relevant scope
is quarantined.

## Deterministic fallback

`POST /fallback/select` requires an Active package, a passing validation record
with the fallback-readiness gate, an exact valid 15-item bank and matching
manifest pin, and no quarantine intersecting the bank. Its request is:

```json
{
  "package_id": "ai-safety-2026-10-11",
  "reason": "standard_generation_unavailable"
}
```

The only accepted reasons are `standard_generation_unavailable` and
`standard_grading_unavailable`. The response contains the bank items without
expected answers and includes an `attemptId`. The bank is authored and
source-linked before an outage; outage handling cannot generate or complete
one.

`POST /fallback/score` requires the same package and attempt, plus one response
for every item exactly once:

```json
{
  "package_id": "ai-safety-2026-10-11",
  "attemptId": "<returned attempt id>",
  "responses": [{ "itemId": "fallback-01", "answer": "Govern, Map, Measure, Manage" }]
}
```

The response set is scored deterministically against the pinned bank. A selected
attempt can be scored once. The immutable 15-item policy is five recall, six
applied, and four adversarial items; weights are 20/40/40, the overall floor is
80, the adversarial floor is 70, and a critical safety violation fails the
attempt.

## Data and dependency notes

With `DATABASE_URL`, package lifecycle state and immutable package, freshness,
scope, and fallback evidence are persisted in PostgreSQL under
`curriculum_engine`. Without it, the service uses an in-memory store for tests
and local development; that mode is not durable. Full candidate validation and
activation remain subject to Issue #10's gate and review workflow, and
quarantine-aware indexing depends on Issue #11's index behavior.
