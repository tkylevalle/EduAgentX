# Certification Service contract

Issue #23 adds an internal Certification Service. It consumes only the Examination Engine's answer-free projection of its immutable event history. Agent Learners and administrators cannot post scores, assessment evidence, or credentials.

## Issuance

`POST /internal/decisions`

Required headers: `x-internal-service-key`, `x-actor-subject`, `x-actor-role: examination-engine`, and optional `x-correlation-id`.

```json
{
  "examinationId": "uuid",
  "idempotencyKey": "examination:uuid"
}
```

The service loads the attempt itself. It accepts only `status=complete`, a complete response set, `examination-result/1.0.0` with `valid=true` and `passed=true`, a passing assessment with no critical violations, complete score/template/rubric/package bindings (including content digests), and a package that is not quarantined. Unknown, unavailable, inconsistent, incomplete, failed, or unsafe evidence fails closed.

Decision and credential rows are committed in one PostgreSQL transaction. `examination_id` and `decision_id` have unique constraints, and database triggers reject update or delete. Repeating a request or processing the same completion event returns the saved decision and identical credential. A transaction interruption can be retried safely.

The credential is a project-scoped W3C VC 2.0 payload in compact JWS, signed with Ed25519 (`alg=EdDSA`). The private signing key is a checkout-local ignored file mounted read-only; it is never written to PostgreSQL or returned. This is project evidence, not external accreditation. Raw answers and hidden grader material are not included.

New service-issued credentials also sign `evidence.certificationDecisionId`. The
store allocates that ID inside its existing serialized issuance transaction,
before signing, and uses it for the decision/credential relationship. Replays
return the original bytes; existing credentials are never rewritten. An evidence
projection naming a different examination than the requested selector is refused.

## Marketplace origin read

`GET /internal/credential-origins/:credentialId` accepts one lowercase UUID and
no query parameters. Required headers are `x-internal-service-key` with the
existing `MARKETPLACE_INTERNAL_KEY`, `x-actor-subject: marketplace-service`, and
`x-actor-role: marketplace`. Certification must receive that key in its runtime
configuration. It must differ from `CERTIFICATION_INTERNAL_KEY`; absent or
identical keys refuse the origin read. The Marketplace key grants no access to
other issuer reads, credential enumeration, or issuance commands.

The read joins the immutable credential to its immutable decision by
`decision_id`, selecting the exact credential UUID. A 200 response contains only
`{ apiVersion: "v1", origin }`, where `origin` has these fields:

| Field | Meaning |
| --- | --- |
| `schemaVersion` | `certification-origin/1.0.0` |
| `outcome` | `certified`; only issued decision/credential pairs are returned |
| `credentialId` | Exact requested credential UUID |
| `decisionId` | Owning immutable Certification Decision UUID |
| `examinationId` | Owning passing Examination UUID |
| `subjectId` | Registered learner key bound by the decision |
| `configurationFingerprint` | Decision's learner configuration fingerprint |
| `credentialDigest` | `sha256:` plus lowercase hex SHA-256 of the exact UTF-8 compact JWS |

Unknown IDs return 404, malformed selectors return 400, unauthorized callers
return 403, and storage uncertainty returns 503. No credential dump, scores,
assessment items, answers, prompts, rationale, keys or tokens are returned.
Origin proves historical issuance only; signature, schema, status, fingerprint
freshness and all other Marketplace gates still run independently.

Trusted environment/evidence-mode propagation is **not implemented** by this
origin repair. See [the integration decision](marketplace-trust-integration.md)
for the unresolved source-authority and fallback contracts. Caller labels are
not upgraded into signed issuer claims.

## Examination Engine evidence source

`GET /internal/certification-evidence/:examinationId` returns a purpose-limited projection containing the subject fingerprint, package, mode, template, rubric, result, scores, safety outcome, and timestamps. It excludes responses and expected answers. `GET /internal/certification-candidates` returns completed passing attempt IDs after a durable cursor; the Certification Service polls this list and advances its cursor after issuance, replay, or permanent evidence rejection (without creating a decision). A quarantine refusal does not advance the cursor, so trust restoration can safely resume pending issuance.

## Timing evidence

`GET /internal/kpi/issuance` reports p95 from Examination completion to durable credential issuance, the five-second target, and eight-second acceptance maximum. It also reports service processing p95 separately. An empty sample is reported as unavailable (`targetMet: null`), never as a pass.

## Local signing key

`node scripts/setup-dev.js` creates a local-only Ed25519 key pair under ignored `keys/`. Docker mounts the private key read-only. Demonstration keys must not be reused as deployment keys.
