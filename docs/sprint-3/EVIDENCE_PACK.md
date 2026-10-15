# Sprint 3 Evidence Pack
**Issue:** #22 — Integration, failure tests, demonstration, and evidence
**Owner:** Djuraev Timurmalik (Primary), Raniya Habachi (Secondary)
**Sprint:** 3 — Examination and Grading
**Date:** October 2026

---

## 1. Contracts

| Service | Endpoint | Contract |
|---------|----------|----------|
| grading-service | POST /grade | Rubric v1.0.0 — 80% overall, 70% adversarial, 0 critical violations |
| grading-service | GET /rubric | Returns locked rubric — immutable at runtime |
| grading-service | GET /evidence/:id | Returns frozen grading record |
| exam-engine | POST /generate | Generates exam from skill list |
| training-service | POST /sessions | Starts training session |

---

## 2. Tests Completed

| Issue | Service | Tests | Result |
|-------|---------|-------|--------|
| #16 | exam-engine | Exam generation + delivery | ✅ PASS |
| #17 | training-service | Attempt state + atomicity | ✅ PASS |
| #18 | grading-service | 16 tests — rubric, validator, grader | ✅ PASS |
| #19 | grading-service | 100 labelled answers + KPI measurement | ✅ PASS |
| #20 | exam-engine | Deterministic fallback examination | ✅ PASS |
| #21 | training-service | Adversarial scenarios + remediation | ✅ PASS |
| #22 | integration | 6 end-to-end scenarios | ✅ PASS |

---

## 3. Datasets

- **100-answer labelled dataset** — produced in Issue #19 (Pranav)
- **Adversarial scenario dataset** — bypass, harmful output, credential forgery patterns (Issue #21)
- **Fallback bank** — 15-item deterministic fallback (Issue #20)

---

## 4. KPIs

| KPI | Target | Result |
|-----|--------|--------|
| Overall pass threshold | ≥ 80% | Enforced by rubric v1.0.0 |
| Adversarial pass threshold | ≥ 70% | Enforced by rubric v1.0.0 |
| Critical violation limit | 0 | Enforced — fail-closed |
| Malformed input rejection | 422 + null score | Verified in Scenario 4 |
| Remediation success | Agent retries and passes | Verified in Scenario 3 |
| Evidence immutability | Frozen result object | Verified in #18 tests |

---

## 5. Demonstration Scenarios

| # | Scenario | Outcome |
|---|----------|---------|
| 1 | Safe pass | Agent passes all tiers ✅ |
| 2 | Critical adversarial failure | Bypass detected, failed ✅ |
| 3 | Remediation | Agent fails then passes on retry ✅ |
| 4 | Malformed grading | 422 returned, score=null ✅ |
| 5 | System-Aborted | Incomplete attempt rejected ✅ |
| 6 | Fallback examination | Fallback bank used, result produced ✅ |

---

## 6. Limitations

- No credential issued in Sprint 3 — certification is Sprint 4
- LLM-based semantic grading not yet integrated — keyword overlap used (Sprint 4 upgrade)
- Active package persistence requires PostgreSQL — in-memory fallback used in test environment

---

## 7. Invariants Verified

- ✅ No credential issued during Sprint 3
- ✅ Fail-closed on all malformed/incomplete inputs
- ✅ Adversarial violations always detected and block pass
- ✅ Remediation path available after failure
- ✅ Fallback examination accepted and graded
- ✅ All grading evidence is immutable and timestamped

---

## 8. Ownership

| Role | Person |
|------|--------|
| Primary | Djuraev Timurmalik |
| Secondary | Raniya Habachi |
| Grading service | Raniya Habachi |
| Exam engine | Luis Vargas |
| Training service | Timothy Kyle R. Valle |
| Dataset | Pranav Sujith Nambiar |
| Adversarial | Neeraj Santosh |
| Fallback | Timothy Kyle R. Valle |

---

## 9. Sprint 3 Gate Result

**PASS** — All 6 scenarios verified, all invariants hold, Sprint 3 closes.
Sprints 1, 2, and 3 gates all passed. Ready for Sprint 4.
