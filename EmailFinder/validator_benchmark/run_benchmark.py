#!/usr/bin/env python3
import json
import subprocess
import time
from pathlib import Path
from typing import Any

from email_validator import EmailNotValidError, validate_email

ROOT = Path(__file__).resolve().parent
DATASET_PATH = ROOT / "dataset.json"
NODE_SCRIPT = ROOT / "node_benchmark.mjs"
NODE_OUT = ROOT / "node_results.json"
REPORT_OUT = ROOT / "benchmark_report.json"


def run_python_email_validator(dataset: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for row in dataset:
        email = row["email"]
        started = time.perf_counter()
        pred: bool | None = None
        error = None
        raw = None
        try:
            res = validate_email(email, check_deliverability=True)
            pred = True
            raw = {
                "normalized": res.normalized,
                "domain": res.domain,
                "mx": bool(getattr(res, "mx", None)),
            }
        except EmailNotValidError as exc:
            pred = False
            error = str(exc)
        except Exception as exc:  # noqa: BLE001
            pred = None
            error = str(exc)

        out[email] = {
            "predicted_accept": pred,
            "error": error,
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
            "raw": raw,
        }
    return out


def run_node_tools() -> dict[str, dict[str, Any]]:
    cmd = ["node", str(NODE_SCRIPT), str(DATASET_PATH), str(NODE_OUT)]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    print(proc.stdout)
    if proc.returncode != 0:
        raise RuntimeError(f"node benchmark failed: {proc.stderr.strip()}")

    data = json.loads(NODE_OUT.read_text())
    by_email: dict[str, dict[str, Any]] = {}
    for row in data["results"]:
        by_email[row["email"]] = {
            "deep_email_validator": row.get("deep_email_validator", {}),
            "email_validator_js": row.get("email_validator_js", {}),
        }
    return by_email


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
    node_preds = run_node_tools()

    rows: list[dict[str, Any]] = []
    for row in dataset:
        email = row["email"]
        npreds = node_preds.get(email, {})
        tool_predictions = {
            "python_email_validator": py_preds.get(email, {}).get("predicted_accept"),
            "deep_email_validator": npreds.get("deep_email_validator", {}).get("predicted_accept"),
            "email_validator_js": npreds.get("email_validator_js", {}).get("predicted_accept"),
        }
        rows.append(
            {
                "email": email,
                "expected_accept": row["expected_accept"],
                "source": row["source"],
                "tool_predictions": tool_predictions,
                "tool_details": {
                    "python_email_validator": py_preds.get(email, {}),
                    "deep_email_validator": npreds.get("deep_email_validator", {}),
                    "email_validator_js": npreds.get("email_validator_js", {}),
                },
            }
        )

    tools = ["python_email_validator", "deep_email_validator", "email_validator_js"]
    metrics = [compute_metrics(rows, tool) for tool in tools]
    metrics.sort(key=lambda x: (x["strict_accuracy"] if x["strict_accuracy"] is not None else -1), reverse=True)

    report = {
        "dataset_size": len(rows),
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "metrics_ranked_by_strict_accuracy": metrics,
        "rows": rows,
    }
    REPORT_OUT.write_text(json.dumps(report, indent=2))
    print(f"Wrote {REPORT_OUT}")

    print("\nRanked tools (strict accuracy):")
    for m in metrics:
        print(
            f"- {m['tool']}: strict_accuracy={m['strict_accuracy']} coverage={m['coverage']} "
            f"accuracy_on_covered={m['accuracy_on_covered']} unknown={m['unknown']}"
        )


if __name__ == "__main__":
    main()
