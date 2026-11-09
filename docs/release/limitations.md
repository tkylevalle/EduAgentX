# Release limitations and positioning

Status: draft for team review, 9 November 2026. The approval record must not
be written until the team has reviewed and corrected this file.

## Known limitations

- Live execution provenance is disabled. Only synthetic and replay evidence
  can be trusted Marketplace evidence (PR #84).
- Replay enrollment is refused until two people record their fixture reviews
  in `packages/execution-provenance/replay.review.json`. The record has no
  reviews today.
- Issues 31 to 35 are open: ranking and explanations, Skill Gap contracts,
  the 1,000-scenario suite, hero scenarios and fault injection, and the
  Marketplace Console with the final Evidence Bundle.
- The Sprint 1 gate result is BLOCKED until team reviewers write its Issue 7
  and review records for the released source.
- `evidence/sprint-3/gate-result.json` and `evidence/sprint-4/gate-result.json`
  name no source commit. The sprint pass records must supply one.
- The secret scan skips binary files and files over 2 MB. It cannot find a
  password written in prose.

## Supporting-scope reductions

- The web app is a local demonstration console. It holds admin, reviewer and
  internal credentials, and Compose binds it to `127.0.0.1`. It is not a
  deployable operator interface.
- The live model path is optional. The zero-paid-API path is the reference.

## Residual risks

No residual risk is accepted yet. Each accepted risk needs an owner,
rationale, mitigation and review date. A risk that can breach an Invariant
cannot be accepted as residual. These items need team triage:

- One learner container holds the synthetic, replay and live client secrets.
- Execution enrollment accepts any subject string.
- `.github/CODEOWNERS` is advisory, because `main` has no branch protection.

## Non-accreditation positioning

A release that passes this gate is a tested Capstone-Grade Reference
Implementation. It demonstrates Zero-Human-Loop Execution with Human-Governed
Assurance. It does not claim production readiness, regulatory accreditation,
real hiring authority or safe autonomous deployment.

## Optional live cost

The zero-paid-API path is mandatory. Live usage is optional, and its actual
cost is reported in `docs/release/records/live-cost.json`. The indicative
target for live usage is 100 to 300 AED. No figure is recorded yet.

## Ownership history

| Date | Work package | Capability Primary | Capability Backup | Source |
|---|---|---|---|---|
| Blueprint | Release hardening, second-machine setup and handoff drill | Timothy | Raniya | `docs/blueprint/spec.md` |
| Issue 36 labels | Same | Neeraj Santosh | Raniya Habachi | GitHub labels |

The issue body still names Timothy as Primary. The team must record which
assignment is current and when it changed.
