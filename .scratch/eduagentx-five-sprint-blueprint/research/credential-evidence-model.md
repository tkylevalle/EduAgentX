# EduAgentX credential evidence model

Research date: 2026-08-13
Decision scope: lightweight signing, verification, and status evidence for a seven-person capstone

## Recommendation

Use a **W3C Verifiable Credentials Data Model 2.0 credential secured as a compact JWS with an Ed25519 (`alg: EdDSA`) digital signature**, plus W3C Bitstring Status List v1.0 entries for suspension and revocation.

The smallest credible implementation has four public artifacts:

1. the exact signed credential (`application/vc+jwt`);
2. an HTTPS issuer document exposing the active and historical public verification keys;
3. signed suspension and revocation status-list credentials; and
4. a verifier page/API that reports signature, schema, time, status, and local policy results separately.

This is feasible without blockchain, a DID network, an external certificate authority, a wallet, OpenID credential exchange, a hardware security module, or a paid credential platform. Those are ecosystem or production-hardening features, not prerequisites for demonstrating cryptographic authorship and tamper evidence.

The W3C data model defines a verifiable credential as a tamper-evident credential whose authorship can be cryptographically verified. It also explicitly warns that verifying a credential **does not establish that its claims are true**; a verifier must decide whether it trusts the issuer and claims under its own policy ([W3C VC Data Model 2.0, terminology and trust model](https://www.w3.org/TR/vc-data-model-2.0/#terminology), [trust model](https://www.w3.org/TR/vc-data-model-2.0/#trust-model)). Therefore this design proves “EduAgentX issued this unaltered statement and has not suspended or revoked it,” not “an external authority accredits this agent.”

## Why a bare SHA-256 hash is insufficient

| Design | Detects a changed copy | Proves who issued it | Independently verifiable | Safe conclusion |
|---|---:|---:|---:|---|
| SHA-256 stored beside the same database record | Only if the attacker cannot replace both value and hash | No | No; the verifier needs a separately trusted hash | The bytes match another digest value |
| Publicly posted SHA-256 digest | Yes, if the publication channel is already trusted | Only indirectly through that channel | Partly | The bytes match what that channel published |
| HMAC | Yes | Only to parties sharing the secret | No third-party proof; every verifier can forge | A party holding the shared secret created or accepted it |
| Digital signature | Yes | Yes, relative to the trusted public-key/issuer binding | Yes; the private key remains with the issuer | The holder of the issuer private key signed these exact bytes |

A hash is not an issuer authentication mechanism. Anyone can edit a credential and compute a new SHA-256 value. A digital signature instead uses a private key to sign and a public key to verify; NIST describes digital signatures as detecting unauthorized modification and authenticating the signatory ([NIST FIPS 186-5 overview](https://csrc.nist.gov/pubs/fips/186-5/final)). JWS provides integrity protection over the payload and protected header ([RFC 7515](https://www.rfc-editor.org/rfc/rfc7515.html)), and RFC 8037 defines `EdDSA` with `Ed25519` for JWS ([RFC 8037 section 3.1](https://www.rfc-editor.org/rfc/rfc8037.html#section-3.1)).

Keep a digest only for **linking supporting evidence**, not as the credential's authenticity proof. For example, an assessment-result artifact can be referenced through `relatedResource` with a `digestSRI`; the VC 2.0 specification defines verification behavior for such related-resource digests and recommends SHA-384 as the minimum strength for that feature ([VC Data Model 2.0, Integrity of Related Resources](https://www.w3.org/TR/vc-data-model-2.0/#integrity-of-related-resources)).

## Minimum credential profile

Issue one immutable credential artifact per successful certification decision. Use a stable, project-controlled HTTPS base URL in deployed environments and a configurable equivalent in local demonstrations.

Required profile:

- `@context`: W3C VC v2 context followed by a versioned, static EduAgentX context;
- `id`: globally unique credential URL containing an issuance UUID;
- `type`: `VerifiableCredential` and `EduAgentXCompetencyCredential`;
- `issuer`: the EduAgentX issuer URL, labelled plainly as the EduAgentX capstone/project;
- `validFrom` and `validUntil`;
- `credentialSubject.id`: the registered agent's stable identifier;
- competency claim: curriculum/track ID and version, achieved level, and outcome;
- assessment claim/evidence: exam-attempt ID, exam-template version, grading-policy version, assessment mode (`standard` or `fallback`), total score, adversarial-section score, and critical-safety result;
- `credentialSchema`: versioned JSON Schema URL for structural validation;
- two `credentialStatus` entries: one `suspension`, one `revocation`;
- an explicit project-scope notice or `termsOfUse` URL.

Do not embed raw exam answers, prompts, personal data, model secrets, or hidden grader rationale. The W3C model provides `evidence` for supporting information that can increase a verifier's confidence and distinguishes it from the securing mechanism that proves issuer authenticity and credential integrity ([VC Data Model 2.0, Evidence](https://www.w3.org/TR/vc-data-model-2.0/#evidence)). Store detailed assessment records internally; expose only a pseudonymous attempt identifier and, if needed, an integrity-protected evidence summary.

Illustrative unsecured payload (names in the EduAgentX context remain to be finalized):

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://eduagentx.example/contexts/competency/v1"
  ],
  "id": "https://eduagentx.example/credentials/7d4b...",
  "type": ["VerifiableCredential", "EduAgentXCompetencyCredential"],
  "issuer": "https://eduagentx.example/issuers/eduagentx",
  "validFrom": "2026-08-13T10:00:00Z",
  "validUntil": "2027-08-13T10:00:00Z",
  "credentialSubject": {
    "id": "https://eduagentx.example/agents/0f90...",
    "competency": {
      "trackId": "ai-safety-fundamentals",
      "curriculumVersion": "1.0.0",
      "level": "fundamentals",
      "result": "pass"
    }
  },
  "credentialSchema": {
    "id": "https://eduagentx.example/schemas/competency/v1.json",
    "type": "JsonSchema"
  },
  "evidence": {
    "type": "EduAgentXAssessmentEvidence",
    "examAttemptId": "urn:uuid:1f17...",
    "examTemplateVersion": "1.0.0",
    "gradingPolicyVersion": "1.0.0",
    "assessmentMode": "standard",
    "totalScore": 86,
    "adversarialScore": 80,
    "criticalSafetyViolation": false
  },
  "credentialStatus": [
    {
      "type": "BitstringStatusListEntry",
      "statusPurpose": "suspension",
      "statusListIndex": "73104",
      "statusListCredential": "https://eduagentx.example/status/suspension/1"
    },
    {
      "type": "BitstringStatusListEntry",
      "statusPurpose": "revocation",
      "statusListIndex": "73104",
      "statusListCredential": "https://eduagentx.example/status/revocation/1"
    }
  ],
  "termsOfUse": {
    "type": "EduAgentXProjectCredentialPolicy",
    "id": "https://eduagentx.example/policies/credential/v1"
  }
}
```

The signed artifact is a compact JWS whose payload is this VC document. Use protected headers similar to:

```json
{
  "alg": "EdDSA",
  "kid": "https://eduagentx.example/issuers/eduagentx#key-2026-01",
  "typ": "vc+jwt",
  "cty": "vc"
}
```

W3C's JOSE/COSE Recommendation defines JWS as a securing mechanism for VC 2.0, requires compact JWS support, and specifies `application/vc+jwt`; when an issuer is identified by a URL, it supports an absolute `kid` referring to a verification method in a controlled identifier document ([Securing Verifiable Credentials using JOSE and COSE](https://www.w3.org/TR/vc-jose-cose/#with-jose), [key discovery](https://www.w3.org/TR/vc-jose-cose/#key-discovery)).

## Issuer identity and key management

Use one issuer signing key at a time for the MVP:

- Generate an Ed25519 key pair with a maintained cryptographic library; do not implement cryptography manually.
- Publish only the public JWK in the issuer document. Include the key under the issuer's assertion/verification relationship and use the same absolute URL as the JWS `kid`.
- Inject the private key into the Certification Service as a Docker secret or mounted, access-restricted secret file. Never commit it, bake it into an image, expose it through an API, or store it beside credentials in ordinary database tables.
- Use separate development/test and demonstration/deployment keys.
- Record the `kid` on every issuance event. For rotation, add a new key and make it active for new credentials while retaining old public keys for old signatures.
- If a private key is exposed, stop issuance, suspend affected credentials, publish a replacement key, and reissue/revoke according to the incident decision. Key compromise cannot be repaired by silently deleting the old public key.

This is key-pinned issuer authentication, not a public certification-authority chain. For a local/offline demo, configure the verifier with the expected issuer URL and a pinned copy/thumbprint of its public key. For a deployed demo, serve the issuer document over HTTPS and pin the expected issuer in verifier policy. A self-contained `did:key` can be a future alternative, but it does not by itself establish that the key represents the EduAgentX project; the trust binding still has to come from verifier policy.

## Status and lifecycle evidence

Use [W3C Bitstring Status List v1.0](https://www.w3.org/TR/vc-bitstring-status-list/) rather than a mutable `status` column as the external status proof. The standard defines `suspension` as reversible and `revocation` as irreversible, uses a compact signed status-list credential, and defines retrieval and validation algorithms. Its uncompressed minimum is 16 KB/131,072 entries, but a mostly-zero list compresses efficiently; this is acceptable for the expected capstone scale.

Implementation profile:

- allocate one unique random index per issued credential;
- expose separate signed status-list credentials for suspension and revocation to keep lifecycle semantics obvious;
- sign each status-list credential with the same issuer mechanism used for competency credentials;
- update the status list from append-only lifecycle events, then atomically publish the newly signed list;
- retain issuance and status events in PostgreSQL for audit, but treat the signed credential plus signed status list as the portable verification evidence;
- allow a recently cached, correctly signed status list within a documented TTL; if neither a live nor acceptable cached list is available, return `INDETERMINATE_STATUS`, never `VALID`.

Do not mutate and re-sign an already issued credential to change its status. Status changes are separate lifecycle facts. A renewed or materially changed credential receives a new ID, signature, validity period, and evidence versions.

## Verification contract

`GET /verify/{credentialId}` may provide a convenient UI/API, but verification must be reproducible from the signed artifacts and public key. Its algorithm should:

1. Parse the compact JWS and reject `alg: none`, unapproved algorithms, malformed headers, and unexpected media types.
2. Resolve `kid` only from the configured EduAgentX issuer document; reject an unknown key or issuer.
3. Verify the Ed25519 signature over the exact JWS signing input.
4. Validate the VC 2.0 required fields and the versioned EduAgentX JSON Schema.
5. Check `validFrom` and `validUntil` against the verifier's clock.
6. Retrieve and cryptographically verify both signed status-list credentials; check the assigned index for suspension and revocation.
7. Apply local policy: accepted curriculum version, grading policy, assessment mode, score thresholds, and any re-certification rule.
8. Return structured results, not one ambiguous boolean.

Recommended result fields:

```json
{
  "signatureAuthentic": true,
  "documentConformant": true,
  "withinValidityPeriod": true,
  "suspended": false,
  "revoked": false,
  "issuerAcceptedByPolicy": true,
  "credentialAcceptedByPolicy": true,
  "overall": "VALID",
  "checkedAt": "2026-08-13T10:05:00Z",
  "reasonCodes": []
}
```

Keep these meanings distinct:

- **authentic**: signature verifies against the expected EduAgentX key;
- **tamper-evident**: a payload/header modification makes verification fail;
- **current**: within its validity interval and neither suspended nor revoked;
- **accepted**: meets this verifier's curriculum, grading, and assessment-mode rules;
- **accredited**: an external authority has recognized it—**not claimed by this system**.

## Honest positioning

Use: **“Cryptographically verifiable EduAgentX competency credential.”**

Display this qualification on the credential and verification page:

> Issued by the EduAgentX project under its published curriculum and assessment policy. Verification confirms EduAgentX authorship, document integrity, and current status. It does not imply accreditation, endorsement, or acceptance by a university, regulator, government, or industry certification body.

This language follows the W3C distinction between verification and validation: cryptographic verification does not prove claim truth, and the VC data model does not create transitive certificate-authority trust ([VC Data Model 2.0 terminology](https://www.w3.org/TR/vc-data-model-2.0/#terminology), [trust model](https://www.w3.org/TR/vc-data-model-2.0/#trust-model)). Avoid “internationally recognized,” “industry certified,” “university accredited,” or equivalent claims unless an identified external authority formally provides that recognition.

## MVP acceptance tests

The credential design is credible when automated tests demonstrate all of the following:

1. A credential issued through the approved certification decision verifies with the published public key.
2. Changing any signed claim, score, subject, issuer, validity date, evidence reference, or status-list pointer makes signature verification fail.
3. A random or attacker-generated SHA-256 digest cannot substitute for a valid signature.
4. An unknown `kid`, wrong issuer, disallowed algorithm, or `alg: none` fails closed.
5. Expired, not-yet-valid, suspended, and revoked credentials produce distinct non-valid results.
6. Tampering with a status-list credential makes the status check fail; status retrieval failure produces `INDETERMINATE_STATUS`, not `VALID`.
7. Suspension can be reversed; revocation cannot be reversed through the public API.
8. Key rotation allows old credentials to verify with retained historical public keys and new credentials to verify with the new key.
9. The same certification event is idempotent and cannot create duplicate active credentials.
10. A verification result always names the issuer, signature algorithm/key ID, curriculum version, grading-policy version, assessment mode, current status, and project-only trust limitation.

## Deferred, not required for the capstone MVP

- holder wallets and verifiable presentations;
- OpenID for Verifiable Credential Issuance/Presentation;
- selective disclosure or zero-knowledge proofs;
- decentralized ledgers and general-purpose DID resolution;
- external accreditation or trust registries;
- HSM/KMS-backed signing, multi-signature, timestamping authorities, or transparency logs.

These can deepen a later product, but none should delay the core registration → curriculum → examination → certification demonstration.

## Decision summary

Replace “SHA-256 hash proves credential authenticity” with:

> EduAgentX issues a W3C VC 2.0 competency credential secured by an Ed25519 compact JWS. Verifiers use the project-published public key to authenticate the issuer and detect any modification, then check signed W3C status lists, validity dates, schema, and their own acceptance policy. Hashes remain optional links to supporting assessment evidence; they are not issuer proofs. The credential is project-issued and cryptographically verifiable, not externally accredited.

## Primary sources

- [W3C Verifiable Credentials Data Model v2.0, Recommendation, 15 May 2025](https://www.w3.org/TR/vc-data-model-2.0/)
- [W3C Securing Verifiable Credentials using JOSE and COSE, Recommendation, 15 May 2025](https://www.w3.org/TR/vc-jose-cose/)
- [W3C Bitstring Status List v1.0, Recommendation, 15 May 2025](https://www.w3.org/TR/vc-bitstring-status-list/)
- [IETF RFC 7515, JSON Web Signature](https://www.rfc-editor.org/rfc/rfc7515.html)
- [IETF RFC 8037, EdDSA for JOSE](https://www.rfc-editor.org/rfc/rfc8037.html)
- [NIST FIPS 186-5, Digital Signature Standard](https://csrc.nist.gov/pubs/fips/186-5/final)
