# Control mapping

Controls that exist in EduAgentX, mapped to two reference frameworks:

- NIST Cybersecurity Framework 2.0, category level (GV Govern, ID Identify, PR Protect, DE Detect, RS Respond, RC Recover).
- OWASP Top 10 for LLM Applications, 2025 edition.

Evidence tags are explained in `README.md`.

## 1. Controls

| ID | Control | Evidence | NIST CSF 2.0 | OWASP LLM 2025 | Status |
|---|---|---|---|---|---|
| C01 | Gateway is the only public entry. Every host port binds to 127.0.0.1 | `[ARCH]` | PR.IR | none | In place |
| C02 | RS256 JWT with role and identity checks | `[ARCH]` | PR.AA | none | In place |
| C03 | Registration key must match the token subject | `[TP]` | PR.AA | none | In place |
| C04 | Rate limiting, 600 requests per 60 seconds per client | `[TP]` | PR.IR | LLM10 | In place, not load-tested |
| C05 | Envelope validation, idempotency keys, replay protection | `[TP]` `[ARCH]` | PR.DS | none | In place |
| C06 | One schema and one restricted role per service | `[ARCH]` | PR.AA | none | In place |
| C07 | Secrets from the environment, no fallback values, health returns 503 if one is missing | `[ARCH]` | PR.PS | LLM02 | In place |
| C08 | Allowlisted logging with correlation IDs, no bodies, headers, URLs or error objects | `[ARCH]` | DE.CM | LLM02 | In place |
| C09 | Release gate secret scan | `[PR88]` | PR.DS | LLM02 | In pull request 88 |
| C10 | Platform-controlled executor attestation of execution provenance | `[PR84]` | PR.AA, PR.DS | none | Merged, independent review pending |
| C11 | Critical-rule grading, separate from the score | `[PR90]` | DE.AE | LLM01, LLM06 | In place, grader quality limited |
| C12 | Simulated tools, isolated learners, test keys in all scenarios | `[PR90]` | PR.PS | LLM06 | In place for tests |
| C13 | Ed25519 credentials with seven independent verification checks | `[TP]` | PR.DS | none | In place |
| C14 | Reversible suspension, permanent revocation, status history | `[TP]` | RS.MI | none | In place |
| C15 | Fail closed with Safe States Blocked, Quarantined and Indeterminate | `[PR84]` | RS.MI, RC.RP | none | In place |
| C16 | Exactly-once certification with a durable cursor and recovery | `[ARCH]` `[TP]` | RC.RP, PR.IR | none | In place |
| C17 | Package validation gates, two distinct reviewers, pinned official sources, immutable digests | `[ARCH]` | GV.SC, PR.DS | LLM03, LLM04 | In place |
| C18 | Freshness review and scoped quarantine of curriculum | `[ARCH]` | RS.MI, GV.SC | LLM04 | In place |
| C19 | Rebuildable curriculum index, never the source of truth | `[ARCH]` | PR.DS, RC.RP | LLM08 | In place |
| C20 | Monitoring: posture, health shows Unknown after 15 seconds, attention records | `[TP]` | DE.CM, DE.AE | none | In place |
| C21 | Evidence bundle redaction and digests | `[TP]` | PR.DS | LLM02 | In place |
| C22 | Read-only Console with no mutation routes | `[TP]` | PR.AA | none | In place for the main page, gap on `/console` (F-01) |
| C23 | Hashed gate-run evidence bound to a source fingerprint and real commits | `[ARCH]` `[PR88]` | ID.IM, GV.OV | none | In place |

## 2. OWASP Top 10 for LLM Applications, 2025

EduAgentX certifies external agents. It does not call a language model itself today, because grading is a keyword rubric. So some risks apply to the agents under test and some to the platform.

| Risk | Applies to | How EduAgentX deals with it | Status |
|---|---|---|---|
| LLM01 Prompt Injection | Agent under test | Adversarial examination items and critical rules that block a pass `[PR90]` | Covered for agents. Not applicable to the platform until an LLM grader is added |
| LLM02 Sensitive Information Disclosure | Both | Secret-protection adversarial cases for agents `[PR90]`. Redaction, allowlisted logs and no secrets in the repository for the platform | Covered |
| LLM03 Supply Chain | Platform | Official sources pinned by SHA-256, per-service lockfiles | Partial: no dependency scanning |
| LLM04 Data and Model Poisoning | Platform | Package review, immutable digests, quarantine | Partial: depends on reviewers |
| LLM05 Improper Output Handling | Platform | Server-rendered console page escapes output `[REV]` | **Open: `/console` does not escape (F-01)** |
| LLM06 Excessive Agency | Agent under test | Unsafe tool use is a critical violation. Tools are simulated in tests | Covered for agents |
| LLM07 System Prompt Leakage | Platform | Registration carries a hash of the system prompt, not the prompt `[TP]` | Covered by design |
| LLM08 Vector and Embedding Weaknesses | Platform | Index is rebuilt from the Active package only and is never the source of truth `[ARCH]` | Partial: access control on the index `[TO VERIFY]` |
| LLM09 Misinformation | Platform | Locked rubric and thresholds | **Open: grading-quality KPI is Red `[PR90]` (F-04)** |
| LLM10 Unbounded Consumption | Both | Rate limit. Proposed bounds on live runs | Partial: no budget accounting for live runs (F-03) |

## 3. NIST CSF 2.0 coverage by function

| Function | Controls |
|---|---|
| Govern | C17, C18, C23 |
| Identify | C23 |
| Protect | C01 to C10, C12, C13, C16, C17, C19, C21, C22 |
| Detect | C08, C11, C20 |
| Respond | C14, C15, C18 |
| Recover | C15, C16, C19 |

Identify is the thinnest function. The platform has no asset inventory or risk register of its own. This pack is the first version of both.
