# EduAgentX

EduAgentX is a competency-assurance platform for software agents. An Agent
Learner registers, studies a curriculum, takes an exam, and receives evidence
of its competence. The glossary is in [CONTEXT.md](CONTEXT.md).

Sprint 1 delivers the walking skeleton: an authenticated API Gateway, the
Agent Registry, the provider-neutral `ExternalAgentLearner` protocol, a
deterministic Synthetic Agent Learner, a read-only Assurance Console, and
monitoring.

## Quick start

Needs Docker with Compose v2, Node 24 and Python 3.9 or later.

```bash
make up        # create .env and keys if missing, build, start, wait for health
make smoke     # end-to-end check through the Gateway
make down      # stop (data stays); make reset deletes data
```

Without `make`, run the same commands that the [Makefile](Makefile) lists.

On Windows, double-click `EduAgentX-Start.bat` for a demo. It starts Docker
Desktop if needed, creates `.env` and keys if missing, starts the stack as
Compose project `eduagentx-poc`, waits for health and opens the web app. Add
`rebuild` to rebuild the images first. `EduAgentX-Stop.bat` stops the stack and
keeps the data.

To drive one Agent Learner through the whole lifecycle (package, training,
examination, credential, verification, status change, monitoring) from the
command line, run `node scripts/poc-lifecycle.js [scenario]`. The report is
written to `artifacts/poc/lifecycle-run.json`. The web app's Lifecycle Lab
runs the same driver live.

| URL | What |
|---|---|
| http://localhost:4300 | EduAgentX web app: overview, Lifecycle Lab, credentials, verifier |
| http://localhost:8080 | API Gateway |
| http://localhost:4173 | Assurance Console |
| http://localhost:4200 | Synthetic Agent Learner |

## Tests

```bash
make install     # npm ci for every package and service
make test-unit   # component tests, no Docker needed
make test        # full Sprint 1 gate in an isolated Compose project
```

CI runs `python3 scripts/run-sprint1.py --technical-only` on every pull
request. See the [Sprint 1 runbook](docs/sprint-1/runbook.md) for what the gate
checks and how to read its result.

## Repository layout

```
services/   one folder per deployable service
packages/   shared libraries (telemetry, external-agent-protocol)
db/init/    PostgreSQL roles and schemas
monitoring/ Prometheus, blackbox-exporter, Grafana
courses/    course content for later sprints
scripts/    setup, test and gate tooling
docs/       contracts, environment, sprint records, blueprint
evidence/   committed gate runs (do not edit)
```

## Documentation

- [Architecture and how to add a service](docs/architecture.md)
- [Environment variables](docs/environment.md)
- [API overview](docs/contracts/api-overview.md),
  [Agent Registry contract](docs/contracts/agent-registry.md),
  [ExternalAgentLearner protocol](docs/contracts/external-agent-learner-protocol.md)
- [Sprint 1 records](docs/sprint-1/): runbook, KPIs, minutes, handoffs, reviews
- [Five-sprint blueprint](docs/blueprint/spec.md)
- [Evidence review summary](evidence/review-summary.md)
