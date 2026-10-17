# Issue #23 implementation handoff

Base snapshot provided for this change set: `88c5fa784de914f05c6a22f288382e199ef799fe`.

## Delivered in this change set

- Added the isolated `certification-service` and its PostgreSQL-owned schema.
- Added an answer-free Examination evidence route and a durable candidate cursor. The Certification Service polls completed passing attempts and resumes safely after restarts.
- Decisions and signed credentials are inserted in a single transaction, unique per examination, protected from update/delete, and idempotent under repeated or concurrent delivery.
- The project credential uses a W3C VC 2.0 profile signed as compact JWS with Ed25519. Local setup creates an ignored development key pair.
- Added package quarantine checking, standard and fallback score/safety evidence, the protected issuance contract, and p95 reporting with a 5 s target and 8 s maximum.

## Verification

- Certification Service unit/API tests pass, including Ed25519 signature verification, unsafe/incomplete/failed evidence rejection, quarantine rejection, replay/concurrency, and KPI reporting.
- Examination Engine component tests pass (137 tests), including new fallback assessment checks.
- Docker Compose validation and PostgreSQL integration were not run in the authoring environment because Docker is unavailable. Run `docker compose config --quiet`, `make install`, `make test-unit`, and the relevant isolated PostgreSQL test from a clone before merge.

## Trust and timing notes

- Credentials claim EduAgentX project issuance only; they do not claim external accreditation.
- The p95 measures Examination completion to durable credential issuance. The API reports the 5 s target, 8 s acceptance maximum, and service-processing p95; an empty sample is not marked as passing.
- Signing keys for a real deployment require a separately provisioned secret and issuer key publication. The generated key is for local demonstration only.
