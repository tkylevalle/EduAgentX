# Execution provenance — reference policy 1.0.0

Tracking: #83. This is the conservative reference implementation submitted for
team review, not a claim of team consensus. Ordinary learner labels are not
authority. Only explicitly configured, platform-controlled execution principals
may attest how a response was produced. They cannot grade, certify, or decide
Marketplace eligibility.

`EXECUTION_PRINCIPALS` is a server-owned JSON enrollment list. Each entry binds an
authenticated agent subject to one evidence mode and permitted versioned source
profiles. Gateway constructs downstream authority context; external headers and
body context never supply authority. Downstream context is accepted only behind
the existing internal service key and Gateway actor role. Evaluator, admin and
Demo Operator permissions grant no execution authority.

Training receives the same server enrollment for domain-initiated remediation:
the server selects the target learner's planned source, not the relay's labels.
This allocates work only; the enrolled executor must still generate and prove
every response. Enroll only new runs; existing legacy sessions cannot upgrade.

Permitted pairs are simulation/synthetic, simulation/replay and live/live. Invalid
pairs are rejected, never normalized. This version implements synthetic and
replay enrollment. Live provenance is disabled: the existing live adapter lacks
durable run execution/budget accounting. Its ordinary legacy lifecycle remains
available without trusted provenance. No paid call is needed for formal tests.

Training allocates the session UUID used as run ID. Its immutable
`execution-provenance/1.0.0` record binds learner, Registry configuration
fingerprint/version, package identity/version/digest, authenticated executor,
`reference-execution/1.0.0` policy, environment/mode and source ID/version/digest.
It is pinned at admission. Conflicting later context or labels return
409 `provenance_conflict` without advancing or aborting the session. Existing
sessions are never upgraded; changing mode requires a new run.

Each accepted response has `execution-receipt/1.0.0` evidence binding run, phase,
item, examination attempt if applicable, context hash, response hash, source
entry, receipt ID and execution time. Receipts contain no answers or prompts.
Services validate the actual delivered context and response against the pinned
reference source, not just a claimed digest. Receipt IDs are deterministic over
their binding, so changing run/item/attempt cannot reuse a receipt. Accepted
evidence commits atomically with progress. Identical retries replay unchanged.

Synthetic sources pin the deterministic reference profiles and scenario code.
Replay sources are repository-controlled sanitized captures, pinned by manifest
ID/version/digest and exact entry/context. The capture metadata identifies the
original framework, template version, request hash, capture time and fixture
version. Reference replay may capture the deterministic EduAgentX adapter; this
is explicitly simulation evidence and makes no claim of prior live inference.
No runtime fixture uploads or arbitrary replacement responses are accepted.

Training completion includes pinned provenance and a versioned answer-free
coverage summary. Examination selects an exact completed run, binds its digest
in the immutable form, and requires matching evidence for every answer. Its
Certification projection contains only provenance and coverage summaries.
Standard/fallback is independent of execution mode. Fallback retains the exact
run from a legitimate cause, or requires an exact Training completion when no
cause exists. Missing provenance is never inferred from fallback.

Certification validates the complete supported profile and coverage before
persistence, stores it in immutable examination evidence, and signs top-level
`environment` and `evidenceMode` plus the binding before committing. One decision
per examination and one credential per decision remain unchanged. The configured
`CERTIFICATION_ENVIRONMENT` is server-owned; authoritative simulation issuance
requires simulation configuration, and live issuance requires live configuration.
Use separate issuer/key deployments for test and live evidence; request content
cannot choose keys or issuers. The reference Compose deployment is simulation.

The verifier recognizes the new static provenance profile and validates its
structure, bindings and pair matrix. Marketplace uses signed fields and verifies
origin independently. Missing, malformed, mismatched or unavailable trust excludes
both Eligible and Near Match. Ranking and thresholds are unchanged.

Migrations are additive and nullable for old rows. No backfill, credential rewrite
or silent profile downgrade is permitted. Legacy Certification and verification
remain compatible; credentials without authoritative signed provenance remain
Marketplace-uncheckable.


## Structures and API compatibility

| Structure | Required binding |
| --- | --- |
| `execution-authority/1.0.0` | executorId, policyVersion, environment, evidenceMode, source |
| `execution-provenance/1.0.0` | runId, agentLearnerKey, configurationFingerprint, configurationVersion, package, executorId, policyVersion, environment, evidenceMode, source |
| `execution-receipt/1.0.0` | runId, phase, itemId, attemptId (null for Training), executorId, source, entryId, contextDigest, responseDigest, receiptId, executedAt |
| `execution-coverage/1.0.0` | runId, phase, attemptId, itemCount, itemIdsDigest, receiptsDigest |
| `certification-provenance/1.0.0` | run, training (eventId, completionDigest, coverage), examination coverage |

`source` is exactly `{ id, version, digest }`; `package` is exactly
`{ id, version, digest }`. Authority/run/receipt/coverage objects reject unknown
fields. Hashes bind canonical JSON; responseDigest binds exact UTF-8 text.
Training completion uses schema `1.1.0`; standard/fallback forms use their
respective `1.1.0` profiles when provenance-bearing, otherwise their existing
legacy versions. Certification evidence uses `certification-evidence/1.1.0` and
requires its provenance marker and complete summary even if a field is missing.

The new credential schema ID is
`https://eduagentx.example/schemas/competency/provenance-v1.json`. Its static
definition is shipped in `packages/execution-provenance/credential.schema.json`;
the accompanying validator additionally checks cross-field bindings, score/safety
consistency and exact assessed-item coverage. Verification never fetches an
arbitrary schema URL. Legacy schema processing remains compatible, but its labels
never establish Marketplace provenance.

The authoritative reference controller selects a pinned profile/scenario before
Training. Changing it requires a new run; it cannot relabel an admitted run.
Synthetic failure scenarios retain their existing deterministic responses. A
timeout cannot fabricate remaining responses or a complete coverage summary.
Fallback reference responses use the public typed item format, never hidden
scoring keys; their correctness is still decided by the existing scorer.
