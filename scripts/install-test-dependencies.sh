#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICES=(
  agent-registry
  api-gateway
  assurance-console
  external-agent-protocol
  synthetic-agent-learner
)

for service in "${SERVICES[@]}"; do
  echo "Installing test dependencies for ${service}..."
  npm install --prefix "${ROOT_DIR}/services/${service}" --no-package-lock --ignore-scripts --no-audit --no-fund
done
