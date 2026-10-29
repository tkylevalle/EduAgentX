# Issue #31 — ranking, Near Matches and explanations

Primary: Djurayev Timurmalik. Secondary: Timothy Kyle R. Valle.
Dependency: #30 (Capability Requests and Marketplace Eligibility).
Implementation base: `a7b69e0` on main. Branch: `feat/issue-31-matching`.

## Changes

- Pure MATCH-POLICY-1.0.0 evaluator runs the existing trust/request gates first,
  then approved 35/35/20/10 arithmetic and deterministic tie-breaking.
- Separate Eligible Matches (maximum five) and Not Eligible Near Matches
  (maximum three), complete components/gaps and exclusion explanations.
- Optional preferred objectives in immutable request versions; old omitted-field
  digests are preserved.
- Authenticated matching command and historical read through the existing Gateway.
- Additive PostgreSQL table, immutable evidence trigger, durable idempotency and
  transaction rollback behavior; no dependency, lock-file or environment changes.
- Credential mapper reads explicit environment/evidence labels while missing or
  unknown values remain uncheckable.

See [the contract](../contracts/marketplace-matching.md) for exact formulas,
routes, response fields and historical replay semantics.

## Verification

From the repository root:

```sh
npm ci --ignore-scripts --no-audit --prefix services/marketplace-service
npm ci --ignore-scripts --no-audit --prefix services/api-gateway
npm ci --ignore-scripts --no-audit --prefix services/examination-engine
node scripts/generate-test-keys.js
npm test --prefix services/marketplace-service
npm test --prefix services/api-gateway
git diff --check
```

Tests cover policy arithmetic with independent expected values, input-order
invariance, all sorting levels, lane limits, trust failures, unsupported domains,
privacy, repeated/concurrent commands, historical reads after revocation,
request-version races, listing withdrawal, and Gateway authorization.

The opt-in PostgreSQL suite adds concurrent issuance of a single match result,
fresh-store replay, UPDATE/DELETE rejection and rollback. Run against a disposable
database with `MARKETPLACE_TEST_DATABASE_URL` configured:

```sh
node --test services/marketplace-service/integration/postgres.test.js
```

This environment had no PostgreSQL server: that integration suite was skipped,
not passed. The complete Docker/Sprint gate was not executed here. The archive's
validation report records the actual unit-test counts and execution results.

## Remaining integration work

At the base revision, the production lifecycle-origin adapter intentionally
fails closed and issuer-origin metadata is absent from the real issuer fixture.
These #30/certification contract dependencies must be resolved before a real
end-to-end eligible result is possible. Matching does not substitute fixtures,
lower thresholds or bypass those gates. No frontend is added by this backend
work package. Keep the PR open until the project's required CI and database
integration checks pass.
