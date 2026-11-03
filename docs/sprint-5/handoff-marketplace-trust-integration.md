# Issue #83 integration handoff — reference policy for review

Tracking: [#83](https://github.com/tkylevalle/EduAgentX/issues/83), blocking #33.
This implements the user's conservative reference policy for team review; it
makes no claim of team consensus. Neither issue is closed by this handoff.

## Checkpoint and isolation

- Worktree: `/home/ubuntu/ChatGPT/EduAgentX-marketplace-fix/repo`.
- Branch: `salman/fix-marketplace-trust-integration`.
- Base/main: `1a90ae5e8f14f93cd17f6ca3b53cce27d99bd8e0` (unchanged at final fetch).
- Origin checkpoint: `0420e8d31fb6ea1ea5eea38a176cce93ad252d70`.
- This follow-up adds execution provenance without amending the origin checkpoint.
- No #33 source/harness was copied, merged, reset, rebased or executed. Its
  separate worktree and the parent project's protected metadata were untouched.

## Final architecture

Gateway authenticates the existing agent JWT and resolves explicit server-owned
`EXECUTION_PRINCIPALS` enrollment. Each principal has a fixed mode and permitted
repository source profiles. Generic agent, evaluator, admin and Demo Operator
roles confer no provenance authority. Gateway constructs internal context;
external context headers/body fields cannot override it.

Training pins versioned provenance at admission to its session UUID (run ID),
learner, Registry configuration/version, package, executor, policy and source
manifest. Every accepted response has source-validated run/item/response evidence
committed with progress. Conflicts return 409 without advancing or aborting the
run. Completion derives from pinned provenance and complete receipt coverage.
Server enrollment also supplies planned provenance for domain-initiated
remediation; assigning work grants no permission to attest responses.

Examination binds the exact Training completion and validates its own response
evidence. Its immutable form, response events and answer-free Certification
projection bind source and coverage digests. Standard/fallback is independent of
synthetic/replay/live. Fallback inherits a legitimate cause's run or checks an
exact Training completion; missing provenance never becomes synthetic.

Certification checks the supported profile, package, subject/fingerprint, complete
coverage and configured issuer environment before persistence. New credentials
sign top-level environment/evidenceMode and their complete answer-free binding.
The existing examination/decision/credential uniqueness, transaction and replay
path remain unchanged. The verifier checks the static profile and cross-field
bindings. Marketplace maps only its explicit signed provenance and independently
rechecks issued origin plus every existing gate. Ranking is unchanged.

See [the exact contract](../contracts/execution-provenance.md) and
[origin/integration decision](../contracts/marketplace-trust-integration.md).

## Supported paths and limitations

- **Synthetic:** explicitly enrolled deterministic profile/scenario snapshot;
  exact responses/context/digest checked. Existing failure responses remain
  deterministic, and timeout cannot fabricate a complete response set.
- **Replay:** separate enrolled agent principal; 40 repository-controlled capture
  entries (10 Training, 15 standard Examination, 15 fallback). Each records the
  actual deterministic reference framework, original synthetic capture mode,
  template/request hash, timestamp, fixture version and sanitized response/hash.
  Runtime uses the exact captured entry. These are not claimed as prior live
  provider responses. New/unrecorded contexts fail closed and require a reviewed
  versioned capture. Runtime uploads are not supported.
- **Live:** authoritative enrollment is disabled. The optional existing live
  adapter lacks durable lifecycle invocation/budget accounting. Ordinary legacy
  participation does not gain trusted labels; no paid model call was made.
- **Issuer isolation:** the reference Compose issuer explicitly permits
  simulation provenance. A live-only or unconfigured issuer refuses simulation
  provenance. Separate test/live issuer/key deployments must be provisioned by
  the operator; request content cannot select an issuer or key. No new PKI was
  introduced.
- **Legacy:** old rows and signatures remain unchanged. Descriptive labels do
  not gain authority. New authoritative profiles cannot silently downgrade when
  required data is missing. Finish legacy open sessions before enrolling their
  identity; existing sessions cannot upgrade in place.

## Additive migration

Only `services/training-service/schema.sql` adds persistence:

1. Nullable `training_service.sessions.provenance jsonb`.
2. Nullable `training_service.session_events.execution_evidence jsonb`.
3. Unique partial `execution_receipt_once` index on receiptId for non-null rows.

No defaults or backfill. Existing append-only protections remain. Examination
uses existing form/event/receipt JSON; Certification uses existing immutable
evidence/credential JSON. Versioned compatible readers retain legacy profiles.

## Verification

Counts below overlap; they must not be added as unique scenarios.

| Verification | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Required full unit/contract/security runner | 787 | 0 | 0 |
| Existing Sprint 5 technical verifier, including its PostgreSQL check | 528 | 0 | 0 |
| Relevant Training/Examination/Certification/Marketplace/Skill Gap PostgreSQL suites | 22 | 0 | 0 |
| Real synthetic/replay Eligible and ordinary legacy replay-label exclusion | 4 | 0 | 0 |
| Real issuer outage | 1 | 0 | 0 |
| Real Training/Examination/Certification restart and immutable replay | 1 | 0 | 0 |
| Final focused Marketplace mapper | 13 | 0 | 0 |
| Final focused Training admission/replay checks | 36 | 0 | 0 |

Full-run component counts: Gateway 55; external protocol 7; reference adapter 34;
Training 80; Examination 143; Certification 38; verifier 39; Marketplace 203;
shared execution package 15. All other existing components also passed.

The real rehearsal used fresh isolated Compose volumes and random loopback
ports. Both synthetic and replay completed Registration -> Training ->
Examination -> Certification -> verification -> real publication/Redis projection
-> issuer-origin lookup -> listing/request -> Eligible matching. No injected
Marketplace authority or database insert created candidates. A real legacy
credential passed signature and origin but entered neither lane. Stopping the
issuer excluded valid-provenance candidates; restarting three lifecycle services
preserved Training receipts, exact completions, Examination summaries, JWS bytes,
origin, one credential per decision and Eligible results. Only this invocation's
project containers, volumes, network and local image tags were removed.

The first loaded-build unit attempt hit one pre-existing 200 ms HTTP timeout;
the full suite passed without changing that timeout. Restart testing required
refreshing Docker's random host ports. Neither was hidden by relaxing a check.
`git diff --check` passed.

Not run: the formal 1,000-scenario suite, formal 100-case golden suite and paid
live inference. The older origin-only opt-in Compose file remains for unenrolled
fresh deployments; its origin/outage/replay/legacy invariants are exercised by
the expanded real rehearsal rather than a second separate legacy stack.

Ignored evidence: `artifacts/marketplace-trust/provenance-*.tap`,
`provenance-unit-final.log`, `provenance-sprint5.log`, final audit JSON/Markdown,
plus `artifacts/sprint1/unit-tests.json` and `artifacts/issue-32/report.json`.
Runtime environment/key material stays ignored and is never staged.

## Security audit

Passed: explicit enrollment only; no role-based self-grant; public context
spoofing ignored/refused; exact source and response binding; no cross-run/item
receipt reuse; no caller-selected issuer/key; no prompts/answers/secrets in
provenance summaries; immutable admission/coverage; missing/conflicting/unknown
trust fails closed; no legacy upgrade; independent origin, signature, schema,
status, fingerprint, discoverability and package checks; trust failure enters
neither lane; unchanged exactly-once Certification and original signed replay.

Reference executors and their credential custody remain trusted platform
components. This is not hardware attestation or proof of an arbitrary external
adapter's honesty. The repository capture is simulation evidence, not live
inference. Team review should focus on enrollment custody and the reference
capture policy. These documented boundaries do not require weakening #33.

## Exact production/support files

- `.env.example`
- `docker-compose.yml`
- `packages/execution-provenance/capture-reference.js`
- `packages/execution-provenance/credential.schema.json`
- `packages/execution-provenance/index.js`
- `packages/execution-provenance/package-lock.json`
- `packages/execution-provenance/package.json`
- `packages/execution-provenance/reference.js`
- `packages/execution-provenance/replay.json`
- `services/api-gateway/auth.js`
- `services/api-gateway/index.js`
- `services/certification-service/evidence.js`
- `services/certification-service/index.js`
- `services/credential-verification/Dockerfile`
- `services/credential-verification/src/verifier.js`
- `services/examination-engine/fallback-form.js`
- `services/examination-engine/generation.js`
- `services/examination-engine/index.js`
- `services/examination-engine/lifecycle.js`
- `services/examination-engine/sources.js`
- `services/examination-engine/store.js`
- `services/marketplace-service/clients.js`
- `services/synthetic-agent-learner/exam-runner.js`
- `services/synthetic-agent-learner/index.js`
- `services/synthetic-agent-learner/learner.js`
- `services/training-service/index.js`
- `services/training-service/schema.sql`
- `services/training-service/session.js`
- `services/training-service/store.js`

## Exact test/support files

- `packages/execution-provenance/test/fixtures.js`
- `packages/execution-provenance/test/provenance.test.js`
- `services/api-gateway/test/training.test.js`
- `services/certification-service/integration/postgres.test.js`
- `services/certification-service/test/issuance.test.js`
- `services/credential-verification/test/provenance.test.js`
- `services/examination-engine/integration/postgres.test.js`
- `services/examination-engine/test/provenance.test.js`
- `services/marketplace-service/integration/execution-provenance.test.js`
- `services/marketplace-service/test/clients.test.js`
- `services/synthetic-agent-learner/test/service-black-box.test.js`
- `services/training-service/integration/provenance-postgres.test.js`
- `services/training-service/test/provenance.test.js`

## Exact documentation files

- `docs/contracts/certification.md`
- `docs/contracts/execution-provenance.md`
- `docs/contracts/external-agent-learner-protocol.md`
- `docs/contracts/marketplace-matching.md`
- `docs/contracts/marketplace-trust-integration.md`
- `docs/contracts/marketplace.md`
- `docs/sprint-5/handoff-marketplace-trust-integration.md`

## Review recommendation

READY TO COMMIT AND OPEN PR under the adopted reference scope. The implemented
and tested origin/provenance path addresses #83's acceptance criteria; leave #83
open for team review and do not merge automatically. #33's formal run remains
paused until the integration is reviewed and the harness is deliberately updated
through its own workstream.
