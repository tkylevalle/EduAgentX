# Environment variables

`make up` runs `scripts/setup-dev.js`. It copies `.env.example` to `.env`,
fills every empty secret with a random value, and creates local JWT signing
keys in `keys/`. It never replaces a value you set yourself.

`.env` and `keys/` are gitignored. Never commit them. `.env.example` is the
only tracked template; keep this page and that file in step.

The isolated gate (`python3 scripts/run-sprint1.py`) does not read `.env`. It
generates its own secrets for each run.

## Set in `.env`

| Variable | Used by | Purpose | Default in `.env.example` |
|---|---|---|---|
| `POSTGRES_USER` | postgres | Database superuser (setup only) | `eduagentx_dev` |
| `POSTGRES_PASSWORD` | postgres | Superuser password | generated |
| `REGISTRY_DB_PASSWORD` | postgres, agent-registry | Password of the restricted `registry_owner` role | generated |
| `POSTGRES_DB` | postgres, agent-registry | Database name | `eduagentx` |
| `POSTGRES_PORT` | host | Host port for PostgreSQL (127.0.0.1 only) | `5432` |
| `REDIS_PORT` | host | Host port for Redis (127.0.0.1 only) | `6379` |
| `GATEWAY_PORT` | host | Host port for the API Gateway | `8080` |
| `SYNTHETIC_AGENT_PORT` | host | Host port for the Synthetic Agent Learner | `4200` |
| `CONSOLE_PORT` | host | Host port for the Assurance Console | `4173` |
| `JWT_ISSUER` | api-gateway | `iss` claim of issued tokens | `eduagentx-api-gateway` |
| `JWT_AUDIENCE` | api-gateway | `aud` claim of issued tokens | `eduagentx-platform` |
| `JWT_ACCESS_TOKEN_TTL_SECONDS` | api-gateway | Token lifetime | `900` |
| `JWT_PRIVATE_KEY_PATH` | api-gateway | RS256 signing key inside the container | `/app/keys/dev-jwt-private.pem` |
| `JWT_PUBLIC_KEY_PATH` | api-gateway | RS256 verification key inside the container | `/app/keys/dev-jwt-public.pem` |
| `AGENT_CLIENT_ID` | api-gateway, synthetic-agent-learner | Client ID that receives the `agent` role | `synthetic-agent-learner-dev` |
| `AGENT_CLIENT_SECRET` | api-gateway, synthetic-agent-learner | Secret for that client | generated |
| `ADMIN_CLIENT_ID` | api-gateway, assurance-console | Client ID that receives the `admin` role | `capstone-admin-dev` |
| `ADMIN_CLIENT_SECRET` | api-gateway, assurance-console | Secret for that client | generated |
| `GRAFANA_ADMIN_PASSWORD` | grafana | Grafana `admin` password | generated |

There are no fallback passwords in the code. The Assurance Console and the
Synthetic Agent Learner exit at startup when their secret is missing. The API
Gateway starts, but it ignores a client whose ID or secret is empty and its
`/health` returns 503 until both clients are configured.

## Set by `docker-compose.yml`

These are fixed per service and normally need no change.

| Variable | Service | Value |
|---|---|---|
| `PORT` | each service | Container port (4000 gateway, 4001 registry, 4100 console, 4200 learner) |
| `SERVICE_NAME` | each service | Name written in every log record |
| `DATABASE_URL` | agent-registry | Connection as `registry_owner` |
| `REDIS_URL` | agent-registry | `redis://redis:6379` |
| `AGENT_REGISTRY_URL` | api-gateway | `http://agent-registry:4001` |
| `API_GATEWAY_URL` | console, learner | `http://api-gateway:4000` |

## Optional

| Variable | Service | Purpose | Default |
|---|---|---|---|
| `AGENT_REGISTRY_EVENT_STREAM` | agent-registry | Redis Stream name for assurance events | `agent-registry.assurance` |
| `REGISTRY_CONSUMER_ENABLED` | agent-registry | `false` pauses the stream consumer (used by the gate's recovery test) | `true` |

## Read by scripts

| Variable | Script | Purpose | Default |
|---|---|---|---|
| `GATEWAY_BASE_URL` | `scripts/security-integration.js` | Gateway to test | `http://127.0.0.1:$GATEWAY_PORT` |
| `SPRINT1_RESULTS_DIR` | `scripts/run-unit-tests.js` | Where `unit-tests.json` is written | `artifacts/sprint1` |
