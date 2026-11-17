# Console of record

Assurance audit E10 found two consoles: the Assurance Console (port 4173) and
the web console (port 4300). The web console is the console of record. The
Assurance Console stays in the Compose stack only because the Sprint 1 gate
scripts (`scripts/run-sprint1.py`, `scripts/smoke.sh`,
`scripts/wait-for-healthy.sh`) and the Prometheus and Grafana configuration
check it; it gains no new features. Retiring it means changing those gates,
which their owners must agree to.

## The spec's six areas in the web console

The spec (`docs/blueprint/spec.md`, "Monitoring, governance, and evidence")
asks for six primary areas.

| Area | Web console pages | Notes |
|---|---|---|
| Overview | Overview | Assurance posture, operational health and evaluation evidence as separate lenses. |
| Lifecycle | Lifecycle Lab | Seeded runs through the public APIs. |
| Governance | Governance, Curriculum | Package review: each claim's quote inside its stored source section, per-source checks, rubric scores signed with the reviewer's own credentials, disagreement resolution, activation. |
| Evidence | Evidence, Credentials, Verify | Evidence Bundles, issued credentials and their status, independent verification. |
| Operations | System, Attention | Service health; the Attention Queue of the one Assurance Incident log, and a Critical banner on every page while a critical incident is open. |
| Marketplace | Marketplace | Capability requests and match results. |

## What the Attention Queue does not yet show

The spec's Attention Record has severity, scope, detection time, evidence
freshness, reason, Safe State, owner, required action and an evidence link.
An Assurance Incident carries severity, scope (its subject), detection time,
reason (its summary and detail), its handling history, and, where the
writer states them, Safe State, required action and owner. It has no
evidence link or evidence freshness, and the queue does not deduplicate
across sources beyond one incident per source and source id. When the
incident log cannot be read, every page says the critical state is UNKNOWN
instead of showing nothing.
