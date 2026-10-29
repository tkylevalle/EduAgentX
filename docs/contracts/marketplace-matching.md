# Marketplace matching — MATCH-POLICY-1.0.0

Issue #31 implements the approved policy in
[the Marketplace slice](../blueprint/issues/07-define-marketplace-slice.md).
It extends #30's service and authentication; it does not create a second
Marketplace, issue credentials or change request thresholds.

## Commands and reads

| Method | Gateway route | Body | Roles |
|---|---|---|---|
| POST | `/v1/marketplace/capability-requests/:id/matches` | `{ "idempotencyKey": "match-demo-1" }` | admin, demo_operator |
| GET | `/v1/marketplace/match-results/:resultId` | none | admin, demo_operator, viewer, evaluator, governance_operator |

Internal routes replace `/v1/marketplace` with `/internal` and require both
`x-internal-service-key` and the authenticated `x-actor-subject`.
Clients cannot submit candidates, scores, weights, policy overrides or gate
verdicts. Extra command fields are rejected. The existing eligibility-check
routes remain available and keep their unranked contract.

POST responds with `{ apiVersion, outcome, matchResult, correlationId }`:
201 `created` on the first command, 200 `replay` on a retry. GET returns 200
`found` with the same stored `matchResult`. Unknown result IDs return 404
`match_not_found`. A new command needs an open request. Closure or a different
open version during source calls returns 409 without creating a result.

The idempotency scope is the authenticated actor plus key for matching commands.
Reusing the key on a different request or policy returns 409
`idempotency_conflict`. Reusing it on the same request returns the original
snapshot even if the request has since changed version, closed, or a credential
has been revoked. A new key explicitly requests a new observation.

## Eligibility before ranking

The projection supplies candidate identities, not authoritative eligibility.
Each new command rechecks credential verification and current status, registered
configuration fingerprint, pinned package and lifecycle origin. Listing state is
read again in the persistence transaction. Unknown, unavailable, malformed or
timed-out evidence fails closed; there is no cached-success fallback.

Every trust gate must pass for either lane: lifecycle origin, discoverability,
signature/schema/issuer verification, active status, unexpired credential,
fingerprint, appropriate environment and the same supported domain. Matching
also requires consistent candidate identity and explicit `evidenceMode`
(`synthetic`, `replay`, `live`). A live marketplace requires live evidence;
synthetic and replay evidence cannot cross into it. Assessment mode is the
separate `standard`/`fallback` field. Unknown labels are not guessed.

All request requirements must pass for Eligible Matches. A candidate passing
trust but failing a known request requirement can appear only in `nearMatches`,
labelled `Not Eligible` and `eligible: false`. Trust failures go to `exclusions`
with reason codes and never receive a ranking score.

Only `ai-agent-safety-secure-tool-use` is supported. #30 rejects unsupported
request creation with 400 `domain_unsupported`; the matching evaluator also
returns `UNSUPPORTED_DOMAIN` and two empty lanes for an unsupported stored
request. Malformed supported requests produce `INVALID_REQUEST` and empty
lanes. Neither path fabricates capabilities or relaxes requirements.

## Approved score

| Component | Points |
|---|---|
| Total performance | `35 * overallPercent / 100` |
| Adversarial performance | `35 * adversarialPercent / 100` |
| Preferred objective coverage | `20 * coveredPreferred / requestedPreferred`; 20 if none requested |
| Credential recency | `10 * max(0, 1 - ageDays / maxCredentialAgeDays)` |

Objective coverage comes only from the authoritative pinned package; it means
that an objective was assessed, not that an objective-level score is known.
`preferredObjectiveIds` is optional, unique and bounded to 20 IDs. Uncovered
preferences contribute no coverage; they are not hard requirements.

Age uses elapsed milliseconds divided by 86,400,000, without truncating to whole
days. Future issuance dates are uncheckable. Each component and the unrounded
sum are exposed; only the final sum is rounded to two decimal places. Match
Score is a ranking value, not certification confidence or a deployment guarantee.
Provider, model vendor, framework, ratings and self-declared skills have no weight.

Eligible Matches sort by rounded score descending, issuance time descending,
then stable `agentLearnerKey` ascending using locale-independent code-unit
comparison. Return at most five and retain the total eligible learner count.

## Near Matches

Return at most three, separately from Eligible Matches. Order by:

1. `gapCount` ascending.
2. `normalizedShortfall` ascending, without rounding.
3. Ordinary rounded Match Score descending.
4. Issuance time descending.
5. Stable learner ID ascending.

Each missing required objective is one gap. Overall score, adversarial score,
credential age and assessment mode each add one gap if failed. The combined
shortfall is the arithmetic mean of these five applicable request dimensions:

| Dimension | Normalized shortfall |
|---|---|
| Objectives | missing required objectives / required objectives |
| Overall score | `max(0, required - actual) / required` |
| Adversarial score | `max(0, required - actual) / required` |
| Age | `min(1, max(0, ageDays - maximumDays) / maximumDays)` |
| Mode | 1 if unaccepted, otherwise 0 |

All five dimensions are mandatory in #30 requests, so the divisor is five;
satisfied requirements contribute zero. Required scores and maximum age are
positive, avoiding undefined divisions. `gaps`, `shortfallComponents` and
`shortfallDivisor` preserve the arithmetic and exact reason codes.

One representative credential is returned per learner: choose an eligible
credential before any near credential, then use that lane's approved ordering.
For exact ties within the same learner, credential ID ascending resolves the
choice. Other credentials receive `OTHER_CREDENTIAL_SELECTED`; duplicate
credential identities in the input fail closed. Deduplication precedes limits,
so a learner outside the top five eligible cannot reappear as a Near Match.
Totals count learners, not credentials.

Each item's `ordering` records all criteria and directions, the next learner
compared, the first decisive criterion and preceding tied criteria. The last
item has `only_or_last_candidate` when there is no next candidate. A visible
boundary item can explain its order against an item beyond the display limit.

## Stored evidence and privacy

`matchResult` contains result ID, request ID/version/digest, policy version,
generation time, authenticated actor, original correlation ID and idempotency
key, environment label, lane arrays/totals, exclusions/counts and a non-binding
point-in-time notice. Items expose credential and learner IDs, rank, score
components, gaps, checks, satisfied requirements, ordering and credential choice.
Evidence includes observed status, fingerprint, pinned package, assessment mode,
evidence mode, environment and evaluation time. The timestamp identifies this
evaluation of source responses; it is not a globally atomic snapshot of all
external services.

Output is constructed from allowlisted fields. It excludes raw examination
answers, private prompts, system instructions, grader rationale, compact JWSs,
signing material and raw source bodies. Source outcomes use fixed enum values.

`marketplace_service.match_results` stores the complete snapshot in one
transaction. The database enforces the request-version reference, metadata
consistency and uniqueness of `(actor, idempotency_key)`. The existing evidence
trigger rejects UPDATE and DELETE. A concurrent loser reads the original result;
an interrupted transaction publishes no partial row. Reads do not recompute
scores. Restarted services replay from PostgreSQL, not process memory.

GET deliberately returns historical evidence. Clients must label it as such and
use a new command key for fresh matching; a later action must reverify trust.
This API change does not implement a frontend current-status comparison.

## Integration boundary

The main branch at this change's base still has a lifecycle-origin adapter that
returns `source_not_available`; the real issuer fixture also lacks the origin
labels needed here. The mapper accepts explicit credential fields but does not
invent them or replace signature verification. Certification/verification owners
must complete their agreed authoritative lifecycle and credential contracts.
Until then affected real candidates are excluded from both lanes. Passing tests
with injected authorities demonstrate matching behavior, not a completed live
certification-to-marketplace deployment.
