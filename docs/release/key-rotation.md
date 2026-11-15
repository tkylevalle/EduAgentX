# Issuer key rotation

The issuer publishes its public keys at `GET /.well-known/jwks.json`
(credential-verification, open through the Gateway). Each key has a `kid`, a
`purpose` and a `status`:

| purpose | Verifies | Signed by |
|---|---|---|
| `credential` | credentials | certification-service (`CERTIFICATION_PRIVATE_KEY_PATH`) |
| `status-list` | the Bitstring Status Lists only, never a credential | credential-verification (`STATUS_LIST_PRIVATE_KEY_PATH`) |

## Rotating the credential key

1. Generate a new Ed25519 pair. Give it a new `kid` under the same issuer
   (for example `…#dev-ed25519-2`).
2. Add the old key to `CREDENTIAL_RETIRED_KEYS` on credential-verification as
   `[{ "kid": "<old kid>", "path": "<old public key file>", "retiredAt": "<now, ISO 8601>" }]`.
3. Point credential-verification at the new public key
   (`CREDENTIAL_PUBLIC_KEY_PATH`, `CREDENTIAL_KEY_ID`) and certification-service
   at the new private key (`CERTIFICATION_PRIVATE_KEY_PATH`, `CERTIFICATION_KEY_ID`).
4. Restart credential-verification, then certification-service. The JWKS now
   lists the new key as `active` and the old one as `retired`.

A retired key verifies only credentials whose `validFrom` is before its
`retiredAt`. **This does not protect against a leaked key.** `validFrom` is
chosen by whoever signs, so anyone holding a leaked retired key can back-date
a forgery. After a leak, remove the key from `CREDENTIAL_RETIRED_KEYS`
entirely (every credential it signed then fails verification) and re-issue
the credentials that should survive.

## Rotating the status-list key

Replace `STATUS_LIST_PRIVATE_KEY_PATH`, `STATUS_LIST_PUBLIC_KEY_PATH` and
`STATUS_LIST_KEY_ID` together and restart credential-verification. Lists are
signed on each request, so every list served afterwards carries the new key;
a list fetched before the change verifies only while the old key is listed.

## Limits

- One status list holds 131,072 credentials. When the index sequence reaches
  that, issuance fails with `status_list_full`; a second list is not built.
- The memory store (tests and local runs without Postgres) restarts its index
  at 0, so against a credential-verification that kept its status file it
  collides and registration is refused. Use Postgres when status matters.
