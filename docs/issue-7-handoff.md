# Sprint 1 Automated Security and Integration Test Handoff

## Purpose

This work package establishes one repeatable Sprint 1 gate for the public Agent Learner registration path. It combines unit, contract, security, Docker Compose integration, dependency-failure, Redis Stream, and latency checks and writes machine-readable evidence for the Sprint Evidence Pack.

## Commands

Install local test dependencies once:

```bash
make install-test-deps
```

Run host-based unit, contract, and security tests without Docker:

```bash
make test-unit
```

Run the complete clean-state Sprint 1 gate:

```bash
make test
```

`make test` deletes only the Compose volumes belonging to this project so the gate starts from a known empty state. Set `KEEP_STACK=1` when debugging if the containers should remain running after the suite.

## Coverage

The gate verifies:

- Agent Registry domain and HTTP contracts, stable fingerprints, material configuration changes, safe validation, retrieval, and assurance traces.
- External Agent Learner envelope validation and provider-neutral conformance.
- JWT signature, expiry, issuer, audience, algorithm, and role enforcement.
- Invalid credentials, malformed JSON, oversized payloads, identity mismatch, unsupported versions, timeouts, and idempotency conflicts.
- Private lifecycle responses and credentials are not echoed in public results.
- Public registration, safe rejection, exact idempotent replay, correlated assurance evidence, console read-only behavior, and Synthetic Agent Learner evidence labels.
- PostgreSQL and Redis outages make Gateway health fail closed and recover after the dependency returns.
- Agent Registry events are present in the durable Redis Stream.
- Registration p95 latency is measured against the 3,000 ms Acceptance Floor and 2,000 ms Initial Target.

## Evidence

Generated files are written beneath `artifacts/sprint1/` and uploaded by GitHub Actions:

- `unit-tests.json`
- `security-integration.json`
- `registration-latency.json`
- `failure-recovery.json`
- `gate-summary.json`
- `compose.log` when a Compose-stage failure occurs

Generated evidence and local keys are intentionally gitignored. The Sprint Evidence Pack should retain the CI artifact together with the commit SHA and workflow run identity.

## Security correction

The Agent Registry health check now executes a Redis `PING` rather than relying only on a flag showing that Redis connected at some earlier time. This makes a Redis outage visible to Gateway health and permits deterministic failure/recovery evidence.

The repository no longer tracks `.env`. Local development uses `.env.example`, and `make up` or the test workflow creates the local `.env` copy. Real credentials and private signing keys must never be committed.

## Limitations

- Sprint 1 has a producer-only Redis Streams baseline. Consumer groups, poison-event quarantine, and downstream replay belong to later event-consuming services.
- The registration latency runner measures sequential writes through the public Gateway on the current Compose host. Results must be interpreted with its recorded environment and must not be presented as production capacity.
- Local success is not a substitute for the required independent backup-member and second-machine run.

## Backup verification

The Capability Backup should start from a fresh checkout and run:

```bash
make install-test-deps
make test
```

The backup should attach the resulting `artifacts/sprint1/` directory to the Sprint Evidence Pack and record any environment-specific deviation.
