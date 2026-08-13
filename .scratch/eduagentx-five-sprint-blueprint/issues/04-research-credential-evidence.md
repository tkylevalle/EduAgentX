# Select a verifiable competency-credential evidence model

Type: research
Status: resolved
Blocked by: none

## Question

What lightweight standards-based signing and verification design should replace a bare database hash so that EduAgentX competency credentials are demonstrably authentic and tamper-evident without claiming external accreditation?

## Comments

- Research artifact: [EduAgentX credential evidence model](../research/credential-evidence-model.md)

## Answer

Issue an immutable W3C Verifiable Credentials Data Model 2.0 competency credential secured as a compact JWS using Ed25519 (`alg: EdDSA`). Publish the issuer's active and historical public verification keys over HTTPS, and represent reversible suspension and irreversible revocation through separately signed W3C Bitstring Status List credentials.

A bare SHA-256 value stored beside a database record does not authenticate the issuer because an attacker can replace both the data and its hash. Retain hashes only for linking supporting evidence; use the digital signature for authorship and tamper evidence.

The verifier must separately report signature authenticity, schema conformance, validity period, suspension, revocation, issuer policy, credential policy, and reason codes. Unavailable status evidence returns `INDETERMINATE_STATUS`, never `VALID`. Credential evidence includes the curriculum, exam-template and grading-policy versions, assessment mode, scores, critical-safety result, and project-only trust notice without exposing raw responses or grader secrets.

Position the result as a **cryptographically verifiable EduAgentX competency credential**, not as university, regulatory, or industry accreditation. Wallets, blockchains, DID networks, OpenID credential exchange, external trust registries, selective disclosure, and production key-management infrastructure remain deferred.

The complete profile, key-management rules, lifecycle semantics, verification algorithm, acceptance tests, and primary standards are documented in the linked research artifact.
