# Sprint 2 implementation status (2026-10-11)

Branch: `sprint2/integrated-curriculum-training-evidence`, based on `origin/main` at `e80a487`. No push, PR, or merge was performed. This is a technical implementation, **not a formal Sprint 2 exit**.

| Requirement | Implemented and verified | Formal status |
|---|---|---|
| Five-module package and six gates | Canonical Candidate passes six gates; examination policy is 15 slots, 5/6/4 tiers, 20/40/40 weights, 80/70 thresholds, critical fail. Source claims and fallback item links are measured. | Package edition remains `0.1.5-draft`; independent factual/content review missing. |
| Independent review and activation | Gateway derives reviewer identity from JWT, downstream binds reviews to exact version/digest, excludes author, requires two distinct approvals with 3.5 mean floor; PostgreSQL advisory-lock transaction supersedes and activates by domain. Local live smoke uses explicitly simulated identities. | Real independent human approvals and third security-critical review missing. |
| Curriculum-to-Training path | Training reads exact version with service key, honors pinned track order, checks version/digest, and synthetic driver walks ten lesson/practice items through Gateway, interrupting and resuming. | One live learner demonstrated. Controlled 36-scenario KPI uses fake Package/Registry sources and memory store. |
| Quality | Mechanical traceability 20/20 and objective coverage 5/5 on Candidate; controlled expected completion 36/36 (25/25 completable) and invariants zero. | Known critical factual error count is **unknown**, not zero. Reviewer mean in live smoke is simulation only. |
| Dependency loss | Index verifies live document bytes against PostgreSQL-derived chunks; persistent integrity-checked cache serves labelled stale results during Chroma loss, filters quarantine, and fails closed on PostgreSQL loss. Fallback refuses quarantined scope and scored attempts are unique. | Redis outbox loss/recovery has unit coverage but was not exercised in this pack's live smoke; logical three-attempt incident escalation remains to be implemented. |
| Reproducible pack | `evidence/sprint-2/pack-technical-2026-10-11` includes manifest hashes, test/KPI results, sanitized live observations, config and commands. Technical verifier passes. | Strict verifier intentionally exits nonzero pending human review and cumulative Sprint 1 prerequisites. |

## Tests actually run

- `node scripts/run-unit-tests.js`: 183/183 passed, after extending the Gateway timeout test beyond Windows scheduling jitter.
- `python -m unittest discover -s scripts -p test_sprint1_gate.py`: 6/6 passed.
- `node services/training-service/kpi/measure.js --write`: Green, exact outcomes 36/36, completable 25/25, all five invariant counters zero. This is controlled/in-memory evidence, not a production deployment claim.
- `node scripts/run-sprint2-live.js`: `technical_pass` in isolated Compose with real PostgreSQL, Chroma, Registry, Gateway, Training and synthetic learner. It stopped and restored Chroma and PostgreSQL. See the sealed live report for all steps.
- `node scripts/verify-sprint2-pack.js evidence/sprint-2/pack-technical-2026-10-11 --technical-only`: exit 0.
- The same verifier without `--technical-only`: exit 1, `BLOCKED_HUMAN_REVIEW` as intended.

## Remaining blockers and decisions

1. Two genuine independent reviewers must inspect the official source snapshots, lesson claims, assessment links, safety rules, and rubric, then approve through their own provisioned Gateway identities. Record the reviewer process selected by the seven-member team. Do not promote simulated reviews into formal approval.
2. An independent reviewer must verify zero known critical factual errors and trust-critical changes. Reconcile historical Sprint 1 waivers (independent reproduction, backup, trust review) before declaring the cumulative Sprint 2 exit.
3. The validation facade and Curriculum Engine still share the `curriculum_owner` database role and write the same schema. This is no longer a superuser dependency, but service write ownership should be formalized before wider deployment.
4. Source change evidence is operator-supplied in this prototype. A corrected source cannot activate until the official baseline is independently updated and a new Candidate is validated and human reviewed. Offline source-loss acquisition and licence/edition review were not independently verified.
5. Redis relay is at-least-once and safely queues completion events while disconnected, but the planned bounded three-attempt incident/exhaustion policy is not implemented. Add durable attempt accounting if the team confirms this requirement for Sprint 2 exit.
6. Live demonstrations use local synthetic credentials and draft content. The standard Examination/Grading Engine, actual generated forms, and certification decisions are Sprint 3/4 scope, not claimed here.

## Reproduction and safety

Read the Evidence Pack README before rerunning. The live script operates only on a dedicated Compose stack, temporarily stopping and restarting `eduagentx-chromadb` and `eduagentx-postgres`; it creates new simulation Candidates and sessions. It does not delete volumes. Keep `.env` and `keys/` local, never commit them, and provision separate reviewer credentials for genuine review. `docker compose ps` and `/health` should be checked after fault tests to confirm recovery.
