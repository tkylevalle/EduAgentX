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
AGENT_LEARNER_KEY="${AGENT_LEARNER_KEY:-$AGENT_CLIENT_ID}"
REGISTRATION_BODY="{\"agentLearnerKey\":\"${AGENT_LEARNER_KEY}\",\"model\":{\"provider\":\"synthetic\",\"version\":\"1.0.0\"},\"systemPromptHash\":\"sha256:smoke-prompt-v1\",\"approvedToolManifest\":[{\"name\":\"knowledge.lookup\",\"version\":\"1.0.0\",\"permissions\":[\"read\"]}],\"policyConfigurationHash\":\"sha256:smoke-policy-v1\",\"adapterVersion\":\"1.0.0\"}"
BASE_URL="http://localhost:${GATEWAY_PORT}"
CORRELATION_ID="smoke-$(date +%s)"
PROTOCOL_CORRELATION_ID="protocol-${CORRELATION_ID}"
PROTOCOL_IDEMPOTENCY_KEY="protocol-registration-${CORRELATION_ID}"
PROTOCOL_BODY="{\"protocol\":\"ExternalAgentLearner\",\"protocolVersion\":\"1.0.0\",\"messageType\":\"registration\",\"messageId\":\"protocol-registration-${CORRELATION_ID}\",\"correlationId\":\"${PROTOCOL_CORRELATION_ID}\",\"idempotencyKey\":\"${PROTOCOL_IDEMPOTENCY_KEY}\",\"timeoutMs\":2500,\"evidence\":{\"mode\":\"synthetic\"},\"payload\":${REGISTRATION_BODY}}"
PROTOCOL_REJECT_BODY="{\"protocol\":\"ExternalAgentLearner\",\"protocolVersion\":\"9.0.0\",\"messageType\":\"registration\",\"messageId\":\"protocol-rejected-${CORRELATION_ID}\",\"correlationId\":\"${PROTOCOL_CORRELATION_ID}\",\"idempotencyKey\":\"protocol-rejected-${CORRELATION_ID}\",\"timeoutMs\":2500,\"evidence\":{\"mode\":\"synthetic\"},\"payload\":${REGISTRATION_BODY}}"

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
  -d "${REGISTRATION_BODY}")

[ "$resp_status" = "201" ] || [ "$resp_status" = "200" ] || fail "registration returned ${resp_status}: $(cat /tmp/register.json)"

returned_correlation=$(grep -o "\"correlationId\":\"[^\"]*\"" /tmp/register.json | head -n 1 | cut -d'"' -f4)
[ "$returned_correlation" = "$CORRELATION_ID" ] || fail "correlation id not propagated (expected ${CORRELATION_ID}, got ${returned_correlation})"
AGENT_LEARNER_ID=$(grep -o "\"agentLearnerId\":\"[^\"]*\"" /tmp/register.json | head -n 1 | cut -d'"' -f4)
[ -n "$AGENT_LEARNER_ID" ] || fail "no authoritative agentLearnerId in response: $(cat /tmp/register.json)"
echo "   OK (status ${resp_status}, correlation id ${returned_correlation}): $(cat /tmp/register.json)"

echo "5) Re-submitting the same fingerprint to confirm idempotent retry..."
resp2_status=$(curl -s -o /tmp/register2.json -w '%{http_code}' \
  -X POST "${BASE_URL}/v1/registrations" \
  -H "content-type: application/json" \
  -H "x-correlation-id: retry-${CORRELATION_ID}" \
  -H "authorization: Bearer ${AGENT_TOKEN}" \
  -d "${REGISTRATION_BODY}")
[ "$resp2_status" = "200" ] || fail "idempotent retry returned ${resp2_status}, expected 200: $(cat /tmp/register2.json)"
echo "   OK: $(cat /tmp/register2.json)"

echo "6) Submitting the versioned protocol registration through the public Gateway..."
protocol_status=$(curl -s -o /tmp/protocol-register.json -w '%{http_code}' \
  -X POST "${BASE_URL}/v1/agent-learner/registrations" \
  -H "content-type: application/json" \
  -H "x-correlation-id: ${PROTOCOL_CORRELATION_ID}" \
  -H "x-agent-protocol-version: 1.0.0" \
  -H "idempotency-key: ${PROTOCOL_IDEMPOTENCY_KEY}" \
  -H "authorization: Bearer ${AGENT_TOKEN}" \
  -d "${PROTOCOL_BODY}")
[ "$protocol_status" = "200" ] || [ "$protocol_status" = "201" ] || fail "protocol registration returned ${protocol_status}: $(cat /tmp/protocol-register.json)"
grep -q 'SIMULATION: Synthetic Agent Learner' /tmp/protocol-register.json || fail "protocol response omitted simulation evidence"
echo "   OK (status ${protocol_status}): $(cat /tmp/protocol-register.json)"

before_reject=$(curl -fsS \
  "${BASE_URL}/v1/registrations/${AGENT_LEARNER_ID}" \
  -H "authorization: Bearer ${AGENT_TOKEN}") \
  || fail "cannot read registration before rejection"

echo "7) Versioned protocol rejection must fail closed before mutation..."
protocol_reject_status=$(curl -s -o /tmp/protocol-rejected.json -w '%{http_code}' \
  -X POST "${BASE_URL}/v1/agent-learner/registrations" \
  -H "content-type: application/json" \
  -H "x-correlation-id: ${PROTOCOL_CORRELATION_ID}" \
  -H "x-agent-protocol-version: 9.0.0" \
  -H "idempotency-key: protocol-rejected-${CORRELATION_ID}" \
  -H "authorization: Bearer ${AGENT_TOKEN}" \
  -d "${PROTOCOL_REJECT_BODY}")
[ "$protocol_reject_status" = "400" ] || fail "protocol rejection returned ${protocol_reject_status}, expected 400: $(cat /tmp/protocol-rejected.json)"
grep -q 'unsupported_protocol_version' /tmp/protocol-rejected.json || fail "protocol rejection omitted its reason"
echo "   OK: rejected with 400 and no registry dispatch"

after_reject=$(curl -fsS \
  "${BASE_URL}/v1/registrations/${AGENT_LEARNER_ID}" \
  -H "authorization: Bearer ${AGENT_TOKEN}") \
  || fail "cannot read registration after rejection"

printf '%s\n%s\n' "$before_reject" "$after_reject" |
  python3 -c '
import json
import sys

before = json.loads(sys.stdin.readline())
after = json.loads(sys.stdin.readline())

if not isinstance(before.get("registration"), dict):
    sys.exit("Missing registration before rejection")
if before["registration"] != after.get("registration"):
    sys.exit("Registration changed after rejected request")

print("   OK: registration and its history unchanged after rejection")
' || fail "rejected request changed registration or verification failed"

echo "8) Retrying the same protocol idempotency key must return the original result..."
protocol_retry_status=$(curl -s -o /tmp/protocol-register-retry.json -w '%{http_code}' \
  -X POST "${BASE_URL}/v1/agent-learner/registrations" \
  -H "content-type: application/json" \
  -H "x-correlation-id: ${PROTOCOL_CORRELATION_ID}" \
  -H "x-agent-protocol-version: 1.0.0" \
  -H "idempotency-key: ${PROTOCOL_IDEMPOTENCY_KEY}" \
  -H "authorization: Bearer ${AGENT_TOKEN}" \
  -d "${PROTOCOL_BODY}")
[ "$protocol_retry_status" = "$protocol_status" ] || fail "protocol retry returned ${protocol_retry_status}, expected ${protocol_status}: $(cat /tmp/protocol-register-retry.json)"
cmp -s /tmp/protocol-register.json /tmp/protocol-register-retry.json || fail "protocol retry did not return the original result"
echo "   OK: exact original protocol result replayed"

echo "9) Retrieving the authoritative registration through the versioned contract..."
retrieve_status=$(curl -s -o /tmp/retrieve.json -w '%{http_code}' \
  "${BASE_URL}/v1/registrations/${AGENT_LEARNER_ID}" \
  -H "authorization: Bearer ${AGENT_TOKEN}" \
  -H "x-correlation-id: retrieve-${CORRELATION_ID}")
[ "$retrieve_status" = "200" ] || fail "registration retrieval returned ${retrieve_status}: $(cat /tmp/retrieve.json)"
echo "   OK: $(cat /tmp/retrieve.json)"

echo "10) Agent token must be rejected on an admin-only endpoint..."
agent_on_admin_status=$(curl -s -o /tmp/agent_on_admin.json -w '%{http_code}' \
  "${BASE_URL}/v1/admin/whoami" \
  -H "authorization: Bearer ${AGENT_TOKEN}")
[ "$agent_on_admin_status" = "403" ] || fail "agent token on admin endpoint returned ${agent_on_admin_status}, expected 403: $(cat /tmp/agent_on_admin.json)"
echo "   OK: rejected with 403"

echo "11) Exchanging admin client credentials and reading the registration assurance trace..."
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

trace_status=$(curl -s -o /tmp/trace.json -w '%{http_code}' \
  "${BASE_URL}/v1/admin/registration-traces/latest" \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "x-correlation-id: trace-${CORRELATION_ID}")
[ "$trace_status" = "200" ] || fail "registration trace returned ${trace_status}: $(cat /tmp/trace.json)"
grep -q 'configurationFingerprint' /tmp/trace.json || fail "trace omitted the configuration fingerprint"
grep -q 'correlationId' /tmp/trace.json || fail "trace omitted correlation evidence"
echo "   OK: $(cat /tmp/trace.json)"

echo "12) Assurance Console must display the read-only trace..."
CONSOLE_PORT="${CONSOLE_PORT:-4173}"
console_status=$(curl -s -o /tmp/console.html -w '%{http_code}' "http://localhost:${CONSOLE_PORT}/")
[ "$console_status" = "200" ] || fail "assurance console returned ${console_status}: $(cat /tmp/console.html)"
grep -q "Latest Agent Registry trace" /tmp/console.html || fail "console did not render the registry trace"
grep -q "Configuration fingerprint" /tmp/console.html || fail "console did not render the fingerprint"
grep -q "Correlation ID" /tmp/console.html || fail "console did not render correlation evidence"
echo "   OK: console rendered the trace"

echo "13) Synthetic Agent Learner must use the public Gateway protocol..."
SYNTHETIC_AGENT_PORT="${SYNTHETIC_AGENT_PORT:-4200}"
synthetic_status=$(curl -s -o /tmp/synthetic-run.json -w '%{http_code}' \
  -X POST "http://localhost:${SYNTHETIC_AGENT_PORT}/v1/runs" \
  -H "content-type: application/json" \
  -H "x-correlation-id: synthetic-${CORRELATION_ID}" \
  -d "{\"profileId\":\"competent\",\"agentLearnerKey\":\"${AGENT_LEARNER_KEY}\"}")
[ "$synthetic_status" = "200" ] || fail "synthetic learner returned ${synthetic_status}: $(cat /tmp/synthetic-run.json)"
grep -q 'SIMULATION: Synthetic Agent Learner' /tmp/synthetic-run.json || fail "synthetic evidence was not labelled as simulation"
grep -q '"credentialIssued":false' /tmp/synthetic-run.json || fail "synthetic adapter claimed credential issuance"
echo "   OK: synthetic learner was accepted through the Gateway with simulation evidence"

echo ""
echo "SMOKE TEST PASSED"
