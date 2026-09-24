# EduAgentX — Environment Variables Reference

All variables live in `.env` at the project root.
**Never commit `.env` to GitHub — it is gitignored.**
Use `.env.example` as the template when setting up a new local environment.

---

## PostgreSQL

| Variable | Description | Default |
|----------|-------------|---------|
| `POSTGRES_USER` | Database login username | `eduagentx_dev` |
| `POSTGRES_PASSWORD` | Database login password — **change this** | `changeme_local_only` |
| `POSTGRES_DB` | Database name | `eduagentx` |
| `POSTGRES_PORT` | Host port mapped to the postgres container | `5432` |

---

## Redis

| Variable | Description | Default |
|----------|-------------|---------|
| `REDIS_PORT` | Host port mapped to the Redis container | `6379` |

---

## API Gateway

| Variable | Description | Default |
|----------|-------------|---------|
| `GATEWAY_PORT` | Host port exposed to the browser/client | `8080` |
| `JWT_ISSUER` | Required issuer for signed access tokens | `eduagentx-api-gateway` |
| `JWT_AUDIENCE` | Required audience for signed access tokens | `eduagentx-platform` |
| `JWT_ACCESS_TOKEN_TTL_SECONDS` | Lifetime of a local access token | `900` |
| `HEALTH_DEPENDENCY_TIMEOUT_MS` | Maximum wait for Registry health before the Gateway fails closed | `1500` |
| `JWT_PRIVATE_KEY_PATH` | Container path to the local-only signing key | `/app/keys/dev-jwt-private.pem` |
| `JWT_PUBLIC_KEY_PATH` | Container path to the local-only verification key | `/app/keys/dev-jwt-public.pem` |
| `AGENT_CLIENT_ID` | Local Synthetic Agent Learner client identity | `synthetic-agent-learner-dev` |
| `AGENT_CLIENT_SECRET` | Local-only agent client secret; change outside isolated development | `changeme_local_only_agent_secret` |
| `ADMIN_CLIENT_ID` | Local Assurance Console client identity | `capstone-admin-dev` |
| `ADMIN_CLIENT_SECRET` | Local-only admin client secret; change outside isolated development | `changeme_local_only_admin_secret` |

---

## Console

| Variable | Description | Default |
|----------|-------------|---------|
| `CONSOLE_PORT` | Host port for the assurance console UI | `4173` |

## Synthetic Agent Learner

| Variable | Description | Default |
|----------|-------------|---------|
| `SYNTHETIC_AGENT_PORT` | Host port for deterministic Synthetic Agent Learner runs | `4200` |

---

## Docker Resource Limits (set in docker-compose.yml)

These are not environment variables — they live inside `docker-compose.yml` under each service's `deploy.resources` block. They prevent any single container from starving the others on a developer laptop.

| Service | CPU Limit | Memory Limit |
|---------|-----------|--------------|
| `postgres` | 1.0 core | 512 MB |
| `redis` | 0.5 core | 128 MB |
| `agent-registry` | 0.5 core | 256 MB |
| `api-gateway` | 0.5 core | 256 MB |
| `synthetic-agent-learner` | 0.5 core | 256 MB |
| `assurance-console` | 0.5 core | 256 MB |

> **Note:** `deploy.resources` limits apply when running with `docker compose up` (Compose v2). They are ignored by `docker-compose` v1.
