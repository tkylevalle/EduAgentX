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

- Measure new-agent registration p95 under a documented repeatable workload.
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
