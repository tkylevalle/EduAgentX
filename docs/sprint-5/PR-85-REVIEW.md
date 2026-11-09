# PR 85 review and stack execution

Review date 9 November 2026. PR head `99233b10c825ac37cb2f9b2927a3685589a104da`. Tested with merged main `a2db4a4` including PR 84 and the database-init serialization fix. Integration is a local review branch, `review/issue34-hero-stack-evidence`.

The catalog declares all nine demonstrations and six fault declarations. Its 48 existing tests pass. The PR description correctly leaves real execution and the Invariant-risk matrix incomplete. Review findings below should be resolved before using these helpers to accept a final Evidence Pack.

## Findings

1. **P1 — Null evidence can satisfy the required artifact set.** `packages/hero-scenarios/src/evidence.js:136` counts artifact names without validating their values. A clean-lifecycle record with every required artifact set to null, a failed check, and `outcome: passed` returns `{valid:true,errors:[]}` from `verifyEvidenceSet`. Reproduced locally. Require nonempty artifact observations or resolvable digest references. Make the distinction between structural record validity and successful scenario acceptance explicit, and reject a successful outcome when required checks failed.
2. **P1 — PEM signing material escapes redaction validation.** `packages/hero-scenarios/src/evidence.js:39` only recognizes a fixed set of key names, compact JWS values, and Bearer-prefixed values. A PEM private key stored under `artifacts.signingMaterial` yields no findings from `findSecrets` and passes record validation. Reproduced with dummy PEM-shaped text. Reject private-key formats independently of property names and retain a regression test for nested values and alternate names.
3. **P2 — Catalog execution defaults drift from the merged stack.** `packages/hero-scenarios/src/scenarios.js:35` pins an old draft package and `dev-ed25519-1`, while current Compose uses the separate test issuer/key and dynamically activated package. Synthetic scenarios name the ordinary unenrolled learner, which cannot establish trusted Marketplace provenance. The execution harness records explicit effective identity, package and key adjustments. Resolve these through an execution-configuration contract rather than silently treating the catalog values as actual run metadata. Its replay fixture references are declarations without matching approved execution captures.

## Execution approach

`scripts/run-hero-stack.py` reuses the existing evidence runner's isolated random-secret Compose setup. `scripts/hero-stack.js` asserts real HTTP outcomes through Registration, Training, Examination, Certification, verification, Redis projection and Marketplace. It records actual IDs and observations with raw JWSs replaced by digests. Scenario faults are injected only into this invocation's isolated stack. Cleanup removes only that project's containers and volumes.

The runner uses `synthetic-executor-dev` for authoritative paths and the existing ordinary synthetic learner for the adversarial/remediation and legacy-exclusion checks. Two additional platform-controlled identities, `hero-near-match-a-dev` and `hero-near-match-b-dev`, are enrolled only for synthetic execution in the isolated configuration. They use the existing auxiliary agent authentication slots, each with its own random secret, to exercise multiple real candidates. Their presence grants no replay or live authority. For fingerprint recovery the runner takes the changed registration through Training and Examination again. Certification is stopped before a passing examination and held unavailable across completion, then restarted. This observes recovery across the required post-completion window without claiming to have interrupted a transaction halfway through its commit.

All fault incidents exported by this harness are explicitly runner-authored observations of the measured fault. They do not establish automatic persistent Monitoring incident coverage. The stack's actual Monitoring snapshot is retained separately.

## Remaining execution limits

- Scenario 5 requires live lifecycle support and reviewed replay captures. Authoritative live provenance is disabled, and `packages/execution-provenance/replay.review.json` contains zero reviews. A refusal observation is not a successful live-to-replay recovery.
- Scenario 9 needs a real Capability Backup to execute another member's setup/scenario and record the acting Primary/new Secondary. The automation cannot attest that another person performed this drill.
- The full Invariant-risk matrix, second-machine reproduction and cumulative Sprint Gate remain separate acceptance work.

## Reproduction

Start Docker Desktop, use Node 24 and Python 3, and run from the review branch root.

```powershell
npm ci --ignore-scripts --no-audit --prefix services/synthetic-agent-learner
node --test packages/hero-scenarios/test/*.test.js
python scripts/run-hero-stack.py
```

The command prints its evidence directory under `evidence/runs/`. Each attempted scenario has a numbered JSON record. `summary.json` contains measured PASS/FAIL/BLOCKED outcomes. `compose-build.txt`, sanitized `compose-logs.txt`, image metadata and cleanup status accompany the observations. Pending/blocker records contain no invented success artifacts or human approvals. The runner exits nonzero for measured failures. BLOCKED remains visible in the summary and prevents a claim that all nine scenarios passed.
