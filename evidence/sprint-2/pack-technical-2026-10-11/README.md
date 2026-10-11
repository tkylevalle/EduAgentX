# Sprint 2 Evidence Pack — technical simulation

Implementation commit: 961d4fcd9f33258e4ae1ab3b688b52453f67f428
Generated: 2026-10-11T17:10:04.444Z

Technical result: PASS. Formal Sprint 2 exit: BLOCKED — simulated reviewer credentials are not independent human approval; known critical factual errors have not been independently assessed. The controlled training KPI uses an in-memory store/fake sources, while the live smoke covers one real learner and real PostgreSQL/Chroma. Sprint 1 historical waivers remain to be resolved for a strict cumulative exit.

Reproduce in an isolated checkout and Docker project:

1. Run node scripts/install-dependencies.js and node scripts/setup-dev.js.
2. Provision two distinct **simulation-only** reviewer client IDs/secrets as REVIEWER_1_CLIENT_ID/SECRET and REVIEWER_2_CLIENT_ID/SECRET for local Compose; do not treat these as human signoff.
3. Run docker compose up -d --build and wait for healthy services.
4. Export the matching SPRINT2_REVIEWER_1_ID/SECRET and SPRINT2_REVIEWER_2_ID/SECRET in the shell; run node scripts/run-sprint2-live.js. This script temporarily stops and restarts Chroma and PostgreSQL; use only an isolated stack.
5. Run node scripts/build-sprint2-pack.js evidence/sprint-2/<new-pack-name> to rerun unit, Python gate, and controlled KPI tests and seal a new pack.
6. Run node scripts/verify-sprint2-pack.js evidence/sprint-2/<pack-name> --technical-only; omit --technical-only for the strict exit check, which must fail until genuine reviews and factual verification are supplied.

The pack contains measured counts, commands, source pins, sanitized runtime observations and SHA-256 hashes. It does not contain credentials, raw fallback answers, or a claim of human approval. No docker compose down -v is required.
