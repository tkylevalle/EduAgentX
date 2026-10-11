# Issue #16 — examination generation boundary

This branch starts Issue #16 from merged Sprint 2 `main` (`4dbe172`). It does **not** complete Sprint 3 or override the missing independent Sprint 2 reviews. The canonical work package is GitHub Issue #16; Issues #17 and #18 own attempt persistence and grading.

## Implemented seam

`services/examination-engine/generation.js` accepts three authoritative inputs and an injectable item generator:

- The Validation/Activation service's internal `/packages/active` response, including exact package ID/version/digest, template, rubric, objectives, modules, source pins and quarantine state. This branch adds the already-persisted source records to that internal response; it does not expose them through a public learner route.
- The Registry record for the authenticated Agent Learner, including configuration fingerprint.
- An authoritative `training.session.completed` envelope for the same learner, fingerprint and exact package. A caller must fetch this from Training's owned store, not accept it from a request body.

The pure `generateStandardForm` callback receives the pinned package artifacts and returns 15 proposed items. The validator rejects missing/unavailable generators, Candidate/quarantined packages, mismatched Training evidence, noncanonical template counts or weights, missing or duplicated slots/prompts, altered objectives, invented source pinpoints, missing critical-rule links, and extra item fields (including answer material). Errors expose only fixed codes, not the raw generator response. A test-only injected generator proves the zero-paid replay seam; it is **not** an independently reviewed live question generator.

The returned form binds package/template/rubric digests, policy hash, Training event, learner fingerprint, weights and item references. `publicForm` is an allowlisted projection. Neither function writes an attempt or exposes a public route.

## Integration contract for other work packages

Issue #17 must own a single Examination Engine attempt aggregate. Before any public delivery, it must obtain the Active package, Registry identity and authoritative Training completion, invoke this validator, then atomically persist the form's immutable governing fields, item IDs/hashes, assessment mode and deadline. Its retry and state machine must not regenerate a different form under the same attempt ID. A safe read-only console view may expose the form manifest and identifiers but must not expose raw answers, hidden grader material or generator context. Issue #16's public delivery criterion remains **open** until this atomic admission and Gateway route are integrated.

Issue #18 grades only a persisted, complete attempt against the same pinned rubric and must never treat this pre-admission form as gradable evidence. Issue #20 owns a distinct fallback attempt over the pre-authored bank; the standard generator must not reuse that bank as a standard form.

## Remaining Issue #16 work

1. Agree the item-generator implementation and authored/replay source with the team. No paid provider or unreviewed draft prompts are silently promoted to a formal examination.
2. Integrate with Issue #17's durable attempt admission and then expose the authenticated public Examination start/read workflow and admin-only read-only console view.
3. Run real-service and failure-path tests across Validation, Registry, Training, Examination and Gateway. Current tests prove the pure validation seam and the internal source contract, not end-to-end delivery.
4. Obtain independent content, security-critical and cumulative gate reviews before claiming a formal Sprint 3 pass.

Run `node --test services/examination-engine/test/generation.test.js` for the focused replay/negative tests, or `node scripts/run-unit-tests.js` for the full component suite.
