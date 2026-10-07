# Architecture

EduAgentX is a set of small Node.js services behind one API Gateway. Each
service owns its data. Services share code only through `packages/`.

```
Agent Learner ──HTTPS/JWT──▶ api-gateway ──HTTP──▶ agent-registry ──▶ PostgreSQL (agent_registry schema)
                                  ▲                     │
assurance-console ──admin JWT─────┘                     └── outbox ──▶ Redis Stream ──▶ inbox/projection
synthetic-agent-learner ──agent JWT──▶ api-gateway
Prometheus + blackbox-exporter ──▶ /health of every service ──▶ Grafana
```

## Repository layout

| Path | Contents |
|---|---|
| `services/<name>/` | One deployable service: `index.js` (startup), other modules, `test/`, `Dockerfile`, `package.json` |
| `packages/<name>/` | Shared, dependency-free libraries. A service imports them by relative path (`../../packages/telemetry`) |
| `db/init/` | PostgreSQL first-start scripts (roles and per-service schemas) |
| `monitoring/` | Prometheus, blackbox-exporter and Grafana configuration |
| `courses/` | Course, skill and exam content for later sprints |
| `scripts/` | Developer and CI tooling (setup, tests, Sprint gate) |
| `docs/` | Contracts, environment, sprint records, blueprint and reference PDFs |
| `evidence/` | Committed gate runs. Files under `evidence/runs/` are hashed; never edit them |

## Current services (Sprint 1 and Sprint 2)

| Service | Port | Responsibility |
|---|---|---|
| `api-gateway` | 4000 (host 8080) | Only public entry point. Issues RS256 JWTs, checks role and identity, validates the ExternalAgentLearner envelope, rate limits, forwards to owners |
| `agent-registry` | 4001 | Authoritative Agent Learner identities and configuration versions. Durable idempotency, append-only assurance events, outbox delivery |
| `curriculum-engine` | 4002 | Immutable Course Packages: candidate validation, content digests and lifecycle events (#9) |
| `curriculum-index` | 4003 | Rebuildable ChromaDB index of Active package content. Never the source of truth (#11) |
| `training-service` | 4004 | Event-sourced training sessions pinned to one Active package and configuration fingerprint (#12) |
| `validation-activation` | 4010 (host 127.0.0.1 only) | Package gates, review records and activation state (#10). In memory in Sprint 2 |
| `assurance-console` | 4100 (host 4173) | Read-only page that shows the latest registration trace |
| `synthetic-agent-learner` | 4200 | Deterministic test learner. Uses the public Gateway protocol like any external agent |

## Rules every service follows

1. **Agent traffic goes through the Gateway.** Only the Gateway exposes the
   `/v1` API. The Console and the Synthetic Agent Learner publish local
   demonstration pages. Every host port binds to `127.0.0.1` only.
2. **One schema per service.** Each service connects with its own restricted
   PostgreSQL role, which cannot write other schemas. See
   `db/init/002_registry_role.sh`.
3. **Logs go through `packages/telemetry`.** It writes allowlisted JSON fields
   only and carries the correlation ID. Never log an Error object, a request
   body, a header or a URL.
4. **Every request has a correlation ID** (`x-correlation-id`). Pass it on to
   every downstream call.
5. **Secrets come from the environment.** No fallback values in code. A
   missing secret must stop the service or make `/health` return 503.
6. **`/health` checks real dependencies** and returns 503 when one is down.
7. **Versioned contracts.** HTTP routes are under `/v1`; the agent protocol
   and events carry a version. See `docs/contracts/`.

## Adding a service (later sprints)

1. Create `services/<name>/` with `package.json` (include a lock file),
   `index.js` and `test/*.test.js`.
2. Copy an existing `Dockerfile`, change the service name and port. All images
   build from the repository root so they can copy `packages/`.
3. Add the service to `docker-compose.yml` with a healthcheck, a `127.0.0.1`
   port binding if needed, and resource limits.
4. If it stores data: add a role and schema script in `db/init/` and give the
   service only that role.
5. Add its `/health` target to `monitoring/prometheus.yml`.
6. Document its routes in `docs/contracts/` and any new variable in
   `.env.example` and `docs/environment.md`.

`make install`, `make test-unit` and the Sprint gate find the new component
automatically: any folder in `packages/` or `services/` with a `package.json`.
