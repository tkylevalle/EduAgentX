# Hero scenario stack results, 9 November 2026

Seven scenarios passed on a real isolated stack. Two remain blocked. Scenarios 1, 6 and 7 used the real Certification-to-Marketplace path merged in PR 84.

| Scenario | Result | Observation |
|---|---|---|
| 1 Clean lifecycle and matching | PASS | Real registration, Training, Examination, signed credential, verification, Redis projection, origin lookup and Eligible match |
| 2 Adversarial failure and remediation | PASS | Critical violation produced Agent-Failed and no credential, then targeted Training and a separate passing examination produced a credential |
| 3 Certification restart recovery | PASS | Issuer held unavailable across passing completion, then recovered in 1,672 ms with one credential and one observed issuance event |
| 4 Credential tampering | PASS | Altered signed score failed signature verification while the original remained VALID |
| 5 Live-budget exhaustion and replay | BLOCKED | Authoritative live execution disabled and replay manifest has zero reviews |
| 6 Fingerprint invalidation | PASS | Old fingerprint credential excluded, changed configuration retrained and re-examined, new credential eligible, original signed bytes retained |
| 7 Near Matches | PASS | Three separately trained/certified synthetic learners appeared in the Not Eligible lane with gaps and ordering evidence, while a real legacy credential entered neither lane |
| 8 Unsupported domain refusal | PASS | Validly shaped unsupported-domain request rejected before creation or matching |
| 9 Team continuity handoff | BLOCKED | Human backup execution and acting-Primary/new-Secondary ownership record still required |

## Evidence and reproduction

The retained [Evidence Pack](../../evidence/sprint-5/hero/eduagentx-evidence-20261109t075650z-35376/summary.json) includes one record per scenario, runtime/configuration metadata, image IDs, actual Monitoring snapshot, cleanup status and a digest manifest. Run source is local commit `a89f54d`, combining main `a2db4a4` with PR 85 head `99233b1`. All counters and results in this report come from that execution. The repository source fingerprint is recorded in the pack.

Raw sanitized build/service logs remain under `evidence/runs/eduagentx-evidence-20261109t075650z-35376/`. Earlier diagnostic runs remain under the same `evidence/runs/` parent and are superseded by this final run.

Use Node 24, Python 3 and Docker Desktop from the local review branch.

```powershell
npm ci --ignore-scripts --no-audit --prefix services/synthetic-agent-learner
node --test packages/hero-scenarios/test/*.test.js
python scripts/run-hero-stack.py
```

This machine used the bundled Python at `C:\Users\lulu_pc\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe`. The ordinary Windows `python` alias did not supply that runtime. Invoke the bundled executable explicitly if needed.

The PR's 48 existing catalog/evidence tests passed. JavaScript syntax and Git whitespace checks passed. The stack used fresh project-scoped volumes, random local ports and test signing keys. Cleanup completed with exit code zero. No paid model calls were made.

## Review and execution boundaries

The [PR 85 review](PR-85-REVIEW.md) records two high-priority evidence validation gaps and stale catalog execution defaults. The runner asserts actual service outcomes independently. It explicitly substitutes the real test issuer/key, activated package and enrolled synthetic identities for the stale catalog values. Two extra lab identities are fixed to synthetic mode to exercise multiple Near Matches.

Fault incident records are runner-authored observations of measured faults. Automatic persistent Monitoring incident coverage remains unverified. The observed Monitoring snapshot is retained independently. Certification was stopped before the passing examination and held unavailable across its completion, which demonstrates the required pending/recovery window rather than a database commit interruption.

Initial diagnostic runs exposed harness problems. The first startup omitted grading-service, leaving a complete response set waiting for grading. A later run encountered a stale transport connection after stopping Certification and an owner startup race. The final runner preserves command idempotency on transport retry and polls the recovering issuer. The expanded matching check initially compared an older credential ID instead of the learner identity selected by Marketplace's existing deduplication policy. The final check follows that policy. Those failed observations were retained and no application trust gate or threshold was changed to obtain a pass.

Completing scenario 5 requires the live/replay owners to supply supported bounded execution and actual approved replay evidence. The two replay approvals must be entered by the reviewers themselves. Scenario 9 requires a real participant and ownership handoff record. The Invariant-risk matrix and cumulative Sprint Gate remain incomplete, so Issue 34 cannot be closed on this evidence alone.
