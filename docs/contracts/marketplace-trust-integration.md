# Certification to Marketplace trust integration decision

Base: `1a90ae5e8f14f93cd17f6ca3b53cce27d99bd8e0` (`origin/main`).
Scope: exact issued origin plus authoritative execution provenance under the
conservative reference policy submitted for team review.

Tracking authority: [Issue #83 — Sprint 5: Certification-to-Marketplace trust
provenance integration](https://github.com/tkylevalle/EduAgentX/issues/83).
The lifecycle-origin portion is implemented and tested on
`salman/fix-marketplace-trust-integration`. Issue #83 remains **OPEN** for team
review. The origin checkpoint and subsequent
execution-provenance implementation together address the integration blocking
Issue #33; the formal #33 suite is not run by this branch.

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

## Execution provenance reference decision

The user adopted a conservative reference policy for review under #83. This does
not claim team consensus. The [versioned contract](execution-provenance.md)
replaces the earlier unresolved authority question with explicit server enrollment
of platform-controlled mode-enforcing principals.

Synthetic and replay are implemented end to end. Caller labels, generic agent
permissions, evaluator/admin identities and provider names are not authority.
Training pins the run at admission and stores validated response receipts;
Examination pins the exact completion and validates its own responses.
Certification validates the answer-free summary before persisting and signing
explicit environment/evidenceMode. The verifier checks the versioned profile;
Marketplace maps only its signed labels and retains independent origin checks.

Replay is an honest capture of the deterministic reference adapter, with capture
framework, original synthetic mode, template/request hashes, timestamps, fixture
versions, exact entries and a manifest digest. It is not represented as captured
live provider output. Runtime uploads and arbitrary replacement text are refused.

Live authority remains disabled because the existing optional adapter has no
durable lifecycle invocation/budget ledger. Its ordinary legacy path is not
silently upgraded. No paid inference is required for #33.

Assessment standard/fallback remains separate. A fallback may retain a valid
cause's run or bind an exact Training completion when generation produced no
attempt; its responses require the same execution evidence. Missing bindings
remain uncheckable. No fallback-to-synthetic inference exists.

Migration adds nullable Training provenance/receipt JSON and a unique receipt
index. Old rows are not backfilled. Examination and Certification reuse immutable
JSON evidence. Existing decisions replay before source lookup, preserving the
original signed result and exactly-once constraints.

The reference Compose issuer explicitly permits simulation provenance only.
Test/live issuer keys must be provisioned separately. Neither requests nor
executors can choose the signing key. Legacy credentials remain unchanged and
Marketplace-uncheckable when provenance or the signed decision binding is absent.

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
provenance. It also tests actual issuer outage and process restart. The origin-only rehearsal remains available for deployments without executor
enrollment. The new execution-provenance rehearsal proves real Eligible results.

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


The focused authoritative rehearsal is
`services/marketplace-service/integration/execution-provenance.test.js`.
Use `MARKETPLACE_PROVENANCE_CONFIG` for an ignored JSON URL configuration and
`envFile` pointing at an ignored checkout-local test environment. Enroll separate
synthetic/replay identities, use fresh project volumes and random loopback ports,
and disable live provider access. Run only the `^real authoritative` stage; then
stop that project's issuer for `MARKETPLACE_PROVENANCE_STAGE=issuer-unavailable`
and its matching test, restart lifecycle services for `restarted`, and remove only
that project's resources. Detailed counts and limitations are in the Sprint 5
handoff. These are focused checks, not either formal suite.
