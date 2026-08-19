#!/usr/bin/env bash
# smoke test - only talks to the gateway, never touches postgres/redis
# directly (that's the point - proves the whole path works)
set -euo pipefail

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

GATEWAY_PORT="${GATEWAY_PORT:-8080}"
GATEWAY_TEST_TOKEN="${GATEWAY_TEST_TOKEN:-local-dev-test-token}"
BASE_URL="http://localhost:${GATEWAY_PORT}"
CORRELATION_ID="smoke-$(date +%s)"

fail() {
  echo "SMOKE TEST FAILED: $1" >&2
  exit 1
}

echo "1) Checking gateway health..."
health_status=$(curl -s -o /tmp/health.json -w '%{http_code}' "${BASE_URL}/health") || fail "gateway unreachable"
[ "$health_status" = "200" ] || fail "gateway /health returned ${health_status}: $(cat /tmp/health.json)"
echo "   OK: $(cat /tmp/health.json)"

echo "2) Submitting registration through the gateway..."
resp_status=$(curl -s -o /tmp/register.json -w '%{http_code}' \
  -X POST "${BASE_URL}/v1/registrations" \
  -H "content-type: application/json" \
  -H "x-correlation-id: ${CORRELATION_ID}" \
  -H "authorization: Bearer ${GATEWAY_TEST_TOKEN}" \
  -d '{"fingerprint":"smoke-test-fingerprint","payload":{"model":"synthetic-smoke-agent"}}')

[ "$resp_status" = "201" ] || [ "$resp_status" = "200" ] || fail "registration returned ${resp_status}: $(cat /tmp/register.json)"

returned_correlation=$(grep -o "\"correlationId\":\"[^\"]*\"" /tmp/register.json | cut -d'"' -f4)
[ "$returned_correlation" = "$CORRELATION_ID" ] || fail "correlation id not propagated (expected ${CORRELATION_ID}, got ${returned_correlation})"
echo "   OK (status ${resp_status}, correlation id ${returned_correlation}): $(cat /tmp/register.json)"

echo "3) Re-submitting the same fingerprint to confirm idempotent retry..."
resp2_status=$(curl -s -o /tmp/register2.json -w '%{http_code}' \
  -X POST "${BASE_URL}/v1/registrations" \
  -H "content-type: application/json" \
  -H "x-correlation-id: retry-${CORRELATION_ID}" \
  -H "authorization: Bearer ${GATEWAY_TEST_TOKEN}" \
  -d '{"fingerprint":"smoke-test-fingerprint","payload":{"model":"synthetic-smoke-agent"}}')
[ "$resp2_status" = "200" ] || fail "idempotent retry returned ${resp2_status}, expected 200: $(cat /tmp/register2.json)"
echo "   OK: $(cat /tmp/register2.json)"

echo ""
echo "SMOKE TEST PASSED"
