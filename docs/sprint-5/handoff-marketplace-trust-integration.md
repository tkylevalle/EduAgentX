# Marketplace trust integration review report

Date: 2026-11-03. Full integration status: **BLOCKED BY CONTRACT DECISION**.
Pre-commit scope audit: **A — SAFE TO COMMIT/PUSH CURRENT ORIGIN REPAIR**.
The lifecycle-origin repair is implemented and verified. Trusted signed
environment/evidenceMode and a positive Eligible Match are not implemented;
promoting the current caller-declared labels would violate the requested trust
boundary. [Issue #83 — Sprint 5: Certification-to-Marketplace trust provenance
integration](https://github.com/tkylevalle/EduAgentX/issues/83) is the tracking
authority. It remains **OPEN** for the unresolved provenance contract and blocks
Issue #33's formal Marketplace acceptance. This branch delivers only the safe
lifecycle-origin portion and does not complete #83.

## A–D. Isolation, branch, base and issue search

- Worktree: `/home/ubuntu/ChatGPT/EduAgentX-marketplace-fix/repo`.
- Branch: `salman/fix-marketplace-trust-integration`.
- Main/base used for this repair:
  `1a90ae5e8f14f93cd17f6ca3b53cce27d99bd8e0`.
- The original Issue #33 worktree was verified clean on
  `salman/issue-33-e2e-suite` at
  `9b41068c3864c60f8671b0f2b88090ec158077f2` before setup. It was not edited,
  reset, cleaned, switched, merged or rebased. No commands were run there after
  the new worktree was established. Its final worktree registration still names
  the same branch and commit. No Issue #33 harness code was copied.
- Only the explicitly authorized disposable parent `.git` was removed. The
  parent `.agents`, `.codex` and `.aws` contents were not inspected or touched.
- Related work includes
  [#30, Capability Requests and Marketplace Eligibility](https://github.com/tkylevalle/EduAgentX/issues/30),
  [#31, Ranking, Near Matches, and explanations](https://github.com/tkylevalle/EduAgentX/issues/31),
  and [#23, Certification Decisions and issuance](https://github.com/tkylevalle/EduAgentX/issues/23).
  The dedicated tracking authority is now
  [#83](https://github.com/tkylevalle/EduAgentX/issues/83), which covers both origin
  authority and authoritative signed provenance and explicitly blocks #33.

## E–G. Root causes and implemented architecture

Origin: `createLifecycleSource()` was an unconditional `source_not_available`
adapter. Marketplace had no authenticated issuer read binding the projected
credential to the immutable Certification Decision and Examination.

Provenance: Training validates enum/environment pairs supplied by the learner,
but has no authoritative run attestation or immutable mode binding. Its
completion copies the final request's label. Examination pins that completion in
`form.training.evidence` but omits it from the Certification projection.
Certification therefore neither validates, persists nor signs these labels.
Simply restoring that projection would still sign an unvalidated caller claim.

The implemented repair adds a narrow Certification origin endpoint and exact
credential store lookup. New decisions allocate their UUID before signing and
include it as `evidence.certificationDecisionId`. Existing transaction locks,
uniqueness constraints and replay behavior remain intact. The response binds
credential UUID, decision UUID, examination UUID, learner, fingerprint and SHA-256
of the exact compact JWS. Marketplace checks those facts and reconstructs its
entire candidate from the JWS to catch unsigned event-field substitutions.

Marketplace startup and Compose now wire the real origin client. The existing
publisher, verifier and Redis projection were already present and are exercised
unchanged. No ranking, eligibility policy, score threshold or verifier rule changed.

## H. Exact production files changed

| File | Classification | Why required for origin repair |
| --- | --- | --- |
| `docker-compose.yml` | production/runtime | Gives Marketplace the issuer URL and Certification the distinct existing Marketplace key for the narrow read. Corrects the adjacent outbox comment. |
| `services/certification-service/evidence.js` | production/runtime | Signs the store-assigned decision UUID in new credentials, allowing the client to verify the returned decision binding. Does not sign provenance. |
| `services/certification-service/index.js` | production/runtime | Adds the exact-selector authenticated GET; rejects source evidence for another examination; passes the immutable decision UUID to signing in both issuance paths. |
| `services/certification-service/store.js` | production/runtime | Reads one immutable credential/decision pair and returns allowlisted bindings plus its exact-JWS digest. Allocates the memory-store decision UUID before signing, matching the PostgreSQL transaction. |
| `services/marketplace-service/clients.js` | production/runtime | Implements the bounded authenticated lookup, strict response/JWS/digest/binding checks, projection comparison, origin-only redirect refusal, and distinct 404 versus malformed-null handling. |
| `services/marketplace-service/index.js` | production/runtime | Replaces the unavailable stub in runtime startup with the configured real origin client. |

No schema migration, dependency or lockfile changes.

## I. Exact test files changed or added

| File | Classification | Purpose |
| --- | --- | --- |
| `services/certification-service/test/issuance.test.js` | test | Authorization, exact selector, minimal response, failed/aborted/mismatched evidence, signing binding, immutable replay and storage failure. |
| `services/certification-service/integration/postgres.test.js` | test | Origin digest/decision persistence, fresh connections, exactly-once concurrency and immutable replay. |
| `services/marketplace-service/test/clients.test.js` | test | Corrects the stale title: an unconfigured client remains uncheckable, while configured origin is now implemented. |
| `services/marketplace-service/test/origin-client.test.js` | test | Binding/malformed/timeout/redirect/spoof/tamper/legacy checks; confirms the preexisting Registry redirect behavior stays unchanged. |
| `services/marketplace-service/integration/lifecycle-origin.test.js` | test | Opt-in real lifecycle, exclusion for missing provenance, actual issuer outage and restart/replay proof. |

| File | Classification | Purpose |
| --- | --- | --- |
| `docs/contracts/certification.md` | contract/documentation | Endpoint selector, response, authorization, signed decision binding and unresolved provenance boundary. |
| `docs/contracts/marketplace.md` | contract/documentation | Real authority client, exact-artifact checks, legacy behavior and actual event feed. |
| `docs/contracts/marketplace-matching.md` | contract/documentation | Origin integration and continuing provenance trust exclusions; no policy changes. |
| `docs/contracts/marketplace-trust-integration.md` | contract/documentation | Design decision, authoritative-source ambiguity, fallback/signing decisions and reproducible focused test instructions. |
| `docs/sprint-5/handoff-marketplace-trust-integration.md` | contract/documentation | Implementation/evidence record, scope audit and Issue #83 tracking boundary. |

Exact intended scope: **16 files: 6 production/runtime, 5 test, 5
contract/documentation**. No file is classified temporary/unnecessary. The
pasted estimate of 19 files did not match Git's actual changed/untracked set;
the initial audit found these same 16 files. Ignored runtime artifacts are not
part of the intended commit.

## J. Lifecycle-origin authorization

`GET /internal/credential-origins/:credentialId` accepts exactly one lowercase
UUID and no query parameters. It requires `MARKETPLACE_INTERNAL_KEY`,
`x-actor-subject: marketplace-service` and `x-actor-role: marketplace`.
The key must be configured and distinct from `CERTIFICATION_INTERNAL_KEY`.
It grants no issuer command, credential listing, other read, or enumeration
rights. This uses the repository's existing internal-key/header mechanism.

Unknown IDs return 404; invalid selectors 400; unauthorized requests 403;
storage uncertainty 503. The production client has a two-second abort deadline,
does not follow redirects and does not retry. Unknown/mismatched origin is
false; uncertainty/malformed authority is uncheckable. Both are trust exclusions.

## K–L. Provenance rules and legacy behavior

Known meanings: synthetic/simulation, replay/simulation, live/live. These enum
meanings do not validate a run. No defaults, provider inference, label backfill,
or caller-provenance signing were added. Values were not persisted or signed
because their source authority remains undefined.

The real Gateway audit probe accepted a `live` Training start (201) followed by
`synthetic` continue (200) from the same learner, retaining both event modes.
No live model invocation or credential issuance occurred in the probe. This
demonstrates the unresolved source trust boundary independently of the missing
projection plumbing.

Old credentials are unchanged. Missing provenance stays uncheckable; missing the
new signed decision ID also stays origin-uncheckable. Fallback assessment is
still distinct from synthetic/replay/live provenance, with no invented mapping.
Normal non-Marketplace Certification remains compatible and still issues valid
credentials under the existing evidence contract.

## M–N. Real composed and negative results

An isolated Compose project built from this worktree ran the real Gateway,
Registry, curriculum/activation, Training, Examination, grader, Certification,
verification, outbox, Redis consumer and Marketplace. Candidates were not
inserted in databases or supplied through Marketplace authority fixtures.

- Real newly issued credential: verification `VALID`; origin true; correct
  signed decision/examination/subject/fingerprint bindings. The only eligibility
  exclusion was `ENVIRONMENT_UNCHECKABLE`. Matching additionally reported
  `EVIDENCE_MODE_UNCHECKABLE`; neither lane contained the candidate.
- Real signed-value tampering: verifier signature failure and origin digest
  mismatch. Unsigned simulation/synthetic projection labels also failed origin.
- Unknown/unauthorized/broad issuer reads were refused.
- Stopping only the isolated issuer added `LIFECYCLE_ORIGIN_UNCHECKABLE` and kept
  the actual projected candidate out of eligibility and both matching lanes.
- Restart preserved the exact origin digest and signed credential; replay was
  identical and the Gateway still listed exactly one credential.
- Focused tests cover credential/decision/examination/subject/fingerprint/digest
  mismatch, failed and system-aborted examinations, malformed issuer responses,
  bounded timeout, connection refusal, wrong/missing key, invalid configuration,
  redirection refusal, legacy absence, projection spoofing and immutable replay.

A fully Eligible positive real Marketplace path was **not achieved**. It remains
blocked by the provenance contract; the tested positive is issuer origin only.

## O. Test counts and retained evidence

All final completed checks passed. Counts below overlap and must not be summed
as unique cases.

| Run | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| Final `node scripts/run-unit-tests.js` | 729 | 0 | 0 |
| Final focused Certification + Credential Verification | 46 | 0 | 0 |
| Certification/Examination/Marketplace PostgreSQL suites | 18 | 0 | 0 |
| Existing Sprint 5 `node scripts/verify-issue-32.js`, including separate PostgreSQL check | 517 | 0 | 0 |
| Real composed issuance/origin/provenance-exclusion stage | 6 | 0 | 2 inactive stages |
| Real issuer outage stage | 1 | 0 | 0 |
| Real issuer restart/replay stage | 1 | 0 | 0 |

The two inactive stages in the first Compose run were subsequently selected and
executed separately. The six passes in that run include its enclosing test and
five subtests. This is not eight formal E2E scenarios.

Full runner component counts:

| Component | Passed / total |
| --- | ---: |
| demo-lifecycle | 9/9 |
| external-agent-protocol | 7/7 |
| telemetry | 3/3 |
| agent-registry | 9/9 |
| api-gateway | 53/53 |
| assurance-console | 22/22 |
| certification-service | 22/22 |
| credential-verification | 24/24 |
| curriculum-engine | 18/18 |
| curriculum-index | 12/12 |
| evidence-bundle | 14/14 |
| examination-engine | 138/138 |
| grading-service | 32/32 |
| marketplace-service | 203/203 |
| monitoring-service | 14/14 |
| skill-gap-service | 14/14 |
| synthetic-agent-learner | 33/33 |
| training-service | 76/76 |
| validation-activation | 22/22 |
| web | 4/4 |

Sprint 5 verifier: Skill Gap 14, Gateway 53, Training 76, Examination 138,
Marketplace 203, grading 32, isolated Skill Gap PostgreSQL 1 = 517.
Compose configuration validation, image builds/startup and `git diff --check`
also passed. Node version: v24.19.0.

Earlier diagnostic runs: the initial full runner passed 727/727 before two
additional issuer configuration/storage tests were added; initial focus passed
33/33. Sandbox loopback restrictions required authorized unsandboxed test runs.
The first Sprint 5 verifier run passed 516/517: the new success-path test's 80ms
deadline was too short under load. Its test deadline is now one second; the
hanging-authority test retains 80ms and production remains two seconds. Final
Sprint 5 verification passed 517/517. The first restart check failed 0/1 against
a stale random host port; refreshing the container's port mapping produced the
final pass. No production trust gate was changed to address these test failures.

Logs and JSON are retained only in ignored `artifacts/marketplace-trust/`,
`artifacts/sprint1/unit-tests.json` and `artifacts/issue-32/`. Test keys and `.env`
remain ignored. The uniquely named Compose project
`eduagentx-marketplace-trust-82df53f44663` was removed with its containers,
volumes, network and project-built images; post-cleanup queries found no
remaining containers, volumes or network for that project. Cleanup targeted only
that named project with Compose; no unrelated project was targeted.

## P. Not run / incomplete

- Formal 1,000-scenario suite and formal 100-case golden suite: not run, as
  instructed. No Issue #33 code was used.
- Positive signed synthetic/replay/live provenance, mixed-mode authority,
  fallback mapping and provenance persistence/retry tests: not implemented,
  pending the contract decision. Existing fallback/examination tests passed;
  they do not prove authoritative learner-mode provenance.
- Fully positive Eligible Match and cumulative Sprint 4/5 exit gates: not
  claimed. `scripts/sprint4-gate.js` uses placeholder/manual demonstration
  inputs, external monitoring/bundle endpoints and `console.assert`; it is not
  the applicable authoritative-origin technical verifier. The existing Sprint
  5 technical verifier and real focused Compose stages were run instead.
- No optional live model calls, paid provider runs or unrelated service fixes.

## Q. Security audit

| Audit item | Result |
| --- | --- |
| Read-only exact-selector endpoint; no broad enumeration | Pass |
| Internal key/subject/role checks; issuer command key separated | Pass |
| Response excludes raw assessments, answers, prompts, rationale | Pass |
| No JWT, client secret or signing-key exposure | Pass |
| Bounded client timeout; no redirects or automatic retries | Pass |
| Unknown/mismatch/malformed/unavailable authority fails closed | Pass |
| Unsigned candidate claims cannot borrow a signed artifact's origin | Pass |
| Legacy missing provenance is not upgraded | Pass |
| New decision binding is signed before atomic persistence | Pass |
| Signature verification catches edited values | Pass |
| One decision/credential, immutable replay/restart retained | Pass |
| Existing non-Marketplace Certification behavior | Pass |
| Trusted environment/evidenceMode signing | Not implemented; blocked, no unsafe approximation |
| Ranking, Near Match separation and other trust gates unchanged | Pass |

## R. Pre-commit audit snapshot: `git diff --stat`

```text
 docker-compose.yml                                 |   5 +-
 docs/contracts/certification.md                    |  42 +++++++
 docs/contracts/marketplace-matching.md             |  20 ++--
 docs/contracts/marketplace.md                      |  19 +++-
 services/certification-service/evidence.js         |   6 +-
 services/certification-service/index.js            |  25 ++++-
 .../integration/postgres.test.js                   |  21 +++-
 services/certification-service/store.js            |  33 +++++-
 .../certification-service/test/issuance.test.js    | 122 ++++++++++++++++++++-
 services/marketplace-service/clients.js            |  61 +++++++++--
 services/marketplace-service/index.js              |   3 +-
 services/marketplace-service/test/clients.test.js  |   2 +-
 12 files changed, 322 insertions(+), 37 deletions(-)
```

Git's stat excludes the four untracked new files listed below. Nothing was
staged to manufacture a combined stat.

## S. Pre-commit audit snapshot: `git status --short --branch`

```text
## salman/fix-marketplace-trust-integration...origin/main
 M docker-compose.yml
 M docs/contracts/certification.md
 M docs/contracts/marketplace-matching.md
 M docs/contracts/marketplace.md
 M services/certification-service/evidence.js
 M services/certification-service/index.js
 M services/certification-service/integration/postgres.test.js
 M services/certification-service/store.js
 M services/certification-service/test/issuance.test.js
 M services/marketplace-service/clients.js
 M services/marketplace-service/index.js
 M services/marketplace-service/test/clients.test.js
?? docs/contracts/marketplace-trust-integration.md
?? docs/sprint-5/handoff-marketplace-trust-integration.md
?? services/marketplace-service/integration/lifecycle-origin.test.js
?? services/marketplace-service/test/origin-client.test.js
```

At this audit snapshot, `git diff --cached` was empty and HEAD and origin/main
were both the base SHA. These historical snapshots retain the reviewed scope;
they do not describe the working-tree state after the authorized commit/push.

## T. Exact unresolved contract decision

Training/Examination, Gateway authentication and Certification/Marketplace owners
must define the authoritative run/evidence record that proves seeded synthetic,
versioned replay or fresh live inference, binds it to learner/fingerprint, and
is pinned across Training and Examination. They must specify conflicting/mixed
mode handling, fallback's separate learner-evidence classification, and the
test/live issuer and signing-key policy. The protocol's enum map is already
clear; the trusted source and lifecycle binding are not.

The full analysis and implementation boundary are in
[the integration decision](../contracts/marketplace-trust-integration.md).

## U. Tracking authority: Issue #83

[#83 — Sprint 5: Certification-to-Marketplace trust provenance
integration](https://github.com/tkylevalle/EduAgentX/issues/83) was verified
**OPEN**. Its scope includes the exact-credential origin authority implemented
on this branch and the still-unresolved authoritative environment/evidenceMode
contract, persistence and signing. It explicitly blocks #33's formal Marketplace
acceptance. The issue owns the remaining acceptance criteria; its full body is
not duplicated here. This origin-only commit must not close #83.

## V. Integration status and pre-commit audit

Full integration remains **BLOCKED BY CONTRACT DECISION**. The current
origin-only change set was rated **A — SAFE TO COMMIT/PUSH CURRENT ORIGIN REPAIR**
by the pre-commit scope audit. The user subsequently authorized one origin-only
commit and a normal branch push, with no PR, merge, issue edit or issue closure.

The pre-commit fetch succeeded after an initial transient DNS failure. GitHub's
live main branch and fetched `origin/main` were both at the recorded base SHA;
HEAD was unchanged, 0 ahead / 0 behind, with nothing staged at that audit.
The subsequent dedicated Issue #83 supersedes the proposed-issue text and is
the tracking authority for the remaining provenance work.

Audit cleanup: no files were removed. One unrelated behavioral expansion was
removed: shared HTTP redirect refusal had also affected preexisting authority
clients. It is now scoped to origin lookup only; the new test checks both origin
refusal and unchanged Registry redirect behavior. Generated/exploratory runtime
helpers and logs remain ignored, outside the intended commit.

The security checklist in Q was rechecked against the final diff. No learner
labels become authoritative, no environment/evidenceMode is signed or defaulted,
no existing signed credential is rewritten, and origin success does not bypass
eligibility. Eligibility, matching, verification, Training, Examination, publisher
and immutable schema implementations have no changes from the base.

Post-cleanup checks: affected focused tests **249/249** passed (Certification 22,
verification 24, Marketplace 203), then the full runner passed **729/729** again.
The earlier **46/46** Certification/verification result is also covered in the
fresh 249-test run. Retained PostgreSQL **18/18**, Sprint 5 verifier **517/517**,
real lifecycle **6 passed**, issuer outage **1 passed**, and restart/replay
**1 passed** remain applicable evidence for unchanged ledger, endpoint, origin
contract and direct-service integration behavior. They were not rerun during this
audit. The earlier real Compose images predate the already unit-tested null/false
reply distinction; neither that handling nor this audit's redirect scoping
changes the successful direct-service, outage or persistence paths they proved.
No new Compose project, paid call, formal golden suite or 1,000-scenario run was
started. `git diff --check` passes; keys, `.env` and runtime artifacts remain
ignored and untracked by Git.
