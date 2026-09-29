import json
import os
import subprocess
import time
import uuid
from urllib.error import HTTPError
from urllib.request import Request, urlopen

base = "http://localhost:" + os.getenv("GATEWAY_PORT", "8080")
run_id = uuid.uuid4().hex
markers = {
    name: f"CANARY_{name}_{run_id}"
    for name in ("TOKEN", "BODY", "QUERY")
}
cases = [
    ("invalid-token", 401, json.dumps({"privatePrompt": markers["BODY"]})),
    ("malformed-json", 400, '{"privatePrompt":"' + markers["BODY"] + '",'),
]
expected = {}

for name, expected_status, body in cases:
    correlation = f"redaction-{name}-{run_id}"
    req = Request(
        base + "/v1/agent-learner/registrations?secret=" + markers["QUERY"],
        data=body.encode(),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + markers["TOKEN"],
            "x-correlation-id": correlation,
        },
    )
    try:
        with urlopen(req, timeout=10) as response:
            status = response.status
            response.read()
    except HTTPError as error:
        status = error.code
        error.close()

    if status != expected_status:
        raise SystemExit(f"FAIL: {name}: expected {expected_status}, got {status}")
    expected[correlation] = expected_status

# Allow a short window for Docker to collect request logs.
deadline = time.monotonic() + 5
while True:
    logs = subprocess.check_output([
        "docker", "compose", "logs", "--no-color", "--since=2m",
        "api-gateway", "agent-registry",
    ], text=True)

    if any(marker in logs for marker in markers.values()):
        raise SystemExit("FAIL: test secret found in logs")

    found = set()
    for line in logs.splitlines():
        _, separator, message = line.partition("|")
        if not separator:
            continue
        try:
            record = json.loads(message.strip())
        except ValueError:
            continue
        correlation = record.get("correlationId")
        if (
            correlation in expected
            and record.get("service") == "api-gateway"
            and record.get("event") == "http_request_completed"
            and record.get("statusCode") == expected[correlation]
        ):
            found.add(correlation)

    if found == set(expected):
        break
    if time.monotonic() >= deadline:
        raise SystemExit("FAIL: required request logs missing")
    time.sleep(0.25)

print(json.dumps({
    "result": "PASS",
    "checks": ["invalid_token_401", "malformed_json_400"],
    "secret_markers_found": False,
    "correlation_ids": list(expected),
    "scope": "Gateway rejection paths; not full redaction coverage",
}, indent=2))
