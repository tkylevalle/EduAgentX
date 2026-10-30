# Skill Gap recommendations (Issue 32)

The thin Skill Gap Service converts authoritative structured examination failures and stored Marketplace Near Matches into immutable `skill-gap-recommendation/1.0.0` recommendations under `SKILL-GAP-1.0.0`. It has no grading, certification, credential, request-editing, eligibility or learner interaction commands.

## Public contract

All routes require the existing Gateway `admin` token, matching targeted Training assignment authority. The Gateway forwards the token subject, role, correlation ID and a service key. Body/header claims cannot replace the authenticated identity. There is no host port for Skill Gap.

| Method | Route | Body |
|---|---|---|
| POST | `/v1/admin/skill-gap/recommendations` | `{ "source": { "type": "examination", "id": "attempt UUID" }, "agentLearnerKey": "registered learner", "idempotencyKey": "operator command key" }` |
| GET | `/v1/admin/skill-gap/recommendations/:id` | None |
| POST | `/v1/admin/skill-gap/recommendations/:id/training-handoff` | `{}` |

`source.type` may also be `marketplace`, with the stored match-result UUID as ID. Only reference fields are accepted; clients cannot submit scores, gaps, source digests, policy overrides or Training objectives. Internal routes use `/internal/recommendations` with the same suffixes and require `x-internal-service-key`, `x-actor-subject` and `x-actor-role: admin`.

Creation returns 201 `created`; retries return 200 `replay`. The key is scoped to the actor; different source/learner content on that key returns 409 `idempotency_conflict`. A stable recommendation ID deduplicates the same source/learner/policy across keys and actors. A changed source under that identity returns 409 `source_conflict`. Existing command replay needs no source availability. GET returns the immutable recommendation and the most recent recorded delivery attempt (null before any handoff).

## Evidence and policy

Examination is read through its existing admin remediation trace. It must be Agent-Failed with `examination.remediation.required` v1.0.0, matching attempt/learner/event identity, package digest, objective and critical-rule gaps, failure digest, template/rubric versions and explicit evidence labels. System-Aborted, passing, fallback without structured gaps, or unsupported versions cannot produce a recommendation. The trace adds only template/rubric identifier/version/digest references from the pinned form.

Marketplace is read through its immutable match-result route. Only a matching learner in `nearMatches`, `eligible: false`, `lane: Not Eligible`, with every known trust check passing, qualifies. Eligible candidates, exclusions and uncheckable evidence are refused. Recommendations preserve exact gap codes and allowlisted threshold/actual values, request ID/version/digest and matching policy version. Historical gaps describe that observation; they are not a fresh eligibility decision.

Every recommendation retains a canonical source digest, source schema/policy version, learner, source package, evidence mode/environment, observation time, policy version and target Training scope. The only supported domain is AI Agent Safety and Secure Tool Use. Examination targets must belong to the same pinned package. Marketplace missing-objective targets are resolved against the active authoritative package; its ID/version/digest are retained separately from the assessed source package. Unknown targets and quarantined packages are refused.

Age, aggregate-score and assessment-mode gaps are preserved as required actions, without inventing objective-level weaknesses. Without explicit missing objectives the recommendation says `no_targeted_training`; handoff returns a refusal with that reason. It does not silently broaden to an entire course, renew a credential or initiate an examination.

No raw answers, source response bodies, private prompts, JWSs, secrets or grading rationale are exported. Source digests are evidence links, not substitutes for signatures or issuer policy.

## Training handoff and recovery

Creating or reading a recommendation makes no Training call. An explicit admin handoff is required for Marketplace recommendations. Skill Gap maps its stored scope to Training's existing structured contract, with `requestId=skill-gap:<recommendationId>`, cause type `skill_gap` and source evidence digest. Target package content is rechecked; Training owns registration, active-package, objective, practice, quarantine and durable request-id validation.

Examination already has a durable remediation relay. Skill Gap never sends a second Training command for an examination recommendation. Its handoff reads and records that relay's authoritative pending/delivered/refused outcome, including the original session ID. The existing examination behavior and re-examination gate remain intact.

Handoff returns 200 with delivered/refused state, or 202 pending after unavailable Training, temporary package state, busy learner or an ambiguous reply. The operator retries the same handoff command to reconcile pending work. No background enrollment worker is introduced. Training's stable request ID handles a lost response after successful assignment, including after a process restart. Known permanent Training refusals are retained as terminal; a new source recommendation is needed for a different scope.

PostgreSQL owns immutable recommendations, per-actor command mappings, append-only handoff attempts and final delivery records. Transactions and per-recommendation advisory locks serialize concurrent handoffs. Outbound calls have a two-second deadline. A crash after Training commits but before Skill Gap commits is retried with the same Training request ID. A database outage returns an unavailable result; no success is fabricated. A final delivery is historical evidence of assignment, not a claim about current session completion or current credential trust.

## Configuration and acceptance limits

`node scripts/setup-dev.js` adds local `SKILL_GAP_DB_PASSWORD` and `SKILL_GAP_INTERNAL_KEY`. Compose initializes a restricted `skill_gap_owner` role for fresh and existing database volumes, mounts no private signing material, and connects the service internally on 4013. It reads Examination, Marketplace and validation-activation and calls only Training's remediation command. Existing owner credentials are injected only where those interfaces require them.

Run `node scripts/verify-issue-32.js` after installing the affected components and generating local test keys; see the Sprint 5 handoff for exact instructions. Database integration requires a fresh disposable PostgreSQL database. Public contract tests run real service applications with memory stores and injected curriculum/registry/grader/trust authorities. They do not establish the unfinished real Certification-to-Marketplace origin contract or the cumulative Sprint 5 exit gate.
