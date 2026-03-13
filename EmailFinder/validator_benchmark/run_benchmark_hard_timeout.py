#!/usr/bin/env python3
import json
import subprocess
import time
from pathlib import Path
from typing import Any

from email_validator import EmailNotValidError, validate_email

ROOT = Path(__file__).resolve().parent
DATASET_PATH = ROOT / "dataset.json"
REPORT_OUT = ROOT / "benchmark_report_hard_timeout.json"


def run_cmd_json(cmd: list[str], timeout_sec: int) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_sec, check=False)
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        stdout = (proc.stdout or "").strip()
        if not stdout:
            return {
                "predicted_accept": None,
                "error": f"empty stdout (code={proc.returncode}) stderr={proc.stderr.strip()[:200]}",
                "elapsed_ms": elapsed_ms,
                "raw": None,
            }
        try:
            parsed = json.loads(stdout)
        except json.JSONDecodeError:
            return {
                "predicted_accept": None,
                "error": f"non-json stdout: {stdout[:200]}",
                "elapsed_ms": elapsed_ms,
                "raw": None,
            }

        parsed.setdefault("elapsed_ms", elapsed_ms)
        return parsed
    except subprocess.TimeoutExpired:
        return {
            "predicted_accept": None,
            "error": f"subprocess timeout > {timeout_sec}s",
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
            "raw": None,
        }


def run_python_email_validator(dataset: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for row in dataset:
        email = row["email"]
        started = time.perf_counter()
        try:
            res = validate_email(email, check_deliverability=True)
            out[email] = {
                "predicted_accept": True,
                "error": None,
                "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
                "raw": {
                    "normalized": res.normalized,
                    "domain": res.domain,
                },
            }
        except EmailNotValidError as exc:
            out[email] = {
                "predicted_accept": False,
                "error": str(exc),
                "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
                "raw": None,
            }
        except Exception as exc:  # noqa: BLE001
            out[email] = {
                "predicted_accept": None,
                "error": str(exc),
                "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
                "raw": None,
            }
    return out


def compute_metrics(rows: list[dict[str, Any]], tool_name: str) -> dict[str, Any]:
    total = len(rows)
    covered = 0
    correct_covered = 0
    strict_correct = 0
    unknown = 0

    tp = fp = tn = fn = 0

    for row in rows:
        expected = bool(row["expected_accept"])
        pred = row["tool_predictions"][tool_name]

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
    dataset = json.loads(DATASET_PATH.read_text())

    py_preds = run_python_email_validator(dataset)

    deep_preds: dict[str, dict[str, Any]] = {}
    ec_preds: dict[str, dict[str, Any]] = {}

    for row in dataset:
        email = row["email"]
        deep = run_cmd_json(["node", str(ROOT / "deep_one.mjs"), email], timeout_sec=20)
        deep_preds[email] = deep
        ec = run_cmd_json(["node", str(ROOT / "emailcheck_one.mjs"), email], timeout_sec=20)
        ec_preds[email] = ec
        print(
            f"{email} | deep={deep.get('predicted_accept')} ({deep.get('elapsed_ms')}ms) | "
            f"emailcheck={ec.get('predicted_accept')} ({ec.get('elapsed_ms')}ms)"
        )

    rows: list[dict[str, Any]] = []
    for row in dataset:
        email = row["email"]
        rows.append(
            {
                "email": email,
                "expected_accept": row["expected_accept"],
                "source": row["source"],
                "tool_predictions": {
                    "python_email_validator": py_preds[email]["predicted_accept"],
                    "deep_email_validator": deep_preds[email]["predicted_accept"],
                    "email_validator_js": ec_preds[email]["predicted_accept"],
                },
                "tool_details": {
                    "python_email_validator": py_preds[email],
                    "deep_email_validator": deep_preds[email],
                    "email_validator_js": ec_preds[email],
                },
            }
        )

    metrics = [
        compute_metrics(rows, "python_email_validator"),
        compute_metrics(rows, "deep_email_validator"),
        compute_metrics(rows, "email_validator_js"),
    ]
    metrics.sort(key=lambda m: (m["strict_accuracy"] if m["strict_accuracy"] is not None else -1), reverse=True)

    report = {
        "dataset_size": len(rows),
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "metrics_ranked_by_strict_accuracy": metrics,
        "rows": rows,
    }
    REPORT_OUT.write_text(json.dumps(report, indent=2))
    print(f"Wrote {REPORT_OUT}")

    print("\nRanked tools:")
    for m in metrics:
        print(
            f"- {m['tool']}: strict_accuracy={m['strict_accuracy']} coverage={m['coverage']} "
            f"accuracy_on_covered={m['accuracy_on_covered']} unknown={m['unknown']}"
        )


if __name__ == "__main__":
    main()
