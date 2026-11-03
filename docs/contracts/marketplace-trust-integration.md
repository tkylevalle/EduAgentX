# Certification to Marketplace trust integration decision

Base: `1a90ae5e8f14f93cd17f6ca3b53cce27d99bd8e0` (`origin/main`).
Scope: repair authoritative origin independently; do not sign unvalidated
environment/evidenceMode labels. Overall status: **BLOCKED BY CONTRACT DECISION**.

Tracking authority: [Issue #83 — Sprint 5: Certification-to-Marketplace trust
provenance integration](https://github.com/tkylevalle/EduAgentX/issues/83).
The lifecycle-origin portion is implemented and tested on
`salman/fix-marketplace-trust-integration`. Issue #83 remains **OPEN** because
authoritative signed environment/evidenceMode provenance is unresolved; it blocks
Issue #33's formal Marketplace acceptance. This origin-only change does not
complete #83.

## Origin decision

Marketplace needs proof that its exact signed credential belongs to an immutable
issued Certification Decision for the same Examination, learner and configuration.
Certification owns this relationship. A valid signature alone cannot establish it.

The exact selector is the issued credential UUID, not a learner search or a
credential collection. [The origin read](certification.md#marketplace-origin-read)
returns only versioned immutable identity facts and the SHA-256 digest of the
exact compact JWS. New credentials sign `evidence.certificationDecisionId` before
the existing transaction commits. The signed examination ID already exists.
Decision allocation remains under the existing memory serialization / PostgreSQL
advisory lock. No evidence-fingerprint, command-digest, uniqueness constraint or
existing credential changes are needed.

Certification accepts Marketplace's existing internal key only on this narrow
read with its service identity. The key must differ from the issuer command key;
it grants no access to other issuer routes. Marketplace uses the production
bounded HTTP client (two-second deadline, no redirects, no retries). It compares
the returned credential/decision/examination/learner/fingerprint/digest with the
signed artifact and reconstructs the candidate to detect unsigned projection
overrides. Signature, schema, status, current Registry fingerprint, environment,
domain, objectives, scores, age, modes and discoverability still run independently.

Unknown or mismatched origin is false. Missing configuration, missing signed
bindings, malformed response, timeout or unavailable issuer is uncheckable. Both
outcomes are trust failures and enter neither matching lane. Failed/aborted
examinations cannot create decisions. Persisted issuance is replayed unchanged,
including after restart; lookup requires no current Examination availability.

## Provenance analysis and required owner decision

The meaning of the basic pairs is clear:

| Evidence mode | Environment | Existing contract |
| --- | --- | --- |
| synthetic | simulation | Deterministic seeded responses |
| replay | simulation | Sanitized, versioned captured fixtures |
| live | live | Fresh model responses during this run |
| fallback | simulation | Protocol label for deterministic fallback; not a Marketplace evidenceMode |

Sources: [protocol](external-agent-learner-protocol.md#evidence-modes),
[approved demonstration boundary](../blueprint/issues/03-decide-demo-agent-boundary.md),
[matching](marketplace-matching.md#integration-boundary).
The missing decision is which authoritative record proves those facts, not how
to spell their enums or transport their fields.

Observed implementation:

1. `packages/external-agent-protocol/index.js:normalizeEvidence` validates the
   caller's enum/environment/label combination. It does not validate a seeded
   run, replay fixture identity or fresh model invocation.
2. `services/api-gateway/auth.js` authenticates a subject and role; it supplies no
   trusted run/mode claim. `forwardTrainingInteraction` forwards the learner's
   normalized evidence unchanged. Provider/model names are opaque by contract.
3. `services/training-service/index.js:requestInput` validates only the enum pair.
   Session events retain each request's labels. Session guards do not bind a mode
   for the entire session. `session.js:completionEnvelope` copies the final
   request's labels, even if earlier requests declared other valid modes.
4. `services/examination-engine/generation.js` pins that completion evidence in
   `form.training.evidence`. Examination responses carry no independent mode/run
   attestation. The Certification projection drops the Training evidence.
5. Fallback forms explicitly have no Training event; the Engine labels assessment
   as `fallback/simulation`. Marketplace evidenceMode admits synthetic/replay/live,
   separately from standard/fallback assessment mode. No contract deterministically
   maps fallback to one of those learner evidence modes.
6. Certification does not validate, persist or sign environment/evidenceMode.
   Blueprint contracts additionally require a separate test issuer/key for
   synthetic/replay credentials; the current service has one configured signer.
   Routing validated provenance to issuer/key policy needs to be specified too.

Training/Examination, Gateway authentication, and Certification/Marketplace owners
must agree and version:

- The source authority and exact run/evidence record that validates mode, subject
  and configuration, including the required seeded-run, replay-fixture and live
  invocation bindings. An authenticated learner's string alone is insufficient.
- Where that record is pinned and how every Training/Examination interaction is
  checked against it, including conflicting/mixed modes and a new run after a
  mode change. The last request must not silently relabel earlier evidence.
- Fallback provenance: retain a validated learner-run mode separately from
  assessment mode, or another explicitly approved representation and Marketplace
  rule. Do not infer synthetic from deterministic grading.
- The test/live issuer and signing-key selection policy.

After that decision, propagate the validated record through the answer-free
Examination projection; validate it before Certification persists; retain it in
immutable decision evidence; include environment/evidenceMode before signing;
and add supported synthetic/replay/live/fallback and conflict/restart tests.

No label defaults, provider inference or caller-label signing were introduced.
Existing non-Marketplace Certification behavior stays compatible. All credentials
without trusted signed provenance remain uncheckable in Marketplace. Existing
credentials without the newly signed decision ID remain origin-uncheckable too;
no old signature or decision is rewritten.

## Verification scope

The new unit tests cover origin authorization, exact selectors, unknown/mismatched
bindings, failure/abort, timeout/unavailability, malformed responses, tampering,
unsigned projection spoofing and immutable replay. PostgreSQL verifies exact
origin persistence, fresh-store/fresh-connection replay, concurrent uniqueness and
the existing UPDATE/DELETE protections.

`services/marketplace-service/integration/lifecycle-origin.test.js` is an opt-in
focused Compose test. It uses the real Gateway, Registry, Training, Examination,
grader, Certification, verifier, outbox, Redis consumer and Marketplace. No
Marketplace authority fixtures or database edits create candidates. Its positive
result is **trusted issued origin**, followed by real exclusion for missing
provenance. It also tests actual issuer outage and process restart. It cannot
claim a positive Eligible Match until the provenance contract is resolved.

Run against a new isolated Compose project with checkout-local `.env`/`keys/`,
random loopback ports and fresh volumes. Set `MARKETPLACE_LIFECYCLE_CONFIG` to an
ignored JSON file with `gatewayUrl`, `syntheticUrl`, `validationUrl`,
`certificationUrl`, `verificationUrl`, and `marketplaceUrl`. Run the first stage:

```sh
node --test --test-reporter=tap --test-name-pattern='^real lifecycle:' services/marketplace-service/integration/lifecycle-origin.test.js
```

Stop only that project's Certification container; rerun the file with
`MARKETPLACE_LIFECYCLE_STAGE=issuer-unavailable` and
`--test-name-pattern='^real issuer outage'`. Start it again, wait for health, then
refresh its random host port in the URL configuration, then use
`MARKETPLACE_LIFECYCLE_STAGE=issuer-restarted` and
`--test-name-pattern='^real issuer restart'`. State is retained only under ignored
`artifacts/marketplace-trust/`; remove only resources created by the invocation.
These are focused integration checks, not the formal golden or 1,000-case suites.
