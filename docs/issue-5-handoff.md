# Issue 5 handoff: External Agent Learner Protocol

## What was delivered

- `ExternalAgentLearner` protocol v1.0.0 with a shared registration/lifecycle envelope.
- Required timeout, payload, message, idempotency, authentication, correlation, and evidence-mode fields.
- Provider-neutral validation with no model/provider allowlist.
- Authenticated Gateway routes for protocol discovery, registration, and lifecycle interactions.
- Deterministic Synthetic Agent Learner service using only the Gateway public boundary.
- Explicit simulation labels and fail-closed outcomes for malformed, inconsistent, timing-out, and unavailable profiles.
- Reusable protocol conformance helpers and Gateway/service black-box tests.

## Run locally

Use the Issue 4 Compose setup from the repository root:

```bash
[ -f .env ] || cp .env.example .env
./scripts/generate-dev-keys.sh
docker compose --env-file .env up -d --build
./scripts/wait-for-healthy.sh
```

The Synthetic Agent Learner is available locally at `http://localhost:4200`.
Run a deterministic simulation through the real Gateway with:

```bash
curl -s -X POST http://localhost:4200/v1/runs \
  -H 'content-type: application/json' \
  -H 'x-correlation-id: synthetic-demo-1' \
  -d '{"profileId":"competent","agentLearnerKey":"synthetic-agent-learner-dev"}'
```

The response is labelled `SIMULATION: Synthetic Agent Learner`. Try
`malformed`, `inconsistent`, `timing-out`, or `unavailable` to see the safe
failure outcomes. None can issue a credential.

## Test

```bash
(cd services/external-agent-protocol && npm test)
(cd services/synthetic-agent-learner && npm install --no-package-lock && npm test)
(cd services/api-gateway && npm test)
```

The protocol conformance suite is deliberately transport-shaped so Replay and
future live adapters can reuse it. The lifecycle route currently proves the
authenticated gateway boundary and returns `safeState: awaiting_lifecycle_owner`
until the curriculum/training owner is delivered by the next work package.
