import json
import math
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1] / "evidence/sprint-1"
errors = []


def check_tests(service, minimum):
    text = (root / "tests" / f"{service}.txt").read_text()
    counts = {}
    for field in ("tests", "pass", "fail", "cancelled", "skipped", "todo"):
        matches = re.findall(rf"^# {field} (\d+)\s*$", text, re.M)
        if len(matches) != 1:
            raise ValueError(f"{service}: missing or ambiguous {field}")
        counts[field] = int(matches[0])
    if (
        counts["tests"] < minimum
        or counts["pass"] != counts["tests"]
        or any(counts[k] for k in ("fail", "cancelled", "skipped", "todo"))
        or re.search(r"^\s*not ok\b|^Bail out!", text, re.M)
    ):
        raise ValueError(f"{service}: incomplete or failed tests")
    print(f"PASS: {service}: {counts['pass']} tests")


def check_latency(filename, scenario, minimum, detailed):
    report = json.loads((root / filename).read_text())
    if report.get("scenario") != scenario:
        raise ValueError(f"{filename}: wrong scenario")
    if detailed:
        rows = report["samples"]
        values = [row["durationMs"] for row in rows]
        ids = [row["correlationId"] for row in rows]
        if (
            report.get("failure") is not None
            or report["completedSamples"] != len(rows)
            or report["expectedSamples"] != len(rows)
            or len(set(ids)) != len(ids)
            or any(row["httpStatus"] != 201 for row in rows)
        ):
            raise ValueError(f"{filename}: incomplete or unsuccessful run")
    else:
        values = report["samples_ms"]
        if report["samples"] != len(values):
            raise ValueError(f"{filename}: sample count mismatch")

    if len(values) < minimum or any(
        type(v) not in (int, float) or not math.isfinite(v) or v < 0
        for v in values
    ):
        raise ValueError(f"{filename}: invalid or missing measurements")

    p95 = sorted(values)[math.ceil(0.95 * len(values)) - 1]
    reported = report["p95_ms"]
    if (
        type(reported) not in (int, float)
        or not math.isfinite(reported)
        or abs(p95 - reported) > 0.002
    ):
        raise ValueError(f"{filename}: reported p95 does not match samples")
    if p95 > 3000:
        raise ValueError(f"{filename}: p95 exceeds 3000 ms")
    print(f"PASS: {scenario}: p95={p95:.3f} ms; target met={p95 <= 2000}")


checks = [
    (lambda s=s, n=n: check_tests(s, n))
    for s, n in [
        ("external-agent-protocol", 7),
        ("agent-registry", 6),
        ("api-gateway", 5),
        ("assurance-console", 1),
        ("synthetic-agent-learner", 10),
    ]
]
checks.extend([
    lambda: check_latency(
        "registration-existing-agent.json",
        "existing_agent_registration_unique_request_keys", 100, False
    ),
    lambda: check_latency(
        "registration-new-agent.json",
        "new_agent_registration", 20, True
    ),
])

for check in checks:
    try:
        check()
    except Exception as error:
        errors.append(str(error))
        print(f"FAIL: {error}")

print()
print("SCOPE: saved component-test reports and registration latency only.")
print("Sprint Gate approval is NOT established by this check.")
sys.exit(1 if errors else 0)
