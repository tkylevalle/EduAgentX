# Threat model

Method: STRIDE (Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege) applied to each trust boundary. Evidence tags are explained in `README.md`.

## 1. What EduAgentX protects

| Asset | Why it matters |
|---|---|
| Signed credentials (W3C VC 2.0, Ed25519) | They are the product. A forged or wrongly issued credential defeats the platform |
| Signing key and JWT key | Anyone holding them can mint trust |
| Agent identities and configuration fingerprints | A credential is only meaningful for the configuration that earned it |
| Course packages | They define what "competent" means. A poisoned package certifies the wrong thing |
| Examination attempts and grading evidence | They are the proof behind each credential |
| Internal service keys | They let one service act as another |
| Marketplace eligibility decisions | They decide which agent is recommended for a request |

## 2. Who interacts with the system

| Actor | Trust level |
|---|---|
| Agent Learner (the agent under test) | Untrusted. It chooses its own key, answers and behaviour |
| Model provider behind an agent | Untrusted |
| Administrator using the Console | Trusted, read-only in the Console |
| Package reviewer | Trusted, two distinct reviewers required |
| Platform services | Trusted inside the Compose network, authenticated by internal keys |
| Network attacker or malicious insider | Assumed possible |

## 3. Trust boundaries

```
TB1  Agent Learner ──JWT──▶ API Gateway                      (only public entry point)
TB2  API Gateway ──HTTP + internal key──▶ owning services
TB3  Services ──▶ PostgreSQL schema (own role), Redis Streams
TB4  Certification ──signed credential──▶ Verification, Marketplace
TB5  Executor / learner ──responses──▶ Training and Examination   (execution provenance)
TB6  Operator ──▶ Assurance Console, Evidence Bundle export
TB7  Repository and CI ──▶ secrets, release evidence
```

## 4. Threats

Severity is the author's estimate: low, medium or high, taking the local capstone setting into account.

| ID | Boundary | STRIDE | Threat | Controls that exist | Residual risk or gap | Test cases |
|---|---|---|---|---|---|---|
| T01 | TB1 | Spoofing | An attacker uses a token to act as another agent | RS256 JWT, role and identity checks `[ARCH]`. Registration key must match the token subject `[TP]` | Token lifetime and revocation policy not documented `[TO VERIFY]` | TC_GW_001, TC_GW_002, TC_SEC_002, TC_SEC_003 |
| T02 | TB1 | Elevation | An agent token calls an administrator route | Role checks at the Gateway `[ARCH]` | Low | TC_GW_003 |
| T03 | TB1 | Denial of service | Request flooding exhausts the service | Rate limit of 600 requests per 60 seconds per client `[TP]` | Limit values are not tuned or load-tested for abuse | TC_GW_004, TC_SEC_006 |
| T04 | TB1 | Tampering | Malformed envelope or replayed request | Envelope validation, idempotency keys, replay returns the original result, changed body returns 409 `[TP]` | Low | TC_EXM_003, TC_SEC_007, TC_SEC_008 |
| T05 | TB5 | Spoofing, repudiation | An agent claims it ran live or as a replay when it did not | Only platform-controlled, configured executors can attest. Caller labels, provider and model names grant no authority. Certification validates before signing. Marketplace checks provenance again `[PR84]` | Executor enrollment and key custody have not had an independent review. Salman asked reviewers to focus there `[PR84]` | TC_SEC_012 |
| T06 | TB5 | Tampering, elevation | A hostile agent follows an injected instruction or calls a tool unsafely | Critical rules are graded separately from the score and block a pass. Tests use simulated tools and isolated learners `[PR90]` | The grader is a keyword rubric and the grading-quality KPI is Red `[PR90]`. Test learners are deterministic, not real adversaries | TC_GRD_002 |
| T07 | TB5 | Tampering | An agent supplies its own replay answers | Runtime uploads and replacement responses are refused. Replay uses 40 versioned captures kept in the repository `[PR84]` | Captures are synthetic, not real model output `[PR84]` | TC_SEC_012 |
| T08 | TB4 | Tampering | A signed credential is edited | Ed25519 signature and seven separate verification checks `[TP]` | Low | TC_VER_002 |
| T09 | TB4 | Spoofing | A credential from an unknown issuer or with a weak algorithm | Only EdDSA accepted. Issuer policy check `[TP]`. Marketplace checks the exact lifecycle origin `[PR84]` | Dev issuer key `dev-ed25519-1` is a test key `[TP]` | TC_VER_005, TC_SEC_011 |
| T10 | TB4 | Elevation, repudiation | Someone suspends or revokes a credential without permission | Revocation is permanent, suspension is reversible, status history is kept `[TP]` | Authentication on suspend and revoke `[TO VERIFY]` | TC_VER_003, TC_VER_004, TC_VER_006 |
| T11 | TB4, TB6 | Information disclosure | Credentials or evidence leak answers or secrets | Certification evidence is answer-free `[ARCH]`. Evidence bundle redacts raw answers, keys and tokens `[TP]`. Logs use an allowlist and never include errors, bodies, headers or URLs `[ARCH]` | Redaction list is a fixed set of key names, so a new sensitive field must be added by hand | TC_EVB_002, TC_SEC_010, TC_SEC_015 |
| T12 | TB3 | Tampering, elevation | A compromised service writes another service's data | One PostgreSQL schema per service with its own restricted role that cannot write other schemas `[ARCH]` | Redis access control between services `[TO VERIFY]` | TC_SEC_004 |
| T13 | TB3 | Repudiation | Audit history is altered | Append-only assurance events, immutable examination attempts and match results `[ARCH]` | Database administrators can still alter rows | none yet |
| T14 | TB2 | Spoofing | A caller reaches an internal service directly | Every host port binds to 127.0.0.1. Validation is local only, Certification is internal only, Marketplace has no host port `[ARCH]`. Internal routes need an internal key plus actor headers `[TP]` | Internal keys are shared secrets and no rotation procedure is documented `[TO VERIFY]` | TC_SEC_004, TC_SEC_005 |
| T15 | TB6 | Tampering | The Console is used to change data | Console is read-only. Mutation methods get 404 or 405 `[TP]` | Low | TC_CON_002, TC_SEC_016 |
| T16 | TB6 | Elevation | Script injected through an agent-influenced field runs in the administrator's browser | The older server-rendered console page escapes output `[REV]` | **The `/console` page does not escape** the values it renders, such as agent identity, scope and reason. Which of them an agent can influence has not been traced. See finding F-01 `[REV]` | TC_SEC_001 |
| T17 | TB7 | Information disclosure | Secrets committed to the repository | Secrets come from the environment with no fallback values `[ARCH]`. Release gate refuses tracked `.env` files, key files, private key blocks, signed tokens and provider API keys `[PR88]` | The scan covers text files up to 2 MB `[PR88]` | TC_SEC_009 |
| T18 | TB7 | Tampering, repudiation | Fabricated or stale evidence is presented as a passed gate | Committed gate runs are hashed and never edited `[ARCH]`. Sprint records must quote the source fingerprint and a real commit `[PR88]` | Hand-written placeholder results did reach main and were removed. See F-02 | none yet |
| T19 | TB7 | Tampering | A vulnerable or malicious dependency | Per-service lockfiles and `npm ci` `[REV]` | No vulnerability scan or software bill of materials documented `[TO VERIFY]` | TC_SEC_014 |
| T20 | TB4 | Tampering | A poisoned course package certifies the wrong skills | Official sources pinned by SHA-256, validation gates, two distinct reviewers, immutable digests, quarantine for critical corrections `[ARCH]` | Quality of review depends on the reviewers | none yet |
| T21 | all | Denial of service, elevation | A dependency outage leads to an unsafe pass | Fail closed. Missing, conflicting or unavailable authority excludes the candidate `[PR84]` | Low | TC_CRT_004 |
| T22 | TB5 | Tampering | A live run overspends its budget | Proposed bounds on calls, tokens, runtime and spend | Live adapter has no durable budget accounting, so live provenance stays off `[PR84]` | TC_SEC_017 |

## 5. Top priorities

1. Fix the Console escaping (F-01). It is a code change of a few lines.
2. Independent review of executor enrollment and key custody (F-05).
3. Add budget accounting before live provenance is enabled (F-03).
4. Improve grading quality or add a second grader or a human sample (F-04).
5. Record a dependency audit baseline (F-06).
6. Document internal key handling and rotation (F-07).

## 6. Assumptions

- The demonstration runs locally and all ports bind to 127.0.0.1.
- Traffic between services is plain HTTP inside the Compose network `[ARCH]`. This is acceptable for the capstone and would need mutual TLS in production.
- Development keys and identities (`dev-ed25519-1`, `*-dev` learners) are never used outside a local checkout.
