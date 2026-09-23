# Issue 4 handoff: Agent Registry

## What was delivered

- Agent Registry v1 stores Agent Learner identity and immutable configuration history in PostgreSQL.
- Configuration is normalized and fingerprinted by the registry; repeated registrations are idempotent.
- Assurance events are published to Redis with correlation IDs and configuration evidence.
- The API Gateway provides JWT authentication, agent/admin role checks, ownership checks, correlation propagation, and the public `/v1` routes.
- The Assurance Console displays the latest registration trace as read-only evidence.

Implementation commits: `c055253` and `b477a86`.

## Run locally

Use Git Bash from the repository root with Docker Desktop running in Linux-container mode:

```bash
[ -f .env ] || cp .env.example .env
./scripts/generate-dev-keys.sh
docker compose --env-file .env up -d --build
./scripts/wait-for-healthy.sh
```

Check status with:

```bash
docker compose --env-file .env ps
```

The gateway is normally at `http://localhost:8080` and the console at `http://localhost:4173`.

## Test

Run the service tests from the repository root:

```bash
(cd services/agent-registry && npm install --no-package-lock && npm test)
(cd services/assurance-console && npm install --no-package-lock && npm test)
(cd services/api-gateway && node --test)
./scripts/smoke.sh
```

The API Gateway currently has no unit-test files. The smoke test covers health, JWT roles, registration, idempotent retry, retrieval, assurance trace, correlation IDs, and console rendering.

Known test-harness issue: the smoke script currently captures both the nested assurance `correlationId` and the top-level response `correlationId` at step 4. Both values are correct, but the unmodified script compares them as one multiline value. Add `head -n 1` before its `cut` command, or fix the extraction before relying on the script's exit code.

To stop the stack without deleting local data:

```bash
docker compose --env-file .env down
```

`.env`, `keys/`, and `.impeccable/` are local-only and ignored by Git.
