#!/usr/bin/env bash
set -euo pipefail

SERVICES=(eduagentx-postgres eduagentx-redis eduagentx-agent-registry eduagentx-api-gateway eduagentx-assurance-console)
MAX_WAIT=120
INTERVAL=3
elapsed=0

while true; do
  all_healthy=true
  for c in "${SERVICES[@]}"; do
    status=$(docker inspect --format='{{.State.Health.Status}}' "$c" 2>/dev/null || echo "missing")
    if [ "$status" != "healthy" ]; then
      all_healthy=false
    fi
  done

  if $all_healthy; then
    echo "All services healthy."
    exit 0
  fi

  if [ "$elapsed" -ge "$MAX_WAIT" ]; then
    echo "Timed out waiting for services to become healthy after ${MAX_WAIT}s."
    docker compose ps
    exit 1
  fi

  sleep "$INTERVAL"
  elapsed=$((elapsed + INTERVAL))
done
