# Sprint 1 / Issue 8: reproducible evidence run

Contributor: Timurmalik Djuraev.
Initial capability Primary: Salman Akram; Secondary: Raniya Habachi (Issue 8).
These are the issue's published roles, not a claim that a handoff or review occurred.
Issue 7 testing owner: Luis Vargas; Secondary: Salman Akram.
Review outcome: PENDING. Independent reproduction and backup handoff: NOT RECORDED.

## One command

From the repository root, with Docker Engine running, Compose v2, Node >=20,
npm, Python >=3.9 and OpenSSL installed:

```sh
python3 scripts/run-sprint1.py
```

Port 18080 must be free; use `--port 18081` if needed. This needs image/package
network access. The runner generates local development keys if missing, installs
service dependencies without changing lock files, runs component tests, builds a
fresh isolated Compose project and measures 20 new registrations. It may take
several minutes because the Gateway is recreated for each authenticated identity.
No existing Compose project's database is reset. `.env.example` supplies local
simulation defaults; `.env` is not read or changed by the runner.

The runner removes fixed container names and original published ports from the
resolved configuration. It creates fresh project-scoped PostgreSQL/Redis volumes,
publishes only Gateway on localhost, and deletes its own containers/volumes in
`finally`. It does not depend on fixed-name `wait-for-healthy.sh`.

## Output and interpretation

Each invocation creates `evidence/runs/eduagentx-evidence-<UTC timestamp>-<pid>/`:

- `run.json`: source SHA-256, Git commit if available, tool/runtime and installed
  dependency versions, container image information, measured samples, p95, separate
  <=2000 ms target, required check results and evidence-file checksums.
- `gate.json`: `FAIL`, `BLOCKED` or `PASS`, with concrete reasons.
- `*-tests.tap`: five component-test suites; missing summaries, failures, skipped,
  cancelled or TODO tests fail the run.
- `gate-unit-tests.txt`: negative readiness-check tests.
- `first-registration.json` and `demonstration.json`: real public responses and
  assertions for creation, exact retry and safe rejection.
- `telemetry.jsonl`: allowlisted JSON service/dependency records after canary checks.
- `images.json` and `compose-build.txt`: actual container build evidence.

Exit 1 / FAIL means a mandatory measured check failed or evidence is incomplete.
Exit 2 / BLOCKED means the run's technical checks passed but required Issue 7 or
review evidence is absent. Exit 0 / PASS requires all checks and matching external
attestations. BLOCKED must not be relabelled as accepted to satisfy a deadline.
The earlier `check-sprint-evidence.py` remains a historical partial-report checker.

The source hash covers services, scripts, database initialization, docs/contracts,
Compose, Makefile and `.env.example`, excluding generated keys/dependencies/cache.
Old `evidence/sprint-1` measurements remain historical; they do not prove this build.

## Demonstration and measurements

The real Gateway verifies authentication and identity. Each sample uses a new
configured test client, a precondition GET returning 404, and a registration
returning 201 / version 1 / a distinct Agent Learner ID / published assurance.
For the first client, invalid protocol before creation leaves GET at 404; exact
retry preserves both the original response and authoritative registration/history;
invalid payload after creation leaves authoritative state unchanged. Registry
restart preserves the registration and history.

Twenty samples, concurrency 1, no warm-up registrations. Timing starts at the
client request and ends after full response parsing. Token exchange, precondition
GET and Gateway recreation are excluded. Nearest-rank p95 is independently checked
against 3000 ms; the 2000 ms target is separate. This is local simulation with
Gateway recreation between samples, not a production load or concurrency claim.
The normal runner cannot use fewer than 20 samples.

The runner stops Redis and PostgreSQL separately in its isolated project, expects
public health 503, checks a failed registration during PostgreSQL outage, restores
the dependency, and requires health 200. An unavailable database must never yield
a success response. It does not claim durable stream recovery is implemented.

## Telemetry and redaction

Gateway and Registry log JSON HTTP completion/abort records with route templates,
method, status, duration and correlation. Registry also records PostgreSQL and
Redis operation timings and outcomes. SQL text, request bodies, query strings,
Authorization headers, credentials and raw Error objects are excluded by an
allowlist. Health probes issue a real PostgreSQL query and Redis PING with bounds;
Gateway health also checks its signing/verifying keys and both configured roles.

Correlation IDs must be non-secret opaque identifiers. IDs outside the supported
safe character/length policy are logged as SHA-256; this is not a DLP filter for
secrets deliberately placed in a valid correlation ID. API correlation values
remain unchanged. Registry duration is included in Gateway duration; do not sum.
Gateway containers are replaced during measurement, so final telemetry includes
the last Gateway sample and Registry history, not every earlier Gateway container.

Canary checks cover successful registration, invalid token, malformed JSON and
observed dependency-failure logs. Raw exception serialization is also checked by
component tests. This does not establish coverage of every possible third-party
log, reverse proxy or future application field.

## Failure and recovery

- Expired learner JWTs: expiry-aware refresh and its regression test are retained.
- PostgreSQL down: pool connection/query limits bound errors; an idle-pool error
  handler prevents an unhandled error from terminating the Registry. Restore the
  dependency, wait for health, then retry with the intended request identity.
- Redis down: readiness becomes unhealthy. Publication failures remain `pending`;
  the existing code has no implemented replay worker. Do not claim durable delivery.
- Ctrl-C: the runner attempts to delete only its temporary project.
- Power loss/kill -9: cleanup cannot run. Find the exact project name in `run.json`
  if saved, the `evidence/runs/` directory or `docker compose ls -a`. Never use a
  broad system prune. Inspect only that project's resources before removing them.

Example recovery for a confirmed interrupted **evidence** project:

```sh
# Replace only with the exact eduagentx-evidence-... project from your run.
project='eduagentx-evidence-REPLACE-ME'
docker ps -a --filter "label=com.docker.compose.project=$project"
docker volume ls --filter "label=com.docker.compose.project=$project"
# Remove only resources printed for this disposable test project.
docker ps -aq --filter "label=com.docker.compose.project=$project" | xargs -r docker rm -f
docker volume ls -q --filter "label=com.docker.compose.project=$project" | xargs -r docker volume rm
docker network ls -q --filter "label=com.docker.compose.project=$project" | xargs -r docker network rm
```

Rerun the one command to start a fresh series; never combine interrupted and
replacement samples. Normal project recovery remains `docker compose -p
eduagentx-issue8 up -d` and its normal health check. The isolated runner does not
need to stop that project, subject to available RAM/CPU.

## Required external acceptance

Issue 8 is blocked by Issue 7, which depends on persistence/transport work in #6.
The supplied baseline still has in-memory Gateway protocol idempotency, no Redis
consumer-group recovery/poison-event pipeline, and no demonstrated service-owned
DB permission isolation. This package does not implement those other work packages.
Their owners must provide actual integration evidence, not guessed PASS flags.

Copy the JSON shapes from `review-records.md` into files under `evidence/reviews/`
only when their checks have really been completed. References must identify the
actual test artifacts / reviewed commits. Source hashes must match `run.json`.
The records are trusted human attestations, not cryptographic verification of
remote evidence or reviewer identities.

Reevaluate a saved run without rerunning measurements:

```sh
python3 scripts/sprint1_gate.py evidence/runs/YOUR-RUN/run.json \
  --prerequisites evidence/reviews/issue7.json \
  --review evidence/reviews/independent-review.json
```

This verifies saved artifact checksums and returns nonzero if files are missing or
changed, any required check/measurement failed, or external acceptance is missing.
Retain the resulting review outcome with the PR. For changed source or runtime,
create a new run; do not reuse an earlier approval.
