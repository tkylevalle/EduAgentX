# Sprint 1 — Meeting Minutes
**Owner:** Timothy Kyle R. Valle (Scribe & Documentation Lead)
**Date:** Week of September 23, 2026
**Attendees:** Raniya, Salman, Pranav, Luis, Djuraev, Neeraj, Timothy

---

## Agenda
1. Sprint 1 review — what was completed
2. Docker verification
3. Sprint 2 kickoff assignments
4. Mentor meeting prep

---

## Sprint 1 Completed
- PR #37 — Docker platform (Timothy): docker-compose, all service stubs, Makefile, scripts
- PR #38 — API Gateway auth (Salman): JWT RS256, role-based middleware, smoke tests
- PR #39 — Agent Registry (Pranav): full CRUD, PostgreSQL persistence, schema
- PR #40 — External protocol (NXRJ): synthetic agent adapter
- PR #41 — Env config (Timurmalik): .env, resource limits, ENV_REFERENCE.md
- PR #42 — API contracts (Luis): shared/API_CONTRACTS.md, all 8 services documented
- PR #43 — Course skills (Neeraj): courses/course_001, 10 skills, exam_001.json
- PR #44 — KPIs & checklist (Raniya): SPRINT1_KPIS_CHECKLIST.md

## Docker Verification
All 5 containers confirmed healthy:
- eduagentx-postgres ✅
- eduagentx-redis ✅
- eduagentx-agent-registry ✅
- eduagentx-api-gateway ✅
- eduagentx-assurance-console ✅

## Sprint 2 Assignments
- Raniya — Certification Service (POST /certify, JWT cert generation)
- Salman — Expand API Gateway routes for Sprint 2 services
- Pranav — Expand Agent Registry (skill update, agent comparison)
- Luis — Curriculum Engine + ChromaDB integration
- Djuraev — Training Session Service (send Hermes to course folder)
- Neeraj — Exam Generation Service (LLM-based question generation)
- Timothy — Prometheus/Grafana monitoring + Marketplace scaffold

## Mentor Meeting Prep
- Show GitHub repo: 8 PRs merged, 36 issues backlog
- Live Docker demo: docker compose up, all containers green
- Walk through architecture: Teacher → Course Folder → Hermes → Exam → Certificate
- Present Sprint 2 plan and Trimester 2 timeline

## Next Meeting
Week 2 — October 6, 2026
