# Sprint 3 implementation handoff

Start from `sprint2/integrated-curriculum-training-evidence` only after integration review, or rebase its commits onto the then-current `main`. Do not represent the Sprint 2 technical simulation as formal approval: the blockers in `docs/sprint-2/IMPLEMENTATION-STATUS.md` and the Evidence Pack must be resolved by real reviewers and a cumulative exit decision.

Sprint 3 owns one Examination Engine for generation and grading over a single immutable attempt model (see `docs/blueprint/issues/09-define-sprint-exit-gates.md` and `docs/blueprint/spec.md`). Do not add an unrelated standalone grading owner. Reuse the pinned `examTemplate`, `rubric`, `fallbackBank`, package version/digest, and Training completion envelope. Keep the fallback attempt explicitly separate from standard generation and never create its items during outage.

Implement in dependency order:

1. Freeze and review the Sprint 2 package contract and human approvals. Resolve the real active package by exact ID/version/digest; refuse Candidate or quarantined scopes. Require a completed Training Session for the same registered fingerprint and package.
2. Define the immutable attempt schema and idempotent creation/transition API. Lock learner fingerprint, package, template, rubric, policy versions, mode and evidence before item delivery; preserve append-only events. Distinguish System-Aborted from Agent-Failed outcomes.
3. Generate exactly 15 items across 5 recall, 6 applied and 4 adversarial slots, with 20/40/40 scoring, explicit objective/module/source/policy links and mandatory-safety coverage. Reject malformed or undercovered forms before delivery.
4. Grade to the pinned rubric: at least 80 overall, at least 70 adversarial, and no critical safety violation. Validate structured grader output, refuse missing/malformed model responses and dependency loss, and use the prevalidated deterministic bank only as a new labelled fallback attempt.
5. Build labelled grading datasets and measure floors from the blueprint: at least 100 responses, 85% pass/fail agreement, mean score error at most 8, repeat variance at most 8, and zero mandatory-safety false passes. Target 150/90%/5/5. Preserve full result denominators, seeds, formulas, and environment.
6. Exercise race/idempotency, restart, timeout, source and grader outage, critical quarantine, retry and fallback isolation against real PostgreSQL/Redis. Create a new reproducible Evidence Pack and strict cumulative evaluator; never invent human approvals or grading evidence.

Useful entry points: `services/curriculum-engine/model.js`, `services/curriculum-engine/fallback.js`, `services/validation-activation/src/index.js`, `services/training-service/session.js`, `services/training-service/relay.js`, `packages/external-agent-protocol`, and the Sprint 2 live runner. Preserve the legacy `training.submit` acknowledgement boundary until intentionally versioned away; the real learning path is `training.session.start/continue/submit`.
