#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RESULTS_DIR="${SPRINT1_RESULTS_DIR:-${ROOT_DIR}/artifacts/sprint1}"
INTEGRATION_ONLY=false

if [ "${1:-}" = "--integration-only" ]; then
  INTEGRATION_ONLY=true
fi

cd "${ROOT_DIR}"
mkdir -p "${RESULTS_DIR}"
export SPRINT1_RESULTS_DIR="${RESULTS_DIR}"

if [ ! -f .env ]; then
  cp .env.example .env
fi
set -a
# shellcheck disable=SC1091
source .env
set +a

# Git Bash/MSYS rewrites Unix-looking environment-variable values before
# invoking Windows executables such as docker.exe. These two values are paths
# inside the Linux container and must remain unchanged.
case "$(uname -s)" in
  MINGW*|MSYS*)
    export MSYS2_ENV_CONV_EXCL="${MSYS2_ENV_CONV_EXCL:+${MSYS2_ENV_CONV_EXCL};}JWT_PRIVATE_KEY_PATH;JWT_PUBLIC_KEY_PATH"
    ;;
esac

for command in node docker curl; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Required command '${command}' is unavailable." >&2
    exit 2
  fi
done

cleanup() {
  local exit_code=$?
  if [ "${exit_code}" -ne 0 ]; then
    docker compose logs --no-color > "${RESULTS_DIR}/compose.log" 2>&1 || true
  fi
  if [ "${KEEP_STACK:-0}" != "1" ]; then
    if [ "${SPRINT1_RESET:-0}" = "1" ]; then
      docker compose down -v >/dev/null 2>&1 || true
    else
      docker compose down >/dev/null 2>&1 || true
    fi
  fi
  trap - EXIT
  exit "${exit_code}"
}
trap cleanup EXIT

node ./scripts/generate-test-keys.js

if [ "${INTEGRATION_ONLY}" != "true" ]; then
  node ./scripts/run-unit-tests.js
fi

if [ "${SPRINT1_RESET:-0}" = "1" ]; then
  docker compose down -v >/dev/null 2>&1 || true
fi

docker compose up --build -d
bash ./scripts/wait-for-healthy.sh
bash ./scripts/smoke.sh
node ./scripts/security-integration.js
node ./scripts/measure-registration-latency.js
bash ./scripts/failure-integration.sh

node -e "const fs=require('fs'); const path=require('path'); const dir=process.env.SPRINT1_RESULTS_DIR; const required=['security-integration.json','registration-latency.json','failure-recovery.json']; if('${INTEGRATION_ONLY}'!=='true') required.push('unit-tests.json'); const missing=required.filter(f=>!fs.existsSync(path.join(dir,f))); const report={schemaVersion:'1.0.0',suite:'sprint1-gate',completedAt:new Date().toISOString(),result:missing.length?'failed':'passed',requiredArtifacts:required,missingArtifacts:missing}; fs.writeFileSync(path.join(dir,'gate-summary.json'),JSON.stringify(report,null,2)+'\n'); if(missing.length) process.exit(1);"

echo "Sprint 1 automated, security, and integration gate passed."
echo "Evidence: ${RESULTS_DIR}"
