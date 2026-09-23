#!/usr/bin/env bash
# Generates a local-only RS256 keypair for signing/verifying JWTs.
#
# This is dev/test material only - never commit the private key, and
# never reuse these keys anywhere outside a local checkout. `make up`
# calls this automatically if keys/ is empty.
set -euo pipefail

KEY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/keys"
PRIVATE_KEY="${KEY_DIR}/dev-jwt-private.pem"
PUBLIC_KEY="${KEY_DIR}/dev-jwt-public.pem"

mkdir -p "${KEY_DIR}"

if [ -f "${PRIVATE_KEY}" ] && [ -f "${PUBLIC_KEY}" ]; then
  echo "Dev JWT keypair already exists at ${KEY_DIR}, leaving it alone."
  exit 0
fi

echo "Generating local-only RS256 dev keypair at ${KEY_DIR}..."
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "${PRIVATE_KEY}" >/dev/null 2>&1
openssl rsa -pubout -in "${PRIVATE_KEY}" -out "${PUBLIC_KEY}" >/dev/null 2>&1
chmod 600 "${PRIVATE_KEY}"

echo "Done. ${PRIVATE_KEY} and ${PUBLIC_KEY} created (gitignored, local dev only)."