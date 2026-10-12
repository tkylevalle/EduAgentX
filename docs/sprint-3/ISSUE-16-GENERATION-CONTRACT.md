# Issue #16 — examination generation and delivery contract

This branch starts from merged Sprint 2 `main` (`4dbe172`). It implements the technical Issue #16 generation and delivery path. It does **not** assert Sprint 2 or Sprint 3 formal exit: independent package/content review and cumulative gates remain separate human decisions.

## Production path

1. `POST /v1/examinations` at the authenticated Gateway accepts only `idempotencyKey`; learner identity comes from the JWT. `GET /v1/examinations/:attemptId` is owner-only. The admin route `GET /v1/admin/examinations/:attemptId` and local Assurance Console `/examinations/:attemptId` show governing identifiers and item references without prompts or answers.
2. The Examination Engine fetches the Active, non-quarantined package from Validation/Activation, current Registry record, and a committed Training completion from Training's exact package/learner lookup. None of these records is accepted from the public body.
3. `standard-generator.js` constructs 15 deterministic, provider-free prompts from the pinned template, objectives, modules, and source links. It never reads the fallback bank. `generation.js` validates exact slot counts and 20/40/40 weights, objective/tier/source-pinpoint/critical-rule coverage, unique prompts/IDs, policy hashes, and an allowlist of item fields. Missing or malformed outputs fail closed.
4. The Examination Engine atomically inserts the validated form and its governing identities into its own PostgreSQL schema, plus an `attempt_started` event, **before** learner delivery. A per-key advisory transaction lock and unique constraint make concurrent retries converge on the same attempt. Immutable triggers reject updates and deletes. `EXAM_DURATION_MINUTES` defaults to 60 for local technical runs; the team must approve the release duration.
5. Agent reads and retries recheck active-package and fingerprint governance; expiry and quarantine stop further delivery. The admin projection is identifier-only. There is no response or grade route in Issue #16.

## Issue #17 handoff

Salman and Timothy should extend the one Examination Engine aggregate, not replace it with another attempt store. `examination_engine.attempts` is the immutable manifest and `attempt_events` starts at sequence 1. Issue #17 owns response and completion transitions, timeout/System-Aborted versus Agent-Failed state, sequence/idempotency checks for those transitions, and restart/race tests. Preserve the start/read contracts and pinned form hashes. Coordinate schema evolution before merging concurrent edits.

Issue #18 grades only a persisted, complete attempt against its pinned rubric. Issue #20 owns a distinct fallback attempt from the prevalidated bank; standard generation must never quietly reuse that bank.

## Verification and limits

- `node scripts/run-unit-tests.js`: 196/196 passed on 2026-10-12, including generation, Gateway, Training lookup, Examination route, console projection, and failure-path tests.
- `EXAMINATION_TEST_DATABASE_URL=<isolated PostgreSQL URL> node --test services/examination-engine/integration/postgres.test.js`: passed against a temporary PostgreSQL 16 container using the dedicated `examination_owner` role. Verified concurrent admission, restart read, single start event, and immutable-row rejection.
- `docker build -f services/examination-engine/Dockerfile -t eduagentx-examination-verify .`: passed. `docker compose config --quiet`: passed after checkout-local setup.
- These tests are technical evidence, not independent factual/content approval. The existing domain package's authored examination policy explicitly calls for independent review before examination use. A full approved-package, real-service Compose demonstration has not been run from this branch; the separate Sprint 2 stack was already running under another checkout and was not displaced.
