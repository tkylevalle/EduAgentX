# Sprint 1 Evidence Pack — Issue 8

Owner: Timurmalik Djuraev
Status: IN PROGRESS — Sprint Gate not approved
Environment: local simulation; no paid APIs

## Available evidence

- smoke-fresh.txt: all 13 smoke checks passed in a fresh database.
  Initial registration returned HTTP 201 and configuration version 1.
  Rejection preserved the existing registration and its history.
  A repeated protocol request returned the exact original response.
- demo-telemetry.txt: correlated Gateway and Registry request logs.
  Initial registration: Gateway 44.286 ms; Registry 36.779 ms.
  Registry time is included in Gateway time.
- registration-existing-agent.json: 100 measured requests after 5 warm-ups,
  concurrency 1, unique request keys, nearest-rank p95.
  Result: 43.536 ms. This measures existing-agent registration only.
  The measured commit is recorded in the JSON.
- environment.txt: environment snapshot for the earlier measurement.
  This is not a complete manifest for later builds.
- log-redaction.json: invalid-token and malformed-JSON rejection checks.
  Canary secrets from Authorization, body and query were absent from logs.
- smoke-token-expired.txt: retained failure before the token-refresh fix.
- smoke.txt: successful smoke run after the token-refresh fix.

## Incident and recovery

The Synthetic Agent Learner cached its token indefinitely.
After expiry, valid demonstrations failed with token_expired.
Commit 3c972f5 adds expiry-aware refresh.
Commit a9b7ff6 adds a regression test covering reuse, early refresh,
and replacement after expiry. The test passed with 1 pass and 0 failures.

## Current setup notes

The active Compose project is eduagentx-issue8.
Use docker compose -p eduagentx-issue8 for container operations.
The original project's volumes were preserved.
Fixed container names and host ports prevent simultaneous operation.

The local .env required auth settings from .env.example.
.env is currently tracked by the repository; local changes are excluded
from this work's commits. Never include keys or real credentials.

## Remaining acceptance work

- Extend redaction coverage to successful registration and dependency errors.
- Verify health and telemetry coverage of registration dependencies.
- Confirm required Sprint 1 tests and invariants from Issue 7.
- Consolidate evidence with exact build and contract versions.
- Provide reproducible setup/reset and recovery instructions.
- Implement a gate that fails on missing evidence or failed requirements.
- Record independent reproduction, backup ownership and review outcome.

## Review outcome

Pending. Passing smoke checks and the existing-agent latency measurement
do not establish completion of Issue 8 or approval of the Sprint 1 Gate.


## Local service test suite

- Evidence is stored under `tests/`.
- external-agent-protocol: 7/7 passed.
- agent-registry: 6/6 passed.
- api-gateway: 5/5 passed.
- assurance-console: 1/1 passed.
- synthetic-agent-learner: 10/10 passed.
- Total: 29/29 tests passed with 0 failures.
- The post-measurement smoke suite also passed.
- These local tests do not by themselves establish the remaining Issue 7
  PostgreSQL/Redis integration and telemetry acceptance requirements.

## New-agent registration measurement

- Evidence: registration-new-agent.json.
- Completed samples: 20/20.
- p95: 86.355 ms, nearest-rank method.
- Required floor: at most 3000 ms; passed.
- Separate target: at most 2000 ms; achieved.
- Concurrency: 1. No warm-up registrations.
- Each sample used a new authenticated client identity.
- Each identity returned 404 before registration, then 201 with version 1.
- Gateway was recreated per sample; Registry and database stayed running.
- Restart, token acquisition and precondition GET were excluded from timing.
- This is a 20-sample local estimate, not production-load evidence.
- An interrupted attempt was restarted as a new series after a computer shutdown.
  The completed report contains only the successful replacement series.
- smoke-after-measurement.txt confirms the standard smoke suite passed
  after restoring the original Gateway client settings.

Sprint Gate status remains pending.
