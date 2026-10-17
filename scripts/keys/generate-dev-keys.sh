#!/bin/sh
# Generates Ed25519 dev/test keys for local development only.
# NEVER commit the output private key files.
# Add keys/dev-private.pem to .gitignore

set -e
KEYS_DIR="$(dirname "$0")"

echo "Generating Ed25519 dev/test keypair..."
openssl genpkey -algorithm ed25519 -out "$KEYS_DIR/dev-private.pem" 2>/dev/null
openssl pkey -in "$KEYS_DIR/dev-private.pem" -pubout -out "$KEYS_DIR/dev-public.pem" 2>/dev/null

echo "✓ dev-private.pem (NEVER commit this)"
echo "✓ dev-public.pem  (safe to commit for verification)"
echo ""
echo "Add to .env:"
echo "  CREDENTIAL_PRIVATE_KEY_PATH=scripts/keys/dev-private.pem"
echo "  CREDENTIAL_KEY_ID=did:example:eduagentx-dev-2026#key-1"
echo "  CREDENTIAL_ISSUER=did:example:eduagentx-dev-2026"
