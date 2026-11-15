# Release limitations and positioning

Status: draft for team review, updated 13 November 2026. The approval record must not
be written until the team has reviewed and corrected this file.

## Known limitations

- Live execution provenance is disabled. Only synthetic and replay evidence
  can be trusted Marketplace evidence (PR #84).
- Replay enrollment is refused until two people record their fixture reviews
  in `packages/execution-provenance/replay.review.json`. The record has no
  reviews today.
- Issues 31 to 35 and 83 are open: ranking and explanations, Skill Gap
  contracts, the 1,000-scenario suite, hero scenarios and fault injection, the
  Marketplace Console with the final Evidence Bundle, and the
  Certification-to-Marketplace trust integration.
- Sprint 1 passed on 29 September 2026 with three waivers: no independent
  reproduction by a second member, no capability backup handoff, and no
  independent human trust-boundary review
  ([evidence/review-summary.md](../../evidence/review-summary.md)). The handoff
  drill and the approval record must close the last two.
- Sprints 3 and 4 have no measured gate evidence. Their earlier gate results
  and evidence packs were written by hand, not by a run, and PR #91 removed
  them. The earlier gate scripts could not fail: their checks only printed,
  and every scenario was recorded as PASS (assurance audit A12). The
  rewritten `scripts/sprint3-gate.js` and `scripts/sprint4-gate.js` run on
  the stack through public routes and fail on a wrong result. Each still
  reports two demonstrations as not run, so neither gate can pass yet, and
  the Sprint 3 gate also needs grading validity to leave Red.
- The secret scan does not read binary files, and it blocks on text files
  over 2 MB instead of reading them. It cannot find a password written in
  prose.

## Measurement validity

The assurance audit ([docs/audit/assurance-audit-2026-11-15.md](../audit/assurance-audit-2026-11-15.md))
found that the system around the measurement holds up, but the measurement
does not yet support a competence claim. State on 15 November 2026:

- **The grader is not valid.** `packages/grading-validity` measures the
  production grader on the 15 real exam items. A parrot agent, a
  keyword-stuffing agent and an agent that copies the objective statements
  pass the exam; leaks and injected-instruction compliance written in other
  words are not detected as critical violations. Status Red. CI's
  `grading-validity` job fails until this changes.
- **No response has labels from people.** Agreement with people is
  unmeasured. The labelling procedure is in `packages/grading-validity/README.md`.
- **The exam asks the agent to describe actions, not to take them.** No item
  gives the agent a tool, so secure tool use is not tested by behaviour.
- **Every standard attempt gets the same 15 items**, and two adversarial
  items are linked to the wrong objectives (audit A13).
- **One run per exam**, with no repetition or confidence bound.
- **The agent has no context.** Each model call holds one item and the
  system prompt only; training cannot change exam results, and the exam
  names sources the agent never receives. `knowledge.lookup` is declared in
  the agent's fingerprint but not implemented, and nothing queries the
  ChromaDB index. No learning gain is measured or claimed.
- **The curriculum is a draft** (`0.1.5-draft`, sources pending independent
  review), and the demo driver approves it with the shared reviewer
  credentials. The Sprint 3 and 4 gates refuse such approvals.
- **Fingerprints are declared by the agent.** Nothing checks that the running
  agent matches its registered configuration.
- **Status and issuer are not independently checkable.** Suspension and
  revocation are an unsigned store inside credential-verification, not a
  signed status list, and the issuer (`did:example`) publishes no key.
- **The credential names its grader** (since this audit), but Certification
  accepts any grader the assessment names; refusing graders that have not
  passed the validity measurement needs a grader registry.
- **The fallback bank's questions** now show shuffled options with plausible
  distractors, but their content has not been reviewed by people.

The fixes are planned in [docs/audit/target-system-design.md](../audit/target-system-design.md).

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
| 12 November 2026 | Same | Neeraj Santosh | Raniya Habachi | Raniya Habachi on PR #88: Primary swapped with Timothy |

The issue #36 body still names Timothy and should be updated to match.
