Related to #8. Sprint Gate approval remains pending.

Registration request logs did not establish current dependency health, safely
cover dependency exceptions, or provide a reproducible complete evidence run.
This change adds live PostgreSQL/Redis probes, bounded dependency operations,
allowlisted JSON telemetry, and dependency/health/redaction regression tests.

`python3 scripts/run-sprint1.py` provisions an isolated Compose project, runs the
component suites, demonstrates creation/rejection/retry and restart persistence,
measures new-agent registration p95, injects dependency outages and checks log
canaries. It records source/runtime/image versions and removes its own test data.
The gate fails on missing/changed artifacts, failed required checks, incomplete
measurements or p95 above 3000 ms. The 2000 ms target is reported separately.

Local validation: 35 service tests and five gate tests passed. Docker execution
and independent reproduction must be recorded from the target environment.
Existing evidence is retained as historical and not attributed to this build.

The full gate remains blocked without Issue 7/persistence acceptance and actual
independent review/backup handoff. In-memory idempotency and missing stream
consumer recovery are documented, not claimed as solved by observability work.
