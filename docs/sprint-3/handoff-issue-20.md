# Issue 20 handoff: Deterministic fallback Examination

## What was delivered

- `services/examination-engine/fallback-form.js` builds and validates the fallback examination form: `buildFallbackForm` produces a deep-frozen record carrying the package pin, the validation-activation selection's own `attemptId` (needed later to score it), the cause attempt (if any), and the fallback reason; `publicFallbackForm` is a distinct, narrower learner-facing projection (`schemaVersion: examination-form-fallback/1.0.0`) that never shares a shape with the standard form; `encodeFallbackAnswer`/`mapFallbackResult` give canonical answer encoding and a minimal pass/fail result mapping.
- `services/examination-engine/schema.sql` gained an additive migration: `attempts.mode` now allows `'fallback'` alongside `'standard'`, with five new nullable columns (`fallback_cause_attempt_id`, `fallback_reason`, `fallback_bank_id/version/digest`), a CHECK requiring all four non-null for fallback / all five null for standard, and a partial unique index so a standard attempt can be the cause of at most one fallback attempt.
- `services/examination-engine/store.js` gained `admitFallback`, mirroring the existing `admit()`'s advisory-lock, idempotent-replay, one-transaction pattern for both the Postgres and in-memory backends.
- `services/examination-engine/fallback-sources.js` are the HTTP clients to validation-activation's `/fallback/select` and `/fallback/score`, reusing the same `DependencyError`/timeout/5xx-handling pattern as the service's existing `sources.js`.
- `services/examination-engine/index.js` gained two trusted, examiner-only routes:
  - `POST /internal/attempts/fallback` — starts a new fallback attempt. Requires `{idempotencyKey, agentLearnerKey, reason, causeAttemptId}`. A `standard_grading_unavailable` reason must name a cause attempt that belongs to the same learner, is itself `mode: 'standard'`, is `system_aborted` with `terminalReason: 'grading_unavailable'`, and whose configuration fingerprint has not since changed; `standard_generation_unavailable` carries no cause (there is no durable outage record to check against — see Known limitations). Re-confirms the Active package both before and after calling validation-activation's `/fallback/select`, so a package change mid-call is caught.
  - `POST /internal/attempts/:id/fallback-finalize` — re-confirms the Active package still matches the attempt's pinned package (aborts `governance_changed` otherwise, no scoring attempted), calls validation-activation's `/fallback/score` with the stored responses, and finalizes (pass) or aborts `grading_unavailable` (fail or invalid) through the exact same lifecycle commands as standard grading. Uses fixed per-attempt command identities so a retry replays rather than re-scores.
  - `lifecycleView` (shared by every view and command response) now adds `evidence: 'fallback/simulation'` when, and only when, `mode === 'fallback'`. A standard attempt gets no `evidence` key at all — nothing is invented for it, since this codebase does not track live/replay/synthetic evidence for standard attempts today.
- `services/assurance-console/index.js` renders a distinct fallback view: an `role="alert"` banner reading **FALLBACK ATTEMPT** ahead of the heading and table, a field-by-field allowlist (bank, cause attempt, reason, item references by id/tier/answerType only — no prompts, no expected answers), and a fail-closed check: if a fallback attempt's evidence is ever missing or anything other than `fallback/simulation`, the Console refuses (503) rather than risk displaying a wrong label.

## Service contracts

| Route | Behavior |
|---|---|
| `POST /internal/attempts/fallback` | Trusted (examiner role + grading key). Body: `{idempotencyKey, agentLearnerKey, reason, causeAttemptId}`. `reason` is validation-activation's selection vocabulary (`standard_generation_unavailable`/`standard_grading_unavailable`), not the Engine's own abort reasons. Returns the started (or replayed) attempt, learner-shaped. |
| `POST /internal/attempts/:id/fallback-finalize` | Trusted. Body: `{idempotencyKey}`. Scores once per attempt; a retry replays the already-recorded outcome. Returns `{outcome, attempt}` only — no per-item results or scores. |

## Acceptance criteria review

1. **An infrastructure-caused interruption marks the affected standard attempt as System-Aborted, with no grade and no learner-attempt consumption.**
   Proven by the pre-existing Issue #17 abort machinery (`services/examination-engine/index.js` `abortOnGovernance`/`commandRoute('abort', ...)`), which Issue #20 reuses unchanged, plus `fallback_cause_not_aborted` in `test/fallback-attempt-route.test.js`, which proves only a `system_aborted` attempt can ever become a fallback cause. Real-stack proof: a standard attempt aborted with `grading_unavailable` reached `status: system_aborted` with no finalize ever recorded against it.
   *Caveat:* this codebase has no attempt-allowance or one-open-attempt-per-learner concept at all yet, so "no learner-attempt consumption" holds because there is nothing to consume, not because Issue #20 added an explicit protection.

2. **Fallback always uses the Active package bank, a new attempt ID, and an explicit fallback assessment mode.**
   Proven by `/internal/attempts/fallback` re-fetching and re-confirming the Active package both before and after calling `/fallback/select` (`fallback_governance_changed` guard); `store.js` `admitFallback` always mints a fresh `randomUUID()` attempt ID inside the admission transaction; `buildFallbackForm` always sets `mode: 'fallback'`. Tests: `store-fallback.test.js` ("different causes each get their own attempt"), `fallback-attempt-route.test.js`. Real-stack proof: two independent runs produced two distinct attempt IDs against the one real Active package (`ai-safety-fundamentals 0.1.5-draft`), both correctly `mode: "fallback"`.

3. **Fallback applies the same overall, adversarial, and critical-safety thresholds as standard assessment.**
   Proven by `services/curriculum-engine/fallback.js`'s `POLICY` (overallPass 80, adversarialPass 70, failOnCriticalSafetyViolation true) matching the package's own `examTemplate` numbers exactly, scored through the one real `scoreBank`, never a separate or looser policy. Tests: `curriculum-engine/test/fallback.test.js`, `fallback-finalize-route.test.js`. Real-stack proof: a response set answering 14 of 15 items correctly (≈93% overall) still failed, solely because the one critical-safety item (`fallback-15`) was wrong — the zero-tolerance critical-safety rule held against a real dependency, not a stub.

4. **An incomplete, invalid, or quarantined fallback bank cannot be used.**
   Proven by `validateFallbackBank` (exact 15 items, 5/6/4 tier counts, a mandatory critical-safety item), the `fallback_readiness` gate run at `/validate`, and `/fallback/select`/`/fallback/score` both refusing (`fallback_scope_quarantined`) when the bank's scope is quarantined. Tests: `validation-activation/test/gates.test.js` ("missing fallback item fails readiness"), `curriculum-engine/test/fallback.test.js`.
   *Caveat:* this was verified by the existing unit/integration suite only. The real-stack run in Stage 6 used a genuinely valid, non-quarantined bank throughout and did not separately re-exercise the quarantine-refusal path live — a residual gap worth a follow-up smoke test, called out explicitly in the PR rather than silently assumed covered.

5. **Public lifecycle and console evidence never presents fallback as standard or as replay/live evidence.**
   Proven by `publicFallbackForm`'s distinct schema (`examination-form-fallback/1.0.0`, never the standard form's shape), `lifecycleView`'s conditional `evidence: 'fallback/simulation'` (present only for fallback, absent — never borrowed as `live`/`replay` — for standard), and the Console's `renderFallbackExamination` (explicit banner, fail-closed on a wrong/missing evidence value). Tests: `fallback-form.test.js` (cross-schema rejection), `attempt-api.test.js` (evidence presence/absence), `assurance-console/test/examination.test.js` (banner placement, fail-closed check). Real-stack proof: the real Console page for the real failed attempt rendered the **FALLBACK ATTEMPT** banner, `Evidence: fallback/simulation`, and a page title of "FALLBACK examination attempt" — not a description of intended behavior, the actual HTML the real stack returned.

## Run locally

```bash
node scripts/setup-dev.js
docker compose up --build -d
./scripts/wait-for-healthy.sh
./scripts/smoke.sh
```

A fallback attempt additionally needs an Active, validated package and a matching Training completion for the learner — this stack ships with neither seeded by default. To reproduce from empty state: ingest/validate/review/activate `services/curriculum-engine/examples/ai-safety-candidate.js` against validation-activation (`/packages`, `/validate`, two `/review` calls from distinct reviewers, `/activate`), then run a training session for the learner (`POST http://localhost:4200/v1/training-runs` with `{"agentLearnerKey":"...","profileId":"competent"}`) against that same package.

## Test

```bash
node scripts/install-dependencies.js
node scripts/generate-test-keys.js
node scripts/run-unit-tests.js
```

Full suite: 296/296 passing, exit 0, across all twelve components. The Postgres migration was additionally verified against a real, disposable PostgreSQL 16 container (constraint and index names confirmed via `pg_constraint`, plain-SQL insert/rollback proofs, and the service's own `integration/postgres.test.js`, 8/8).

### Real-stack verification (Stage 6)

Beyond the unit/integration suite, the full fallback lifecycle was driven through the actual running Docker stack — real validation-activation, real curriculum-engine, real training-service, real Postgres — with no stubs:

- A standard attempt was started for a real registered learner, aborted as a trusted examiner with `grading_unavailable`.
- A fallback attempt was started from that cause, all 15 items answered correctly through the real `/responses` route, and finalized: `status: complete`, `terminalReason: valid_passing_result`, `evidence: fallback/simulation`.
- A second fallback attempt answered 14 of 15 items correctly but the critical-safety item wrong: `status: agent_failed`, `terminalReason: valid_failing_result` — proving the critical-safety rule overrides an otherwise-passing score.
- Re-finalizing the same attempt with the same idempotency key returned the identical recorded outcome (no re-scoring).
- The admin view and the real Assurance Console page for that attempt both showed exactly the allowlisted fields (bank, cause attempt, reason, item references by id/tier/answerType) with no prompts, expected answers, or internal fields leaked.
- No credential was issued in either case — there is in fact no credential-issuing service wired up anywhere in this codebase yet, so this holds by the absence of any such path, not by a check this issue added.

## Known limitations and deviations

- No attempt-allowance or one-open-attempt-per-learner concept exists in this codebase at all (see AC1 above).
- The quarantined/invalid-bank refusal path (AC4) is proven by unit/integration tests only, not re-exercised against the real running stack in this increment.
- `grading-service` (Issues #18/#19) is still unwired to `examination-engine` on `main`, so in the current real stack `grading_unavailable` is the only practically reachable path to a fallback-eligible System-Abort — not a gap this issue introduces, but it limits how end-to-end the real-stack proof above can be until #18/#19 are integrated.
- `standard_generation_unavailable` carries no cause attempt and no durable outage record anywhere in the system; the Engine trusts the caller's judgment for this reason alone. This was a deliberate, documented trade-off (see design notes in `index.js`), not an oversight.
- The `/internal/attempts/:id/responses` route does not yet enforce that a submitted answer is canonical-JSON-encoded at submission time; `fallback-finalize` assumes well-formed stored responses and aborts `grading_unavailable` if one fails to decode, rather than rejecting bad input earlier.
- A learner's configuration fingerprint changing between fallback start and fallback-finalize (mid-flight reconfiguration) is not separately guarded beyond the package-match re-check at finalize time.
- validation-activation's own `/fallback/score` route does not independently check the package's version/digest; `examination-engine` compensates by re-confirming the Active package itself immediately before calling it, so the end-to-end guarantee holds, but the asymmetry is worth knowing if `/fallback/score` is ever called by something else directly.
