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
| `GATEWAY_TEST_TOKEN` | Shared token for Sprint 1 smoke tests only — replaced by real auth in Sprint 2 | `sprint1-dev-token-changeme` |

---

## Console

| Variable | Description | Default |
|----------|-------------|---------|
| `CONSOLE_PORT` | Host port for the assurance console UI | `4173` |

---

## Agent Config

| Variable | Description | Default |
|----------|-------------|---------|
| `EXAM_PASS_THRESHOLD` | Minimum score (0.0–1.0) for an agent to pass an exam | `0.70` |
| `MAX_RETRY_ATTEMPTS` | How many times Hermes can retry a failed exam before being flagged | `3` |

---

## General

| Variable | Description | Default |
|----------|-------------|---------|
| `ENV` | Runtime environment (`development` / `production`) | `development` |
| `LOG_LEVEL` | Log verbosity (`debug` / `info` / `warn` / `error`) | `info` |

---

## Docker Resource Limits (set in docker-compose.yml)

These are not environment variables — they live inside `docker-compose.yml` under each service's `deploy.resources` block. They prevent any single container from starving the others on a developer laptop.

| Service | CPU Limit | Memory Limit |
|---------|-----------|--------------|
| `postgres` | 1.0 core | 512 MB |
| `redis` | 0.5 core | 128 MB |
| `agent-registry` | 0.5 core | 256 MB |
| `api-gateway` | 0.5 core | 256 MB |
| `assurance-console` | 0.5 core | 256 MB |

> **Note:** `deploy.resources` limits apply when running with `docker compose up` (Compose v2). They are ignored by `docker-compose` v1.
