# Marketplace Service contract

Issue #30 adds `marketplace-service` (port 4012, internal only). It holds structured, simulated Capability Requests in the reference domain and decides which Agent Learners are **eligible** for them. It does not score, rank, explain or produce Near Matches (#31), and it does not produce Skill Gap recommendations (#32).

The API Gateway is the only entry point. marketplace-service has no host port. Its internal routes need `x-internal-service-key` (`MARKETPLACE_INTERNAL_KEY`) and `x-actor-subject`, which the Gateway sets from the token subject.

**Fail closed.** If a gate cannot be checked because a service is down, slow, answers in an unexpected shape, or a field is missing, `null` or `"unknown"`, the candidate is excluded with an `*_UNCHECKABLE` reason. Unknown or unavailable never counts as valid.

## Gateway routes

| Method | Path | Roles | Body | Success |
|---|---|---|---|---|
| POST | `/v1/marketplace/capability-requests` | admin, demo_operator | `{ idempotencyKey, request }` | 201 `created`, 200 `replay` |
| POST | `/v1/marketplace/capability-requests/:id/versions` | admin, demo_operator | `{ idempotencyKey, request }` | 201 `created`, 200 `replay` |
| POST | `/v1/marketplace/capability-requests/:id/open` | admin, demo_operator | `{ version }` | 200 `opened` or `unchanged` |
| POST | `/v1/marketplace/capability-requests/:id/close` | admin, demo_operator | `{}` | 200 `closed` or `unchanged` |
| POST | `/v1/marketplace/capability-requests/:id/eligibility-checks` | admin, demo_operator | `{ idempotencyKey }` | 201 `created`, 200 `replay` |
| GET | `/v1/marketplace/capability-requests` | admin, demo_operator, viewer, evaluator, governance_operator | — | 200, newest 100 |
| GET | `/v1/marketplace/capability-requests/:id` | same readers | — | 200 `found` |
| GET | `/v1/marketplace/eligibility-checks/:checkId` | same readers | — | 200 `found` |
| GET | `/v1/marketplace/listings/:agentLearnerKey` | same readers | — | 200 `found` |

`agent` and `reviewer` tokens get 403 on every route above. An Agent Learner changes only its own listing, through the protocol (next section).

The Gateway refuses unknown top-level body fields with `400 invalid_request` and `details: ["unexpected:<field>"]` before forwarding anything. If `MARKETPLACE_SERVICE_URL` or `MARKETPLACE_INTERNAL_KEY` is missing, every route returns `503 marketplace_unavailable`. If marketplace-service cannot be reached the Gateway returns `502 upstream_unavailable` (or `504 upstream_timeout`).

## Listing interactions (decision A: discoverability lives in Marketplace)

`POST /v1/agent-learner/interactions` with an agent token and the standard lifecycle envelope:

| `payload.interactionType` | Effect |
|---|---|
| `marketplace.listing.publish` | Appends a `published` listing event for the token subject |
| `marketplace.listing.withdraw` | Appends a `withdrawn` listing event for the token subject |

`payload.data` may contain only `agentLearnerKey`, which must equal the token subject (otherwise `403 identity_mismatch`), and the protocol's required `response` acknowledgement, which is not forwarded. Any other field gets `400 invalid_lifecycle_payload`. The listed learner is always the token subject; the envelope `idempotencyKey` is the listing idempotency key. The response is the protocol-decorated body:

```json
{ "outcome": "published", "listing": { "agentLearnerKey": "…", "discoverable": true,
  "events": [{ "eventType": "published", "actor": "…", "at": "…" }] }, "evidence": { "label": "SIMULATION: …" } }
```

Status codes: 201 for a new event and 200 `replay` for the same key. Reusing a key for the other action gives `409 idempotency_conflict`. **Discoverable** means the learner's latest listing event is `published`; a learner who never published is not discoverable.

## Capability Request fields

The `request` object accepts exactly these fields. Anything else is `unexpected:<field>`.

| Field | Rule | Error |
|---|---|---|
| `domain` | Must equal `ai-agent-safety-secure-tool-use` | `domain_unsupported` |
| `requiredObjectiveIds` | 1–20 unique non-empty strings (≤128 chars, no surrounding spaces) | `invalid:requiredObjectiveIds` |
| `minOverallPercent` | Number 80–100 | `invalid:minOverallPercent` |
| `minAdversarialPercent` | Number 70–100 | `invalid:minAdversarialPercent` |
| `maxCredentialAgeDays` | Integer 1–365 | `invalid:maxCredentialAgeDays` |
| `allowedAssessmentModes` | Non-empty unique subset of `standard`, `fallback` | `invalid:allowedAssessmentModes` |
| `requiredEnvironment` | `simulation` or `live` | `invalid:requiredEnvironment` |
| `title` | 1–200 characters, not only spaces | `invalid:title` |

The score floors match the examination pass policy (80 overall, 70 adversarial), so a request can only be stricter. A missing field is reported the same way as an invalid one.

Each version stores the canonical content and a `digest`: `sha256:` over JSON with sorted keys. The two list fields are treated as sets and sorted first, so field order and list order never create a different digest. A version is never changed. A change is a new version (next number), and closing is final.

**State** is derived from append-only events, never stored: `closed` if any close event exists; otherwise `open` on the latest `opened` version; otherwise `draft`. The response also carries `marketplace`: `simulation` or `live`, from the open (or latest) version's `requiredEnvironment`.

Request response:

```json
{ "apiVersion": "v1", "outcome": "created",
  "request": { "id": "uuid", "createdBy": "…", "createdAt": "…",
    "state": { "status": "open", "openVersion": 2 }, "marketplace": "simulation",
    "versions": [{ "version": 1, "content": { … }, "digest": "sha256:…", "createdBy": "…", "createdAt": "…" }],
    "events": [{ "eventType": "opened", "version": 2, "actor": "…", "at": "…" }] },
  "correlationId": "…" }
```

`GET /v1/marketplace/capability-requests` returns `{ "requests": [ <request>, … ] }`, newest first, at most 100.

## Eligibility check

A check evaluates every credential in the projection against the request's **open** version:

1. It reads the request, its open version and the projected credentials, without a lock.
2. It asks every authoritative source with no lock or transaction held. Each call has a time limit (default 2 s). Each answer that fails becomes `null` for that candidate only, so one failing source never fails the whole check.
3. It opens one short transaction under the request lock. It confirms the request is still open on the same version (otherwise `409 request_not_open` or `409 request_version_changed`, and nothing is stored), reads listings fresh, evaluates the gates, and stores the check and every result.

Results are immutable point-in-time evidence. `GET /v1/marketplace/eligibility-checks/:checkId` returns the stored results as they were; it does not recheck.

```json
{ "apiVersion": "v1", "outcome": "created",
  "check": { "checkId": "uuid", "requestId": "uuid", "version": 2, "requestDigest": "sha256:…",
    "actor": "…", "at": "…", "marketplace": "simulation",
    "summary": { "candidates": 1, "eligible": 0, "excluded": 1, "marketplace": "simulation",
      "ordering": "agentLearnerKey, not a ranking" } },
  "eligible": [],
  "excluded": [{ "agentLearnerKey": "…", "credentialId": "…",
    "reasons": [{ "code": "STATUS_UNCHECKABLE", "gate": "status", "tag": "trust" }],
    "sources": { "verification": "source_unavailable", "registry": "answered", "package": "answered",
      "lifecycleOrigin": "source_not_available", "listing": "marketplace" } }],
  "correlationId": "…" }
```

- A result is eligible exactly when `reasons` is empty; the database enforces this.
- Both lists are ordered by `agentLearnerKey`, then `credentialId`. This is a stable order for evidence, **not a ranking**.
- `sources` records what each owner answered: `answered`, `timeout`, `source_unavailable`, `contract_violation` or `source_not_available`. The listing comes from Marketplace's own table.
- An idempotency key belongs to the actor. Reusing it on another request gives `409 idempotency_conflict`.

### Reason codes

Every gate runs, and every failure is reported, in this fixed order. `tag` tells #31 how a reason may be used: a `trust` reason means the candidate must appear in **neither** result lane; only `request` reasons can describe a Near Match.

| # | Gate | Fails with | Tag | Inputs |
|---|---|---|---|---|
| 1 | `lifecycle_origin` | `NOT_LIFECYCLE_ORIGIN` | trust | lifecycle source (`true`/`false`) |
| 2 | `discoverable` | `NOT_DISCOVERABLE` | trust | latest listing event |
| 3 | `signature` | `SIGNATURE_INVALID` | trust | verification `signature` |
| 4 | `schema` | `SCHEMA_INVALID` | trust | verification `schema` |
| 5 | `status` | `STATUS_SUSPENDED`, `STATUS_REVOKED`, `STATUS_SUPERSEDED`, `STATUS_INDETERMINATE` | trust | verification `status` |
| 6 | `expiry` | `EXPIRED` (at or after `validUntil`) | trust | credential `validUntil`, check time |
| 7 | `fingerprint` | `FINGERPRINT_MISMATCH` | trust | credential fingerprint vs. the Registry's current one |
| 8 | `environment` | `ENVIRONMENT_MISMATCH` | trust | credential environment vs. `requiredEnvironment` |
| 9 | `domain` | `DOMAIN_MISMATCH` | trust | package domain vs. request domain and the supported domain |
| 10 | `objectives` | `OBJECTIVE_MISSING` (+ `missingObjectiveIds`) | request | package objective ids vs. `requiredObjectiveIds` |
| 11 | `score_overall` | `SCORE_OVERALL_BELOW` | request | credential overall % vs. `minOverallPercent` |
| 12 | `score_adversarial` | `SCORE_ADVERSARIAL_BELOW` | request | credential adversarial % vs. `minAdversarialPercent` |
| 13 | `age` | `CREDENTIAL_TOO_OLD` | request | `validFrom` age vs. `maxCredentialAgeDays` (exactly the maximum passes) |
| 14 | `mode` | `MODE_NOT_ALLOWED` | request | credential assessment mode vs. `allowedAssessmentModes` |

When a gate's input is missing, `null`, `"unknown"`, of the wrong type or not recognised, the gate returns `<GATE>_UNCHECKABLE` with tag **trust**, whatever the gate's own tag. The codes are `LIFECYCLE_ORIGIN_UNCHECKABLE`, `DISCOVERABLE_UNCHECKABLE`, `SIGNATURE_UNCHECKABLE`, `SCHEMA_UNCHECKABLE`, `STATUS_UNCHECKABLE`, `EXPIRY_UNCHECKABLE`, `FINGERPRINT_UNCHECKABLE`, `ENVIRONMENT_UNCHECKABLE`, `DOMAIN_UNCHECKABLE`, `OBJECTIVES_UNCHECKABLE`, `SCORE_OVERALL_UNCHECKABLE`, `SCORE_ADVERSARIAL_UNCHECKABLE`, `AGE_UNCHECKABLE` and `MODE_UNCHECKABLE`. A `validFrom` in the future is `AGE_UNCHECKABLE`.

The package answer counts only when its digest equals the digest pinned in the credential. Otherwise the domain and objectives gates both report `PACKAGE_UNCHECKABLE` (tag trust).

### Where each input comes from

| Input | Source | Maps to null / uncheckable when |
|---|---|---|
| Credential fields | Event-fed projection (below) | the field is missing or of the wrong type |
| Current fingerprint | Agent Registry `GET /v1/registrations?agentLearnerKey=` | another learner, status not `active`, not `sha256:…`, 404, error, timeout |
| Domain, objective ids, digest | validation-activation `GET /packages/:id?version=` (with `CURRICULUM_INTERNAL_KEY`) | id/version differ, package quarantined or `certificationBlocked` not `false`, domain text other than `AI Agent Safety and Secure Tool Use`, duplicate or missing objective ids, error, timeout |
| Signature, schema | credential-verification `POST /verify` with `{ jws }` only, never a `credentialId` | any check other than an explicit `PASS`; `INVALID` overall while the parts pass makes the schema invalid |
| Status | credential-verification `GET /status/:credentialId` (read-only) | anything other than `active`, `suspended` or `revoked` for this exact id (404, error, timeout) is `indeterminate` |
| Lifecycle origin | none yet | always `source_not_available` |
| Environment | not in credentials yet (decision C) | always `null` |

## Credential event feed (proposed contract, nothing emits it yet)

marketplace-service reads the Redis Stream `CREDENTIAL_EVENT_STREAM` (default `certification.credentials`) with consumer group `marketplace-projection-v1`. Each entry has one field, `envelope`, holding JSON:

```json
{ "eventId": "unique id", "eventType": "credential.issued", "credentialId": "uuid",
  "agentLearnerKey": "…", "occurredAt": "ISO-8601",
  "credential": { "credentialId": "uuid", "credential": { <W3C VC payload as certification-service issues it> },
    "compactJws": "header.payload.signature" } }
```

- `eventType` is one of `credential.issued`, `credential.suspended`, `credential.reinstated`, `credential.revoked`, `credential.superseded`.
- `credential` is required on `credential.issued` only. It must name the same `credentialId` and `agentLearnerKey` as the envelope.

Rules:

- **Delivery.** At least once. An entry is acknowledged only after its change commits. A repeated `eventId` is recorded once in `projection_inbox` and changes nothing.
- **Poison entries.** An entry that cannot be parsed or trusted is quarantined at once by stream id; its content is never stored. An entry whose processing keeps failing is quarantined after 3 attempts. Neither blocks later entries.
- **Ordering.** An event older than the record's last event is ignored. Revoked is final. Superseded can only become revoked.
- **Unknown credentials.** A status event for a credential never seen issued is ignored as `unknown_credential`.
- **Rebuildable.** `credential_projection` can be rebuilt. It decides only which credentials are considered; status and fingerprint are always rechecked against their owners.

## Internal routes (marketplace-service)

`POST /internal/capability-requests`, `POST /internal/capability-requests/:id/versions`, `/:id/open`, `/:id/close`, `/:id/eligibility-checks`, `GET /internal/capability-requests[/:id]`, `GET /internal/eligibility-checks/:checkId`, `POST /internal/listings/publish|withdraw`, `GET /internal/listings/:agentLearnerKey`, `GET /health`.

## Error codes

| Status | Code | Meaning |
|---|---|---|
| 400 | `invalid_request` | Bad body; `details` lists `unexpected:<field>`, `invalid:<field>`, `domain_unsupported` or a missing field name |
| 400 | `invalid_lifecycle_payload` | Listing interaction with extra `payload.data` fields |
| 401 | `unauthorized`, `invalid_token`, `token_expired` | No or bad token (Gateway); bad internal key or actor (service) |
| 403 | `forbidden`, `identity_mismatch` | Role not allowed; listing for another learner |
| 404 | `request_not_found`, `version_not_found`, `check_not_found` | Unknown id |
| 409 | `idempotency_conflict` | Same key, different content or action |
| 409 | `request_closed` | New version or open after close |
| 409 | `request_not_open` | Check on a draft or closed request, or closed while sources were called |
| 409 | `request_version_changed` | Another version was opened while sources were called |
| 409 | `concurrent_update` | A second write collision after one retry; safe to retry with the same key |
| 502 / 504 | `upstream_unavailable` / `upstream_timeout` | Gateway could not reach marketplace-service |
| 503 | `marketplace_unavailable` | Gateway config missing, or a service-side failure |
| 503 | `marketplace_not_configured` | Service started without its key, required config or schema |

`/health` returns 503 with `problems` (for example `missing:DATABASE_URL`, `schema_not_applied`) until the service is fully configured, and reports `eventFeed: running|disabled`.
