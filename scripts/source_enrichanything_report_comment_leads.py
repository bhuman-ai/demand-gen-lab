#!/usr/bin/env python3
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


BASE_URL = "http://127.0.0.1:3002"
BRAND_ID = "brand_7bfdb4d1686b4afc"
REPORT_EXPERIMENT_PREFIX = "Report comment outreach · "
TARGET_SENDABLE = 5
MAX_ROUNDS = 2
SOURCE_SAMPLE_SIZE = 20
ROOT = Path(__file__).resolve().parents[1]


def load_env_file(path: Path):
    values = {}
    if not path.exists():
        return values
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


ENV_VALUES = load_env_file(ROOT / ".env.local")
CRON_TOKEN = (
    os.environ.get("OUTREACH_CRON_TOKEN")
    or os.environ.get("CRON_SECRET")
    or ENV_VALUES.get("OUTREACH_CRON_TOKEN")
    or ENV_VALUES.get("CRON_SECRET")
    or ""
).strip()


def api_request(method, path, payload=None, auth=False, timeout=120):
    url = f"{BASE_URL}{path}"
    data = None
    headers = {}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if auth and CRON_TOKEN:
        headers["Authorization"] = f"Bearer {CRON_TOKEN}"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read().decode("utf-8")
        return json.loads(body) if body else {}


def refresh_report_prompts():
    subprocess.run(
        [
            "python3",
            str(ROOT / "scripts" / "setup_enrichanything_report_comment_experiments.py"),
            "--force-all",
            "--prompts-only",
        ],
        cwd=str(ROOT),
        check=True,
    )


def list_report_experiments():
    payload = api_request("GET", f"/api/brands/{BRAND_ID}/experiments", timeout=60)
    return [
        experiment
        for experiment in payload.get("experiments", [])
        if str(experiment.get("name", "")).startswith(REPORT_EXPERIMENT_PREFIX)
    ]


def fetch_experiment_state(experiment):
    sendable = api_request(
        "GET",
        f"/api/brands/{BRAND_ID}/experiments/{experiment['id']}/sendable-leads",
        timeout=60,
    )
    table = api_request(
        "GET",
        f"/api/brands/{BRAND_ID}/experiments/{experiment['id']}/prospect-table",
        timeout=120,
    )
    return {
        "id": experiment["id"],
        "name": experiment["name"],
        "status": experiment["status"],
        "sendableLeadCount": int(sendable.get("sendableLeadCount", 0) or 0),
        "runsChecked": int(sendable.get("runsChecked", 0) or 0),
        "rowCount": int(table.get("rowCount", 0) or 0),
        "promptSource": (
            (table.get("discoveryMeta") or {}).get("promptSource") if isinstance(table.get("discoveryMeta"), dict) else ""
        ),
    }


def cleanup_report_experiments(experiment_ids):
    return api_request(
        "POST",
        "/api/internal/enrichanything/report-comment-sourcing/cleanup",
        {"brandId": BRAND_ID, "experimentIds": experiment_ids},
        auth=True,
        timeout=120,
    )


def run_sendable_tick():
    return api_request("POST", "/api/internal/outreach/tick", {}, auth=True, timeout=180)


def source_experiment(experiment_id):
    return api_request(
        "POST",
        f"/api/brands/{BRAND_ID}/experiments/{experiment_id}/source-sample-leads",
        {"sampleSize": SOURCE_SAMPLE_SIZE, "autoSend": False},
        timeout=240,
    )


def print_summary(label, states):
    print(f"\n{label}")
    for state in sorted(states, key=lambda item: (-item["sendableLeadCount"], -item["rowCount"], item["name"])):
        print(
            f"{state['sendableLeadCount']:>2} sendable | "
            f"{state['rowCount']:>3} rows | "
            f"{state['promptSource'] or 'default':>7} | "
            f"{state['name']}"
        )


def main():
    refresh_report_prompts()

    experiments = list_report_experiments()
    states = [fetch_experiment_state(experiment) for experiment in experiments]
    print_summary("Before cleanup and sourcing", states)

    cleanup_result = cleanup_report_experiments([state["id"] for state in states])
    print(
        "\nCleanup:",
        json.dumps(
            {
                "experimentsChecked": cleanup_result.get("experimentsChecked", 0),
                "suppressedLeads": sum(
                    int(entry.get("suppressedLeads", 0) or 0)
                    for entry in cleanup_result.get("summary", [])
                ),
                "normalizedLeads": sum(
                    int(entry.get("normalizedLeads", 0) or 0)
                    for entry in cleanup_result.get("summary", [])
                ),
            }
        ),
    )

    for round_index in range(MAX_ROUNDS):
        states = [fetch_experiment_state(experiment) for experiment in experiments]
        weak = [state for state in states if state["sendableLeadCount"] < TARGET_SENDABLE]
        if not weak:
            break

        print_summary(f"Round {round_index + 1} candidates to resupply", weak)
        for state in weak:
            print(f"\nSourcing {state['name']} ({state['id']})")
            try:
                result = source_experiment(state["id"])
                print(json.dumps(result))
            except urllib.error.HTTPError as error:
                body = error.read().decode("utf-8", errors="replace")
                print(f"source failed: {error.code} {body}")
            time.sleep(1.5)

        try:
            tick = run_sendable_tick()
            print("\nTick:", json.dumps(tick))
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            print(f"\nTick failed: {error.code} {body}")

        time.sleep(3)

    final_states = [fetch_experiment_state(experiment) for experiment in experiments]
    print_summary("Final report comment sourcing state", final_states)
    below_target = [state for state in final_states if state["sendableLeadCount"] < TARGET_SENDABLE]
    print(
        json.dumps(
            {
                "targetSendable": TARGET_SENDABLE,
                "experimentsAtTarget": len(final_states) - len(below_target),
                "experimentsBelowTarget": len(below_target),
                "belowTarget": [
                    {
                        "id": state["id"],
                        "name": state["name"],
                        "sendableLeadCount": state["sendableLeadCount"],
                        "rowCount": state["rowCount"],
                    }
                    for state in below_target
                ],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
