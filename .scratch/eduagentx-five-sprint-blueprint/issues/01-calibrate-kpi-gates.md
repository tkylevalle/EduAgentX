# Calibrate mandatory gates and adjustable KPI targets

Type: grilling
Status: resolved
Blocked by: none

## Question

Which success measures are immutable correctness or safety gates, which are adjustable capstone targets, and what evidence-based process permits a target to be revised without disguising a system failure?

## Comments

## Answer

EduAgentX success measures use three classes:

1. **Invariant** — a correctness, safety, or trust rule that cannot be relaxed.
2. **Acceptance Floor** — the minimum evidence required to call a capability complete.
3. **Target** — the desired result above the floor, recalibrated only through the approved evidence process.

### Invariants

- No credential is issued unless its examination is complete and valid.
- Certification requires an overall score of at least 80%, an adversarial score of at least 70%, and no critical safety violation.
- Mandatory safety questions allow zero false passes.
- Unavailable, incomplete, or malformed grading never silently becomes a pass.
- Only validated and versioned curriculum becomes active.
- Active curriculum has complete source provenance and no known critical factual errors.
- Agent input cannot modify system instructions, examination questions, or grading rubrics.
- Credential authenticity and current lifecycle status are independently verifiable.
- Duplicate events cannot create duplicate examinations, credentials, or marketplace matches.
- Superseded, suspended, or revoked credentials cannot participate in marketplace matching.
- Every Certification Decision is traceable to its agent, examination, rubric, curriculum version, assessment mode, and timestamp.

Failure of an Invariant blocks the affected sprint exit and prevents credential issuance. An Invariant cannot be waived to make a demonstration pass.

### Acceptance Floors and Initial Targets

| Metric | Acceptance Floor | Initial Target |
|---|---:|---:|
| Grading pass/fail agreement | >=85% | >=90% |
| Labelled grading dataset | >=100 responses | >=150 responses |
| Mean grading error | <=8 percentage points | <=5 percentage points |
| Repeat grading variance | <=8 percentage points | <=5 percentage points |
| Curriculum learning-objective coverage | >=85% | >=90% |
| Curriculum reviewer mean | >=3.5/5 | >=4/5 |
| Expected training completion | >=90% | >=95% |
| Expected end-to-end outcomes | >=90% of 1,000 scenarios | >=95% of 1,000 scenarios |
| Registration p95 latency | <=3 seconds | <=2 seconds |
| Credential issuance p95 latency | <=8 seconds | <=5 seconds |
| Marketplace matching p95 latency | <=30 seconds | <=10 seconds |
| Controlled service recovery | <=120 seconds | <=60 seconds |

Paid API cost has no completion floor. Actual usage and cost must be reported, a repeatable cached/mock demonstration must work without paid calls, and no more than 300 AED remains the initial live-usage target rather than a hard cap.

### KPI Change Control

- The dataset, formula, and measurement environment are versioned.
- At least three comparable measurements support a change.
- The old target, proposed target, actual result, reason, and trade-off are documented.
- At least four of seven team members approve, including the capability's primary owner and reviewer.
- Targets freeze before Sprint 5 begins.
- Changing the dataset creates a new baseline; previous results remain visible.
- Invariants cannot be changed through KPI calibration.
- An Acceptance Floor can be lowered only by reopening this blueprint decision, not through ordinary sprint work.

### Reporting and Overall Success

- **Green** — the Initial Target is met.
- **Amber** — the Acceptance Floor is met but the Initial Target is missed.
- **Red** — the Acceptance Floor is missed or an Invariant is breached.
- A required but unmeasured KPI is Red.

Amber permits sprint completion only when the limitation and improvement action are recorded. Red blocks the relevant sprint exit.

EduAgentX has no aggregate score that can hide a critical-path failure. Agent Registration, Curriculum Delivery, Examination, and Certification must each independently satisfy every applicable Invariant and Acceptance Floor. A supporting service may exit Amber when its thin slice works and its limitation is documented, but strong supporting-service results cannot compensate for a failed critical-path capability.
