import json
import math
import os
import subprocess
import time
import uuid
from datetime import datetime, timezone
from urllib.request import Request, urlopen

base = "http://localhost:" + os.getenv("GATEWAY_PORT", "8080")
client_id = os.environ["AGENT_CLIENT_ID"]


def request(path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    data = None if body is None else json.dumps(body).encode()
    req = Request(base + path, data=data, headers=headers)
    started = time.perf_counter()
    with urlopen(req, timeout=10) as response:
        result = json.load(response)
        status = response.status
    elapsed = (time.perf_counter() - started) * 1000
    return status, result, elapsed


_, auth, _ = request("/v1/auth/tokens", {
    "clientId": client_id,
    "clientSecret": os.environ["AGENT_CLIENT_SECRET"],
})
token = auth["accessToken"]

# Read the current configuration without changing it.
from urllib.parse import urlencode
_, existing, _ = request(
    "/v1/registrations?" + urlencode({"agentLearnerKey": client_id}),
    token=token,
)
registration = existing["registration"]
configuration = registration["currentConfiguration"]
payload = {
    field: configuration[field]
    for field in (
        "model", "systemPromptHash", "approvedToolManifest",
        "policyConfigurationHash", "adapterVersion"
    )
}
payload["agentLearnerKey"] = client_id

samples = []
for index in range(105):
    identifier = "latency-" + str(uuid.uuid4())
    status, result, elapsed = request(
        "/v1/agent-learner/registrations",
        {
            "protocol": "ExternalAgentLearner",
            "protocolVersion": "1.0.0",
            "messageType": "registration",
            "messageId": identifier,
            "correlationId": identifier,
            "idempotencyKey": identifier,
            "timeoutMs": 5000,
            "evidence": {"mode": "synthetic"},
            "payload": payload,
        },
        token,
    )
    current = result.get("registration", {})
    if (
        status != 200
        or result.get("outcome") != "unchanged"
        or current.get("agentLearnerId") != registration["agentLearnerId"]
        or current.get("configurationVersion") != registration["configurationVersion"]
    ):
        raise SystemExit("FAILED: unexpected registration result")

    # Exclude five warm-up requests.
    if index >= 5:
        samples.append(elapsed)

p95 = sorted(samples)[math.ceil(0.95 * len(samples)) - 1]
report = {
    "scenario": "existing_agent_registration_unique_request_keys",
    "environment": "local_simulation",
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "commit": subprocess.check_output(
        ["git", "rev-parse", "HEAD"], text=True
    ).strip(),
    "samples": len(samples),
    "warmup_requests": 5,
    "concurrency": 1,
    "measurement": "client_request_to_complete_response_excluding_token",
    "percentile_method": "nearest_rank",
    "p95_ms": round(p95, 3),
    "within_3000ms": p95 <= 3000,
    "within_2000ms_target": p95 <= 2000,
    "samples_ms": [round(value, 3) for value in samples],
    "limitation": "Does not measure creation of new agents or prove Sprint Gate readiness",
}
print(json.dumps(report, indent=2))
