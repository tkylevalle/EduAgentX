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
AGENT_CLIENT_ID="${AGENT_CLIENT_ID:-synthetic-agent-learner-dev}"
AGENT_CLIENT_SECRET="${AGENT_CLIENT_SECRET:-changeme_local_only_agent_secret}"
ADMIN_CLIENT_ID="${ADMIN_CLIENT_ID:-capstone-admin-dev}"
ADMIN_CLIENT_SECRET="${ADMIN_CLIENT_SECRET:-changeme_local_only_admin_secret}"
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

echo "2) Registration without a token must be rejected..."
noauth_status=$(curl -s -o /tmp/noauth.json -w '%{http_code}' \
  -X POST "${BASE_URL}/v1/registrations" \
  -H "content-type: application/json" \
  -d '{"fingerprint":"smoke-test-fingerprint","payload":{}}')
[ "$noauth_status" = "401" ] || fail "unauthenticated registration returned ${noauth_status}, expected 401: $(cat /tmp/noauth.json)"
echo "   OK: rejected with 401"

echo "3) Exchanging agent client credentials for a JWT..."
token_status=$(curl -s -o /tmp/token.json -w '%{http_code}' \
  -X POST "${BASE_URL}/v1/auth/tokens" \
  -H "content-type: application/json" \
  -d "{\"clientId\":\"${AGENT_CLIENT_ID}\",\"clientSecret\":\"${AGENT_CLIENT_SECRET}\"}")
[ "$token_status" = "200" ] || fail "token exchange returned ${token_status}: $(cat /tmp/token.json)"
AGENT_TOKEN=$(grep -o "\"accessToken\":\"[^\"]*\"" /tmp/token.json | cut -d'"' -f4)
[ -n "$AGENT_TOKEN" ] || fail "no accessToken in response: $(cat /tmp/token.json)"
echo "   OK: received a role=agent access token"

echo "4) Submitting registration through the gateway with a valid agent token..."
resp_status=$(curl -s -o /tmp/register.json -w '%{http_code}' \
  -X POST "${BASE_URL}/v1/registrations" \
  -H "content-type: application/json" \
  -H "x-correlation-id: ${CORRELATION_ID}" \
  -H "authorization: Bearer ${AGENT_TOKEN}" \
  -d '{"fingerprint":"smoke-test-fingerprint","payload":{"model":"synthetic-smoke-agent"}}')

[ "$resp_status" = "201" ] || [ "$resp_status" = "200" ] || fail "registration returned ${resp_status}: $(cat /tmp/register.json)"

returned_correlation=$(grep -o "\"correlationId\":\"[^\"]*\"" /tmp/register.json | cut -d'"' -f4)
[ "$returned_correlation" = "$CORRELATION_ID" ] || fail "correlation id not propagated (expected ${CORRELATION_ID}, got ${returned_correlation})"
echo "   OK (status ${resp_status}, correlation id ${returned_correlation}): $(cat /tmp/register.json)"

echo "5) Re-submitting the same fingerprint to confirm idempotent retry..."
resp2_status=$(curl -s -o /tmp/register2.json -w '%{http_code}' \
  -X POST "${BASE_URL}/v1/registrations" \
  -H "content-type: application/json" \
  -H "x-correlation-id: retry-${CORRELATION_ID}" \
  -H "authorization: Bearer ${AGENT_TOKEN}" \
  -d '{"fingerprint":"smoke-test-fingerprint","payload":{"model":"synthetic-smoke-agent"}}')
[ "$resp2_status" = "200" ] || fail "idempotent retry returned ${resp2_status}, expected 200: $(cat /tmp/register2.json)"
echo "   OK: $(cat /tmp/register2.json)"

echo "6) Agent token must be rejected on an admin-only endpoint..."
agent_on_admin_status=$(curl -s -o /tmp/agent_on_admin.json -w '%{http_code}' \
  "${BASE_URL}/v1/admin/whoami" \
  -H "authorization: Bearer ${AGENT_TOKEN}")
[ "$agent_on_admin_status" = "403" ] || fail "agent token on admin endpoint returned ${agent_on_admin_status}, expected 403: $(cat /tmp/agent_on_admin.json)"
echo "   OK: rejected with 403"

echo "7) Exchanging admin client credentials and confirming the admin endpoint accepts them..."
admin_token_status=$(curl -s -o /tmp/admin_token.json -w '%{http_code}' \
  -X POST "${BASE_URL}/v1/auth/tokens" \
  -H "content-type: application/json" \
  -d "{\"clientId\":\"${ADMIN_CLIENT_ID}\",\"clientSecret\":\"${ADMIN_CLIENT_SECRET}\"}")
[ "$admin_token_status" = "200" ] || fail "admin token exchange returned ${admin_token_status}: $(cat /tmp/admin_token.json)"
ADMIN_TOKEN=$(grep -o "\"accessToken\":\"[^\"]*\"" /tmp/admin_token.json | cut -d'"' -f4)
[ -n "$ADMIN_TOKEN" ] || fail "no accessToken in admin response: $(cat /tmp/admin_token.json)"

whoami_status=$(curl -s -o /tmp/whoami.json -w '%{http_code}' \
  "${BASE_URL}/v1/admin/whoami" \
  -H "authorization: Bearer ${ADMIN_TOKEN}")
[ "$whoami_status" = "200" ] || fail "admin whoami returned ${whoami_status}: $(cat /tmp/whoami.json)"
echo "   OK: $(cat /tmp/whoami.json)"

echo ""
echo "SMOKE TEST PASSED"