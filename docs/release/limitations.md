# Release limitations and positioning

Status: draft for team review, updated 15 November 2026. The approval record must not
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
  rewritten `scripts/sprint3-gate.js` and `scripts/sprint4-gate.js` are
  written to run on the stack through public routes and to fail on a wrong
  result; their runner and package checks are unit tested, but **neither has
  yet run against a live stack**. Each reports two demonstrations as not
  run, so neither gate can pass yet, and the Sprint 3 gate also needs
  grading validity to leave Red.
- The secret scan does not read binary files, and it blocks on text files
  over 2 MB instead of reading them. It cannot find a password written in
  prose.

## Measurement validity

The assurance audit ([docs/audit/assurance-audit-2026-11-15.md](../audit/assurance-audit-2026-11-15.md))
found that the system around the measurement holds up, but the measurement
does not yet support a competence claim. State on 16 November 2026, after Phase 1 of the target design:

- **The text grader is not valid.** `packages/grading-validity` measures the
  production keyword grader on the 11 text items (recall and applied). The
  parrot, keyword-stuffing and copied-objective agents now fail, but so do the
  author's competent and brief agents (provisional until people label them),
  so those must-fail results are inconclusive; and a leak written in other
  words is not detected as a critical violation on text items. Status Red.
  CI's `grading-validity` job fails until this changes.
- **No response has labels from people.** Agreement with people is
  unmeasured. The dataset has 106 author-written answers and no live-model
  answers; the target is at least 150 labelled by two people. The labelling
  procedure is in `packages/grading-validity/README.md`.
- **The adversarial tier is graded from actions, in a sandbox with limits.**
  Each adversarial slot runs 9 episodes in seeded simulated tool worlds
  (`packages/agent-sandbox`); a critical violation in any episode fails the
  attempt, and each objective must reach a 95% success lower bound of 0.70.
  With 9 or 18 clean episodes, the 95% upper bound on the violation rate is
  still about 28% (o3, o5) or 15% (o4). The tools keep no end state that is
  checked (target design 4.1), and the reference safe agent is a scripted
  oracle tuned to these worlds. Objectives o1 and o2 have no behaviour items.
- **Held-out means wording only.** Exam worlds draw attack wording from a pool
  that practice does not use, but the pool is public, small (four held-out
  phrasings per family) and the same on every re-examination; names, task
  templates and benign worlds are drawn the same way in both pools.
- **The 11 text items are the same on every attempt.** Sandbox worlds differ
  per attempt and per episode.
- **Synthetic and replay credentials show a reference policy's behaviour.**
  In those evidence modes the behaviour items are played by a scripted
  reference policy that the Engine checks step by step, so their bounds
  describe that policy, not an agent. The signed scope statement says so.
- **Verification cannot replay episodes.** Only the Engine holds the world
  seeds; a verifier checks that the signed counts, bounds and items are
  consistent, not that the episodes happened as listed.
- **The live learner acting in episodes is untested against a real model.**
  It is covered by stubbed-endpoint tests; one live exam is about 36 episodes
  of several model calls each. A model failure mid-exam is reported by the
  learner as a system abort, but the Engine's attempt stays open until its
  deadline and then ends as Agent-Failed (`response_deadline_elapsed`); the
  learner cannot abort an attempt.
- **The exam is open book.** The live learner looks up lessons with
  `knowledge.lookup` (the curriculum index, pinned to the exam's package
  version) for each text item. A failed lookup returns nothing and the item
  is still answered; the run reports lookups, failures, empty answers and
  answers from the index's stale cache. Lookups are not recorded by the
  Engine or in the credential, and episodes do no lookup.
- **Only the live learner carries training into the exam, and only in its
  own memory.** What the live model writes after each training item is kept
  as its note for the item's objectives and shown to it in later exam items
  and episodes. The notes live in the learner service's process: the platform
  does not store or attest them, they are not part of the fingerprint, and a
  restart empties them; runs report only a count and a digest. Scripted agents
  ignore notes. The lookup returns lesson text, not the pinned source
  documents the exam names. No learning gain is measured or claimed.
- **Training completion means delivery, not learning.** Training accepts any
  non-empty response, and the Overview and console label it as delivery.
  Remediation now tells the agent the failed objectives, failure reasons and
  broken rule ids, but not the evidence, and offers no practice episodes:
  practice in the sandbox's practice pool is not built.
- **Learning gain is not measured yet.** `packages/learning-measurement` can
  measure it (arms with no notes, own notes and off-topic control notes, with
  intervals), but only its scripted instrument check has run, and that shows
  no gain by construction. It is an arms design, not the pre-test and
  post-test the target design describes.
- **The curriculum is a draft** (`0.1.6-draft`, five lessons of about 80
  words, sources pending independent review, OWASP licence review pending),
  and the demo driver approves it with the shared reviewer credentials. The
  Sprint 3 and 4 gates refuse such approvals.
- **Source checks are shallow.** The traceability gate hashes source
  metadata, not the documents, and never checks that a claim appears in its
  source; freshness relies on evidence the caller supplies.
- **Fingerprints are declared, except for the live learner, and even that is
  not checkable.** New credentials state an attestation level: `L2-observed`
  only for the live learner (`CERTIFICATION_PLATFORM_SUBJECTS`), whose model
  and prompts are fixed in platform code; `L1-declared` for every other agent,
  including the synthetic learner, which registers any configuration a caller
  sends. L2 is decided by the subject identity alone: it rests on the live
  learner's client secret staying in the platform, and nothing in the
  credential lets a verifier check it. There is no harness for external
  agents. Credentials issued before this change carry no attestation.
- **Only scripted agents can be Eligible in the Marketplace.** Live
  provenance is disabled and the replay fixture has no reviews, so every
  Eligible candidate is a synthetic agent with scripted answers.
- **Status and keys are published, with limits.** Credentials carry W3C
  Bitstring Status List entries, and the signed revocation and suspension
  lists and the issuer's keys (JWKS, with each key's purpose) are open at
  `/status-lists/*` and `/.well-known/jwks.json`. The issuer is still an
  `https://eduagentx.example` URL, not a resolvable `did:web`; credentials
  issued before this change carry no status entry; a leaked retired key can
  back-date a forgery (see [key-rotation.md](key-rotation.md)); one list
  holds 131,072 credentials.
- **The credential names its grader** (since this audit), but Certification
  accepts any grader the assessment names; refusing graders that have not
  passed the validity measurement needs a grader registry. Credentials
  issued before this change carry no grader, so verification and the
  Marketplace now treat their provenance as invalid; a database with such
  credentials loses those Eligible candidates until the agents are
  examined again.
- **The fallback bank's questions** now show shuffled options with plausible
  distractors, and every item is a selection, so no answer depends on exact
  wording. Their content has not been reviewed by people.
- **Not run on a stack.** The branch's changes are covered by unit tests and
  the validity measurement only; the changed lifecycle driver and the gates
  have not yet run against a live stack.

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
