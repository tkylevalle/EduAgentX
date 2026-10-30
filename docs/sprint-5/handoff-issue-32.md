# Issue 32: Skill Gap remediation handoff

Primary: Luis Vargas. Backup: Neeraj Santosh.
Base: main b700f029da3eff3234276031edc63d46ae739348, refreshed 30 October 2026.
Local branch: feat/issue-32-skill-gap-remediation.

## What this does

An admin selects an existing failed examination or Marketplace Near Match. Skill Gap loads the owning service's evidence and creates a versioned recommendation identifying exact objective gaps and their source. A separate admin handoff assigns targeted practice through Training. Examination recommendations observe the existing relay's assignment, preserving its request ID and preventing duplicate sessions.

The new service owns recommendations and delivery history in PostgreSQL. It cannot change exam results, credentials, certification decisions, matches or request thresholds. It cannot start a learner or re-examination. Score, credential-age and assessment-mode gaps remain explicit actions without invented training objectives. Source outages never fabricate a recommendation; ambiguous Training replies remain pending and retry safely with the same request ID.

Read [the contract](../contracts/skill-gap.md) for exact routes, schema/version rules, authorization, persistence and retry semantics. The service uses the existing Express/pg dependencies and maintained Node crypto hashing; it adds no AI provider dependency.

## Changed components

- `services/skill-gap-service`: pure recommendation policy, bounded HTTP adapters, authenticated service, PostgreSQL store/schema, unit/failure/public-contract tests and real database integration suite.
- `services/api-gateway/index.js`: admin-only recommendation create/read and explicit Training handoff.
- `services/examination-engine/remediation-routes.js`: answer-free pinned template/rubric references in the existing remediation trace.
- `db/init/008_skill_gap_role.sh`, Compose, setup-dev and technical-runner secrets: restricted service role and internal-only service wiring, including existing-volume role initialization.
- `scripts/verify-issue-32.js`: actual TAP logs, counts, runtime/source provenance and a machine-readable verification report.

## Reproduce focused verification

Use Node 24 and run from the repository root. Install every component before tests when using the normal project installer. For this focused slice, these are the required service dependencies:

```powershell
foreach ($component in @('skill-gap-service','api-gateway','training-service','examination-engine','marketplace-service','grading-service')) {
  npm ci --ignore-scripts --no-audit --prefix "services/$component"
  if ($LASTEXITCODE -ne 0) { throw "Install failed: $component" }
}
node scripts/generate-test-keys.js
node scripts/verify-issue-32.js
```

Without `SKILL_GAP_TEST_DATABASE_URL`, the report explicitly marks PostgreSQL NOT_RUN and overall focused verification PARTIAL. PostgreSQL integration needs an empty disposable database and an administrative test connection to create a restricted test role/schema. Never use a shared project database: immutable test rows intentionally cannot be removed in place.

With Docker running, this creates a fresh, isolated test database bound only to localhost. The password below is disposable fixture configuration:

```powershell
docker run -d --name eduagentx-issue32-test -p 127.0.0.1::5432 -e POSTGRES_PASSWORD=issue32-disposable-only -e POSTGRES_DB=issue32_test postgres:16-alpine
docker exec eduagentx-issue32-test pg_isready -U postgres
# Wait until pg_isready reports accepting connections before continuing.
$issue32Port = (docker port eduagentx-issue32-test 5432).Split(':')[-1]
$env:SKILL_GAP_TEST_DATABASE_URL = "postgres://postgres:issue32-disposable-only@127.0.0.1:$issue32Port/issue32_test"
node scripts/verify-issue-32.js
Remove-Item Env:SKILL_GAP_TEST_DATABASE_URL
docker rm -f eduagentx-issue32-test
```

Each database run needs a fresh database/container because the test exercises immutable data and restricted ownership. The cleanup above removes only this named disposable test container and its non-volume test data.

Evidence is generated under `artifacts/issue-32/`: `report.json` and one TAP log per suite. The report records UTC execution times, Node/platform, Git revision and a hash of source/configuration files, including uncommitted implementation files. A passing focused report does not declare a cumulative Sprint Gate or independent human review passed.

Additional checks:

```powershell
node scripts/setup-dev.js
docker compose config --quiet
docker build -t eduagentx-skill-gap:issue32-local -f services/skill-gap-service/Dockerfile .
python -m unittest discover -s scripts -p 'test_sprint1_*.py'
git diff --check
```

## Actual verification and remaining acceptance

See [the retained verification record](evidence/issue-32-verification.json) for measured counts and scope. The public tests run real Gateway, Skill Gap, Examination, Marketplace and Training apps over HTTP with memory stores and injected curriculum/registry/grader/trust authorities. The Marketplace test generates and reads a real stored result from the matching app; it does not demonstrate the unfinished real issuer-origin integration. Real PostgreSQL is separately tested for concurrency, fresh-store replay, rollback, immutable evidence and restricted permissions. Container startup and the actual role initialization script were also exercised against a disposable database.

Issue 13 and 21 implementations are available. Issue 31 was merged in PR 81 although its tracker issue remains open. Marketplace's `createLifecycleSource` still returns `source_not_available`; real credential-origin integration remains an upstream blocker for a full real-issuer-to-Marketplace-to-Training demonstration. Keep trust exclusions unchanged. Coordination with the Certification/Marketplace owners is still required.

The complete Docker stack, cumulative Sprint 1–5 gates, formal 1,000-scenario suite, second-machine reproduction and human reviews have not been completed by this work package. Issue 32 is locally implemented and verified within the stated scope; full deployed acceptance remains conditional on upstream integration. No shared remote branch, issue state or PR was changed.

## Next handoff

For Salman/Issue 33 and Raniya/Issue 34, use the public contract tests as examples of bounded failure and duplicate/retry scenarios. Include both examination-origin and Near Match-origin recommendations, explicit enrollment authorization, immutable original outcomes, no targeted content, unsupported-domain refusal and source outages. The cumulative gate must exercise the real lifecycle authorities after their integration lands; injected trust fixtures are only contract-level evidence.
