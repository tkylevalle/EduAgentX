#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESULTS_DIR="${SPRINT1_RESULTS_DIR:-${ROOT_DIR}/artifacts/sprint1}"
GATEWAY_PORT="${GATEWAY_PORT:-8080}"
BASE_URL="${GATEWAY_BASE_URL:-http://127.0.0.1:${GATEWAY_PORT}}"

mkdir -p "${RESULTS_DIR}"
checks=0

recover_dependencies() {
  docker compose -f "${ROOT_DIR}/docker-compose.yml" start postgres redis >/dev/null 2>&1 || true
}
trap recover_dependencies EXIT

wait_for_gateway_status() {
  local expected="$1"
  local attempts=30
  for _ in $(seq 1 "${attempts}"); do
    local status
    status=$(curl --max-time 3 -sS -o /dev/null -w '%{http_code}' "${BASE_URL}/health" || true)
    if [ "${status}" = "${expected}" ]; then
      return 0
    fi
    sleep 1
  done
  echo "Gateway did not reach HTTP ${expected}" >&2
  return 1
}

echo "Checking Redis Stream evidence..."
stream_length=$(docker compose -f "${ROOT_DIR}/docker-compose.yml" exec -T redis \
  redis-cli XLEN agent-registry.assurance | tr -d '\r')
if ! [[ "${stream_length}" =~ ^[0-9]+$ ]] || [ "${stream_length}" -lt 1 ]; then
  echo "Expected at least one agent-registry.assurance event, found '${stream_length}'" >&2
  exit 1
fi
checks=$((checks + 1))

echo "Stopping Redis and verifying fail-closed health..."
docker compose -f "${ROOT_DIR}/docker-compose.yml" stop redis >/dev/null
wait_for_gateway_status 503
checks=$((checks + 1))

echo "Restarting Redis and verifying recovery..."
docker compose -f "${ROOT_DIR}/docker-compose.yml" start redis >/dev/null
bash "${ROOT_DIR}/scripts/wait-for-healthy.sh"
wait_for_gateway_status 200
checks=$((checks + 1))

echo "Stopping PostgreSQL and verifying fail-closed health..."
docker compose -f "${ROOT_DIR}/docker-compose.yml" stop postgres >/dev/null
wait_for_gateway_status 503
checks=$((checks + 1))

echo "Restarting PostgreSQL and verifying recovery..."
docker compose -f "${ROOT_DIR}/docker-compose.yml" start postgres >/dev/null
bash "${ROOT_DIR}/scripts/wait-for-healthy.sh"
wait_for_gateway_status 200
checks=$((checks + 1))

completed_at=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
printf '{\n  "schemaVersion": "1.0.0",\n  "suite": "sprint1-dependency-failure-recovery",\n  "completedAt": "%s",\n  "result": "passed",\n  "checks": %d,\n  "redisStreamLength": %s\n}\n' \
  "${completed_at}" "${checks}" "${stream_length}" > "${RESULTS_DIR}/failure-recovery.json"

trap - EXIT
echo "Dependency failure/recovery checks passed."
