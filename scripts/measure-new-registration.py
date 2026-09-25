import json
import math
import os
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

PROJECT = "eduagentx-issue8"
BASE = "http://localhost:" + os.getenv("GATEWAY_PORT", "8080")
COUNT = 20
original_env = os.environ.copy()
secret = os.environ["AGENT_CLIENT_SECRET"]
run_id = uuid.uuid4().hex[:12]
samples = []
agent_ids = set()
failure = None


def configure_gateway(client_id):
    env = original_env.copy()
    env["AGENT_CLIENT_ID"] = client_id
    subprocess.run([
        "docker", "compose", "-p", PROJECT, "up", "-d",
        "--no-deps", "--force-recreate", "--wait",
        "--wait-timeout", "120", "api-gateway",
    ], env=env, check=True, stdout=subprocess.DEVNULL)


def request(path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    req = Request(
        BASE + path,
        data=None if body is None else json.dumps(body).encode(),
        headers=headers,
    )
    started = time.perf_counter()
    try:
        with urlopen(req, timeout=10) as response:
            status, data = response.status, json.load(response)
    except HTTPError as error:
        status, data = error.code, json.load(error)
        error.close()
    return status, data, (time.perf_counter() - started) * 1000


try:
    for index in range(COUNT):
        client_id = f"perf-{run_id}-{index:03d}"
        print(f"Registration {index + 1}/{COUNT}", flush=True)
        configure_gateway(client_id)

        status, auth, _ = request("/v1/auth/tokens", {
            "clientId": client_id,
            "clientSecret": secret,
        })
        if status != 200:
            raise RuntimeError(f"Token request failed: HTTP {status}")
        token = auth["accessToken"]

        status, _, _ = request(
            "/v1/registrations?agentLearnerKey=" + client_id,
            token=token,
        )
        if status != 404:
            raise RuntimeError(f"Expected absent agent, got HTTP {status}")

        identifier = client_id + "-registration"
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
                "payload": {
                    "agentLearnerKey": client_id,
                    "model": {"provider": "synthetic", "version": "1.0.0"},
                    "systemPromptHash": "sha256:synthetic-prompt-v1",
                    "approvedToolManifest": [{
                        "name": "knowledge.lookup",
                        "version": "1.0.0",
                        "permissions": ["read"],
                    }],
                    "policyConfigurationHash": "sha256:synthetic-policy-v1",
                    "adapterVersion": "synthetic-agent-learner-1.0.0",
                },
            },
            token,
        )
        registration = result.get("registration", {})
        agent_id = registration.get("agentLearnerId")
        if (
            status != 201
            or result.get("outcome") != "registered"
            or registration.get("configurationVersion") != 1
            or registration.get("agentLearnerKey") != client_id
            or not agent_id
            or agent_id in agent_ids
        ):
            raise RuntimeError("New registration assertions failed")

        agent_ids.add(agent_id)
        samples.append({
            "correlationId": identifier,
            "httpStatus": status,
            "durationMs": elapsed,
        })
except Exception as error:
    failure = f"{type(error).__name__}: {error}"
finally:
    print("Restoring original Gateway client settings...", flush=True)
    try:
        configure_gateway(original_env["AGENT_CLIENT_ID"])
    except Exception:
        failure = (failure or "") + " Gateway restoration failed."

complete = len(samples) == COUNT and failure is None
p95 = (
    sorted(s["durationMs"] for s in samples)[math.ceil(0.95 * COUNT) - 1]
    if complete else None
)
report = {
    "scenario": "new_agent_registration",
    "environment": "local_simulation",
    "composeProject": PROJECT,
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "commit": subprocess.check_output(
        ["git", "rev-parse", "HEAD"], text=True
    ).strip(),
    "scriptSha256": __import__("hashlib").sha256(
        Path(__file__).read_bytes()
    ).hexdigest(),
    "expectedSamples": COUNT,
    "completedSamples": len(samples),
    "concurrency": 1,
    "warmupRegistrations": 0,
    "method": "nearest_rank",
    "measurement": "client request through complete registration response",
    "conditions": "Gateway recreated per sample; Registry and database stay running",
    "excluded": ["Gateway restart", "token acquisition", "precondition GET"],
    "p95_ms": p95,
    "floor_pass": complete and p95 <= 3000,
    "target_pass": complete and p95 <= 2000,
    "failure": failure,
    "samples": samples,
    "limitation": "20-sample local estimate; not production-load evidence",
}
output = Path("evidence/sprint-1/registration-new-agent.json")
output.parent.mkdir(parents=True, exist_ok=True)
temporary = output.with_suffix(".tmp")
temporary.write_text(json.dumps(report, indent=2) + "\n")
temporary.replace(output)

print(f"Completed: {len(samples)}/{COUNT}")
print(f"p95: {p95} ms")
print(f"Floor passed: {report['floor_pass']}")
if failure:
    print(f"FAIL: {failure}")
sys.exit(0 if report["floor_pass"] else 1)
