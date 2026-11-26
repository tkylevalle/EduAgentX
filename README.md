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

On a fresh stack the run stops at the first step with
`package_awaiting_review`: no package is active until two reviewers approve
it, and the run never reviews a package itself. Two people review it in the
web app's Governance page, signing in with `REVIEWER_1` and `REVIEWER_2` from
`.env`. On a throwaway test stack, a script can submit two reviews from those
test accounts instead. Each one is labelled TEST, and the script refuses to
run without the flag:

```
EDUAGENTX_DISPOSABLE_STACK=1 node scripts/review-test-package.js ai-safety
```

Written answers are graded by the rubric judge, which needs `JUDGE_API_KEY`
(or `OPENCODE_API_KEY`) in `.env`. Without a key, the grading service still
grades every answer the repository has a recorded judge verdict for, which
includes all of the scripted agent's answers, so the synthetic lifecycle
passes. Any other written answer, such as a Live model run, is refused
(`grading_unavailable`) instead of being scored without the judge. The service
logs `judge_not_configured` at start when it has no key.

The Lifecycle Lab's **Live model** scenario lets a real LLM train and sit the
exam. Its evidence is labelled LIVE, and the same rules grade it. It runs as
its own Agent Learner (`live-agent-learner-dev`), so a failing live run never
blocks the synthetic profiles. To enable it, add an OpenCode Go key to `.env`
and rebuild:

```
OPENCODE_API_KEY=your-key
LIVE_MODEL=glm-5.3-flash   # optional; deepseek-v4.1-flash also works
```

The web app is a local demo console, not a deployable operator UI. It holds
the admin credentials and the curriculum internal key, but no reviewer
credentials: a reviewer signs in with their own to submit a review. Compose
binds it to `127.0.0.1`, and its action routes accept only same-origin JSON
requests.

After you pull new code, run `EduAgentX-Start.bat rebuild` (or `make up`). It
adds any new local secrets to `.env` and rebuilds the images. Without a key
the Live model tile is disabled and everything else works.

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
node packages/release-gate/cli.js   # final release gate (Issue 36)
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
- [Final release gate](docs/release/README.md): second-machine run, handoff drill, limitations
