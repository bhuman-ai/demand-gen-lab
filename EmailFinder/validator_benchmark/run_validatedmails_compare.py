#!/usr/bin/env python3
import json
import os
import time
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
BASE_REPORT = ROOT / "benchmark_report_hard_timeout.json"
OUT_REPORT = ROOT / "benchmark_report_with_validatedmails.json"

API_URL = "https://api.validatedmails.com/validate"


def infer_prediction(payload: dict[str, Any]) -> bool | None:
    status = str(payload.get("status", "")).strip().lower()
    if status == "valid":
        return True
    if status == "invalid":
        return False
    if status == "unknown":
        return None

    is_valid = payload.get("is_valid")
    if isinstance(is_valid, bool):
        return is_valid

    return None


def validatedmails_query(api_key: str, email: str, timeout_sec: int = 25) -> dict[str, Any]:
    body = json.dumps({"email": email}).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )

    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            status_code = resp.getcode()
        payload = json.loads(raw)
        pred = infer_prediction(payload)
        return {
            "predicted_accept": pred,
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
            "http_status": status_code,
            "error": None,
            "raw": payload,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "predicted_accept": None,
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
            "http_status": None,
            "error": str(exc),
            "raw": None,
        }


def compute_metrics(rows: list[dict[str, Any]], tool_name: str) -> dict[str, Any]:
    total = len(rows)
    covered = 0
    correct_covered = 0
    strict_correct = 0
    unknown = 0

    tp = fp = tn = fn = 0

    for row in rows:
        expected = bool(row["expected_accept"])
        pred = row["tool_predictions"].get(tool_name)

        if pred is None:
            unknown += 1
        else:
            covered += 1
            if pred == expected:
                correct_covered += 1
            if pred:
                if expected:
                    tp += 1
                else:
                    fp += 1
            else:
                if expected:
                    fn += 1
                else:
                    tn += 1

        if pred == expected:
            strict_correct += 1

    precision = tp / (tp + fp) if (tp + fp) else None
    recall = tp / (tp + fn) if (tp + fn) else None
    f1 = (2 * precision * recall / (precision + recall)) if (precision is not None and recall is not None and (precision + recall)) else None

    return {
        "tool": tool_name,
        "total": total,
        "covered": covered,
        "unknown": unknown,
        "coverage": round(covered / total, 4) if total else None,
        "accuracy_on_covered": round(correct_covered / covered, 4) if covered else None,
        "strict_accuracy": round(strict_correct / total, 4) if total else None,
        "tp": tp,
        "fp": fp,
        "tn": tn,
        "fn": fn,
        "precision": round(precision, 4) if precision is not None else None,
        "recall": round(recall, 4) if recall is not None else None,
        "f1": round(f1, 4) if f1 is not None else None,
    }


def main() -> None:
    api_key = os.getenv("VALIDATEDMAILS_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("VALIDATEDMAILS_API_KEY is required")

    if not BASE_REPORT.exists():
        raise SystemExit(f"Missing base report: {BASE_REPORT}")

    report = json.loads(BASE_REPORT.read_text())
    rows = report.get("rows", [])

    for row in rows:
        email = row["email"]
        vm = validatedmails_query(api_key, email, timeout_sec=25)
        row.setdefault("tool_predictions", {})["validatedmails_api"] = vm["predicted_accept"]
        row.setdefault("tool_details", {})["validatedmails_api"] = vm
        print(
            f"{email} | validatedmails={vm['predicted_accept']} "
            f"http={vm['http_status']} ({vm['elapsed_ms']}ms) err={vm['error']}"
        )
        time.sleep(0.2)

    tools = [
        "python_email_validator",
        "deep_email_validator",
        "email_validator_js",
        "validatedmails_api",
    ]
    metrics = [compute_metrics(rows, tool) for tool in tools]
    metrics.sort(key=lambda m: (m["strict_accuracy"] if m["strict_accuracy"] is not None else -1), reverse=True)

    out = {
        "dataset_size": len(rows),
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "base_report": str(BASE_REPORT),
        "metrics_ranked_by_strict_accuracy": metrics,
        "rows": rows,
    }
    OUT_REPORT.write_text(json.dumps(out, indent=2))

    print(f"Wrote {OUT_REPORT}")
    print("\nRanked tools:")
    for m in metrics:
        print(
            f"- {m['tool']}: strict_accuracy={m['strict_accuracy']} coverage={m['coverage']} "
            f"accuracy_on_covered={m['accuracy_on_covered']} unknown={m['unknown']}"
        )


if __name__ == "__main__":
    main()
