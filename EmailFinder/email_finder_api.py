#!/usr/bin/env python3
"""
Email Finder API

Minimal HTTP JSON API for ordered email candidate generation + sequential verification.

Endpoints:
- GET /health
- POST /v1/guess
- POST /v1/guess/batch
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import smtplib
import string
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

from email_finder_lab import (
    build_pattern_profile,
    build_pattern_scores,
    check_catch_all,
    classify_smtp,
    generate_local_parts,
    lookup_mx,
    smtp_rcpt_probe,
)


DOMAIN_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]+)+$")
EMAIL_ADDR_RE = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$")
VALIDATEDMAILS_URL = "https://api.validatedmails.com/validate"
MAX_BATCH_ITEMS = 200
MAX_BATCH_CONCURRENCY = 10
DOMAIN_FINGERPRINTS_PATH = os.getenv("DOMAIN_FINGERPRINTS_PATH", "domain_fingerprints.json")
RETRY_QUEUE_PATH = os.getenv("RETRY_QUEUE_PATH", "retry_queue.json")
OUTCOMES_PATH = os.getenv("OUTCOMES_PATH", "delivery_outcomes.json")
FILE_LOCK = Lock()
RETRY_REASON_TRANSIENT = "transient-verification-result"
DEFAULT_SMTP_MX_QUORUM = 2


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.end_headers()
    handler.wfile.write(body)


def parse_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "yes", "y", "on"}:
            return True
        if lowered in {"0", "false", "no", "n", "off"}:
            return False
    return default


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_json_file(path: str, default: Any) -> Any:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default
    except json.JSONDecodeError:
        return default
    except OSError:
        return default


def save_json_file(path: str, payload: Any) -> None:
    tmp_path = f"{path}.tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, sort_keys=True, indent=2, ensure_ascii=True)
        f.write("\n")
    os.replace(tmp_path, path)


def parse_retry_delays(value: Any, default: list[int]) -> list[int]:
    if value is None:
        return list(default)
    if not isinstance(value, list):
        raise ValueError("retry_delays_seconds must be an array when provided")
    delays: list[int] = []
    for idx, raw in enumerate(value):
        try:
            parsed = int(raw)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"retry_delays_seconds[{idx}] must be an integer") from exc
        delays.append(max(1, min(parsed, 7 * 24 * 3600)))
    if not delays:
        raise ValueError("retry_delays_seconds must include at least one delay")
    return delays[:5]


def parse_nonnegative_int(value: Any, field: str, default: int, max_value: int) -> int:
    parsed = bounded_int(value, field=field, default=default, min_value=0, max_value=max_value)
    return parsed


def make_retry_id() -> str:
    return f"rq_{int(time.time() * 1000)}_{random.randint(1000, 9999)}"


def random_local_part(length: int = 14) -> str:
    chars = string.ascii_lowercase + string.digits
    return "".join(random.choice(chars) for _ in range(max(4, length)))


def clamp(value: float, lo: float, hi: float) -> float:
    return max(lo, min(value, hi))


def probability_to_odds(p: float) -> float:
    p = clamp(p, 1e-6, 1.0 - 1e-6)
    return p / (1.0 - p)


def odds_to_probability(odds: float) -> float:
    if odds <= 0:
        return 0.0
    return odds / (1.0 + odds)


def rcpt_code_to_status(code: int | None, catch_all_likely: bool) -> str:
    return classify_smtp(code, catch_all_likely=catch_all_likely)


def smtp_multi_rcpt_probe(
    *,
    mx_host: str,
    rcpt_targets: list[str],
    from_address: str,
    timeout_seconds: float,
    catch_all_likely: bool,
) -> dict[str, Any]:
    result = {
        "mx_host": mx_host,
        "targets": [],
        "error": None,
    }
    smtp = None
    try:
        smtp = smtplib.SMTP(mx_host, 25, timeout=timeout_seconds)
        smtp.ehlo_or_helo_if_needed()
        try:
            if smtp.has_extn("starttls"):
                smtp.starttls()
                smtp.ehlo()
        except smtplib.SMTPException:
            pass
        mail_code, mail_msg = smtp.mail(from_address)
        if mail_code >= 500:
            result["error"] = f"MAIL FROM rejected: {mail_code} {mail_msg!r}"
            return result

        for target in rcpt_targets:
            code, msg = smtp.rcpt(target)
            result["targets"].append(
                {
                    "email": target,
                    "smtp_code": code,
                    "smtp_message": str(msg.decode(errors="replace") if isinstance(msg, bytes) else msg),
                    "smtp_status": rcpt_code_to_status(code, catch_all_likely=catch_all_likely),
                }
            )
    except Exception as exc:  # noqa: BLE001
        result["error"] = str(exc)
    finally:
        if smtp is not None:
            try:
                smtp.quit()
            except Exception:  # noqa: BLE001
                try:
                    smtp.close()
                except Exception:  # noqa: BLE001
                    pass
    return result


def aggregate_multi_mx_status(host_results: list[dict[str, Any]]) -> tuple[str, str]:
    statuses = [str(r.get("smtp_status", "unknown")).strip().lower() for r in host_results]
    if not statuses:
        return "unknown", "no smtp host results"

    accepted = sum(1 for s in statuses if s == "accepted")
    accept_all = sum(1 for s in statuses if s == "accept-all-likely")
    rejected = sum(1 for s in statuses if s == "rejected")
    temp_fail = sum(1 for s in statuses if s == "temporary-failure")
    cannot_verify = sum(1 for s in statuses if s in {"cannot-verify", "indeterminate"})
    majority = (len(statuses) // 2) + 1

    if rejected > 0 and (accepted > 0 or accept_all > 0):
        return "indeterminate", "mixed accepted and rejected across mx hosts"
    if rejected >= majority:
        return "rejected", "majority rejected across mx hosts"
    if accept_all >= majority:
        return "accept-all-likely", "majority accept-all-likely across mx hosts"
    if accepted >= majority:
        return "accepted", "majority accepted across mx hosts"
    if accepted + accept_all >= majority:
        return "accept-all-likely", "accepted across hosts with catch-all signal present"
    if temp_fail >= majority:
        return "temporary-failure", "majority temporary failures across mx hosts"
    if cannot_verify >= majority:
        return "cannot-verify", "majority cannot-verify/indeterminate across mx hosts"
    return "indeterminate", "no clear majority across mx hosts"


def run_sequence_sensitivity_check(
    *,
    mx_host: str,
    target_email: str,
    from_address: str,
    timeout_seconds: float,
    catch_all_likely: bool,
) -> dict[str, Any]:
    domain = target_email.split("@", 1)[1]
    random_email = f"{random_local_part()}@{domain}"
    forward = smtp_multi_rcpt_probe(
        mx_host=mx_host,
        rcpt_targets=[target_email, random_email],
        from_address=from_address,
        timeout_seconds=timeout_seconds,
        catch_all_likely=catch_all_likely,
    )
    reverse = smtp_multi_rcpt_probe(
        mx_host=mx_host,
        rcpt_targets=[random_email, target_email],
        from_address=from_address,
        timeout_seconds=timeout_seconds,
        catch_all_likely=catch_all_likely,
    )

    forward_target = next((x for x in forward.get("targets", []) if x.get("email") == target_email), {})
    reverse_target = next((x for x in reverse.get("targets", []) if x.get("email") == target_email), {})
    code_a = forward_target.get("smtp_code")
    code_b = reverse_target.get("smtp_code")
    status_a = str(forward_target.get("smtp_status", "unknown"))
    status_b = str(reverse_target.get("smtp_status", "unknown"))
    sequence_sensitive = (code_a != code_b) or (status_a != status_b)

    return {
        "mx_host": mx_host,
        "random_companion_email": random_email,
        "target_first": {
            "target_code": code_a,
            "target_status": status_a,
            "error": forward.get("error"),
        },
        "random_first": {
            "target_code": code_b,
            "target_status": status_b,
            "error": reverse.get("error"),
        },
        "sequence_sensitive": sequence_sensitive,
    }


def compute_attempt_p_valid(
    *,
    attempt: dict[str, Any],
    candidate_index: int,
    candidate_count: int,
    pattern_score: float | None,
) -> float:
    verdict = str(attempt.get("verdict", "unknown")).strip().lower()
    confidence = str(attempt.get("confidence", "low")).strip().lower()
    details = attempt.get("details", {})
    if not isinstance(details, dict):
        details = {}

    if pattern_score is not None:
        prior = clamp(0.15 + (0.70 * float(pattern_score)), 0.02, 0.95)
    else:
        denom = max(candidate_count - 1, 1)
        order_score = 1.0 - (candidate_index / denom)
        prior = clamp(0.20 + (0.50 * order_score), 0.02, 0.90)

    verdict_multiplier = {
        "likely-valid": 5.0,
        "risky-valid": 2.0,
        "invalid": 0.03,
        "unknown": 1.0,
    }.get(verdict, 1.0)
    confidence_multiplier = {
        "high": 1.40,
        "medium": 1.15,
        "low": 0.90,
    }.get(confidence, 1.0)

    accept_all = details.get("accept_all") is True or str(details.get("smtp_status", "")).strip().lower() == "accept-all-likely"
    accept_all_multiplier = 0.55 if accept_all else 1.0

    sequence = details.get("sequence_sensitivity", {})
    sequence_sensitive = isinstance(sequence, dict) and bool(sequence.get("sequence_sensitive"))
    sequence_multiplier = 0.70 if sequence_sensitive else 1.0

    mx_multiplier = 1.0
    multi_mx = details.get("multi_mx", {})
    if isinstance(multi_mx, dict):
        host_statuses = multi_mx.get("host_statuses", [])
        if isinstance(host_statuses, list):
            statuses = [str(x.get("smtp_status", "")).strip().lower() for x in host_statuses if isinstance(x, dict)]
            if statuses:
                if "rejected" in statuses and ("accepted" in statuses or "accept-all-likely" in statuses):
                    mx_multiplier *= 0.65
                elif all(s == "accepted" for s in statuses):
                    mx_multiplier *= 1.25
                elif all(s in {"accepted", "accept-all-likely"} for s in statuses) and any(s == "accept-all-likely" for s in statuses):
                    mx_multiplier *= 0.75

    odds = probability_to_odds(prior)
    odds *= verdict_multiplier
    odds *= confidence_multiplier
    odds *= accept_all_multiplier
    odds *= sequence_multiplier
    odds *= mx_multiplier
    odds = clamp(odds, 0.001, 1_000.0)
    return round(odds_to_probability(odds), 4)


def confidence_rank(level: str) -> int:
    table = {
        "none": -1,
        "low": 0,
        "medium": 1,
        "high": 2,
    }
    return table.get(level, -1)


def normalize_confidence_threshold(value: Any, default: str = "high") -> str:
    text = str(value if value is not None else default).strip().lower()
    if text in {"none", "off", "disabled"}:
        return "none"
    if text in {"low", "medium", "high"}:
        return text
    raise ValueError("stop_on_min_confidence must be one of: none, low, medium, high")


def bounded_int(value: Any, *, field: str, default: int, min_value: int, max_value: int) -> int:
    if value is None:
        parsed = default
    else:
        try:
            parsed = int(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{field} must be an integer") from exc
    return max(min_value, min(parsed, max_value))


def bounded_float(value: Any, *, field: str, default: float, min_value: float, max_value: float) -> float:
    if value is None:
        parsed = default
    else:
        try:
            parsed = float(value)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"{field} must be a number") from exc
    return max(min_value, min(parsed, max_value))


def validate_input(
    payload: dict[str, Any],
) -> tuple[
    str,
    str,
    int,
    list[str],
    str,
    float,
    int,
    str,
    bool,
    list[str],
    str,
    int,
    str,
    bool,
    bool,
    bool,
    int,
    int,
    int,
    float,
    bool,
    bool,
    list[int],
    int,
    int,
    int,
    bool,
]:
    name = str(payload.get("name", "")).strip()
    domain = str(payload.get("domain", "")).strip().lower()
    if not name:
        raise ValueError("name is required")
    if not domain:
        raise ValueError("domain is required")
    if not DOMAIN_RE.match(domain):
        raise ValueError("domain format is invalid")

    max_candidates = bounded_int(
        payload.get("max_candidates", 12),
        field="max_candidates",
        default=12,
        min_value=1,
        max_value=50,
    )

    known_emails = payload.get("known_emails", [])
    if known_emails is None:
        known_emails = []
    if not isinstance(known_emails, list):
        raise ValueError("known_emails must be an array")
    known_emails = [str(x).strip().lower() for x in known_emails if str(x).strip()]

    mode = str(payload.get("verification_mode", "validatedmails")).strip().lower()
    if mode not in {"none", "smtp", "validatedmails"}:
        raise ValueError("verification_mode must be one of: none, smtp, validatedmails")

    timeout_seconds = bounded_float(
        payload.get("probe_timeout_seconds", 8.0),
        field="probe_timeout_seconds",
        default=8.0,
        min_value=1.0,
        max_value=30.0,
    )

    pause_ms = bounded_int(payload.get("pause_ms", 250), field="pause_ms", default=250, min_value=0, max_value=5000)

    from_address = str(payload.get("from_address", "probe@localhost")).strip()
    if "@" not in from_address:
        raise ValueError("from_address must look like an email address")

    stop_on_first_hit = parse_bool(payload.get("stop_on_first_hit", True), default=True)

    hit_statuses = payload.get("hit_statuses")
    if hit_statuses is None:
        hit_status_list = ["likely-valid", "risky-valid"]
    elif isinstance(hit_statuses, list):
        hit_status_list = [str(x).strip().lower() for x in hit_statuses if str(x).strip()]
    else:
        raise ValueError("hit_statuses must be an array when provided")

    api_key = str(payload.get("validatedmails_api_key") or os.getenv("VALIDATEDMAILS_API_KEY", "")).strip()
    max_credits = bounded_int(payload.get("max_credits", 7), field="max_credits", default=7, min_value=1, max_value=500)
    stop_on_min_confidence = normalize_confidence_threshold(payload.get("stop_on_min_confidence", "high"), default="high")
    high_confidence_only = parse_bool(payload.get("high_confidence_only", True), default=True)
    enable_risky_queue = parse_bool(payload.get("enable_risky_queue", True), default=True)
    canary_mode = parse_bool(payload.get("canary_mode", False), default=False)

    canary_observations = payload.get("canary_observations", {})
    if canary_observations is None:
        canary_observations = {}
    if not isinstance(canary_observations, dict):
        raise ValueError("canary_observations must be an object when provided")
    canary_sent = bounded_int(
        canary_observations.get("sent", 0),
        field="canary_observations.sent",
        default=0,
        min_value=0,
        max_value=1_000_000,
    )
    canary_hard_bounces = bounded_int(
        canary_observations.get("hard_bounces", 0),
        field="canary_observations.hard_bounces",
        default=0,
        min_value=0,
        max_value=1_000_000,
    )
    if canary_hard_bounces > canary_sent:
        raise ValueError("canary_observations.hard_bounces cannot exceed canary_observations.sent")

    canary_policy = payload.get("canary_policy", {})
    if canary_policy is None:
        canary_policy = {}
    if not isinstance(canary_policy, dict):
        raise ValueError("canary_policy must be an object when provided")
    canary_min_samples = bounded_int(
        canary_policy.get("min_samples", 25),
        field="canary_policy.min_samples",
        default=25,
        min_value=1,
        max_value=100_000,
    )
    canary_max_hard_bounce_rate = bounded_float(
        canary_policy.get("max_hard_bounce_rate", 0.03),
        field="canary_policy.max_hard_bounce_rate",
        default=0.03,
        min_value=0.0,
        max_value=1.0,
    )
    enable_domain_fingerprint = parse_bool(payload.get("enable_domain_fingerprint", True), default=True)
    enable_retry_scheduler = parse_bool(payload.get("enable_retry_scheduler", True), default=True)
    retry_delays_seconds = parse_retry_delays(payload.get("retry_delays_seconds"), default=[300, 1800])
    retry_jitter_seconds = parse_nonnegative_int(
        payload.get("retry_jitter_seconds", 45),
        field="retry_jitter_seconds",
        default=45,
        max_value=3600,
    )
    retry_max_items = bounded_int(
        payload.get("retry_max_items", 10),
        field="retry_max_items",
        default=10,
        min_value=1,
        max_value=100,
    )
    smtp_mx_quorum = bounded_int(
        payload.get("smtp_mx_quorum", DEFAULT_SMTP_MX_QUORUM),
        field="smtp_mx_quorum",
        default=DEFAULT_SMTP_MX_QUORUM,
        min_value=1,
        max_value=5,
    )
    smtp_sequence_check = parse_bool(payload.get("smtp_sequence_check", True), default=True)

    return (
        name,
        domain,
        max_candidates,
        known_emails,
        mode,
        timeout_seconds,
        pause_ms,
        from_address,
        stop_on_first_hit,
        hit_status_list,
        api_key,
        max_credits,
        stop_on_min_confidence,
        high_confidence_only,
        enable_risky_queue,
        canary_mode,
        canary_sent,
        canary_hard_bounces,
        canary_min_samples,
        canary_max_hard_bounce_rate,
        enable_domain_fingerprint,
        enable_retry_scheduler,
        retry_delays_seconds,
        retry_jitter_seconds,
        retry_max_items,
        smtp_mx_quorum,
        smtp_sequence_check,
    )


def build_candidates(name: str, domain: str, max_candidates: int, known_emails: list[str]) -> tuple[list[str], dict[str, float], dict[str, Any]]:
    local_parts = generate_local_parts(name)
    if not local_parts:
        raise ValueError("could not generate candidates from name")

    generated = [f"{local}@{domain}" for local in local_parts][:max_candidates]
    pattern_scores: dict[str, float] = {}
    ordering_meta: dict[str, Any] = {"method": "generation_order"}

    if known_emails:
        profile = build_pattern_profile(known_emails, domain)
        rows = build_pattern_scores(generated, profile)
        ordered = [r["email"] for r in rows]
        pattern_scores = {r["email"]: float(r["pattern_score"]) for r in rows}
        ordering_meta = {
            "method": "pattern_score",
            "profile": profile,
            "scores": rows,
        }
        return ordered, pattern_scores, ordering_meta

    return generated, pattern_scores, ordering_meta


def infer_validatedmails_verdict(response_payload: dict[str, Any]) -> tuple[str, str]:
    status = str(response_payload.get("status", "")).strip().lower()
    accept_all = bool(response_payload.get("accept_all"))

    if status == "valid":
        return ("risky-valid", "valid + accept_all=true") if accept_all else ("likely-valid", "valid + accept_all=false")
    if status == "invalid":
        return ("invalid", "status=invalid")
    if status == "unknown":
        return ("unknown", "status=unknown")

    is_valid = response_payload.get("is_valid")
    if isinstance(is_valid, bool):
        if is_valid:
            return ("risky-valid", "is_valid=true + accept_all=true") if accept_all else ("likely-valid", "is_valid=true")
        return ("invalid", "is_valid=false")
    return ("unknown", "unrecognized response status")


def verify_with_validatedmails(email: str, api_key: str, timeout_seconds: float) -> dict[str, Any]:
    request_body = json.dumps({"email": email}).encode("utf-8")
    request = Request(
        VALIDATEDMAILS_URL,
        data=request_body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    started = time.perf_counter()
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            raw = response.read().decode("utf-8", errors="replace")
            status_code = response.getcode()
        payload = json.loads(raw)
        verdict, reason = infer_validatedmails_verdict(payload)
        return {
            "verdict": verdict,
            "reason": reason,
            "http_status": status_code,
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
            "provider_status": payload.get("status"),
            "provider_reason": payload.get("reason"),
            "accept_all": payload.get("accept_all"),
            "smtp_ok": payload.get("smtp_ok"),
            "score": payload.get("score"),
            "trace_id": payload.get("trace_id"),
            "raw": payload,
        }
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        return {
            "verdict": "unknown",
            "reason": f"http {exc.code}",
            "http_status": exc.code,
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
            "error": detail or str(exc),
        }
    except URLError as exc:
        return {
            "verdict": "unknown",
            "reason": "network error",
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
            "error": str(exc),
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "verdict": "unknown",
            "reason": "unexpected error",
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
            "error": str(exc),
        }


def smtp_status_to_verdict(status: str) -> tuple[str, str]:
    if status == "accepted":
        return "likely-valid", "smtp accepted recipient"
    if status == "accept-all-likely":
        return "risky-valid", "domain appears accept-all"
    if status == "rejected":
        return "invalid", "smtp rejected recipient"
    return "unknown", f"smtp status={status}"


def infer_confidence(mode: str, verdict: str, details: dict[str, Any]) -> str:
    if mode == "validatedmails":
        provider_status = str(details.get("provider_status", "")).strip().lower()
        accept_all = details.get("accept_all")
        score = details.get("score")
        if provider_status == "invalid":
            return "high"
        if verdict == "likely-valid":
            if accept_all is False and isinstance(score, (int, float)):
                if float(score) >= 90:
                    return "high"
                return "medium"
            return "medium"
        if verdict == "risky-valid":
            if isinstance(score, (int, float)) and float(score) >= 85:
                return "medium"
            return "low"
        if provider_status == "unknown":
            return "low"
        return "low"

    if mode == "smtp":
        smtp_status = str(details.get("smtp_status", "")).strip().lower()
        sequence = details.get("sequence_sensitivity", {})
        if isinstance(sequence, dict) and bool(sequence.get("sequence_sensitive")):
            return "low"
        if smtp_status == "accepted":
            multi_mx = details.get("multi_mx", {})
            host_statuses = multi_mx.get("host_statuses", []) if isinstance(multi_mx, dict) else []
            if isinstance(host_statuses, list) and host_statuses:
                statuses = {str(x.get("smtp_status", "")).strip().lower() for x in host_statuses if isinstance(x, dict)}
                if statuses == {"accepted"}:
                    return "high"
                return "medium"
            return "high"
        if smtp_status == "accept-all-likely":
            return "low"
        if smtp_status == "rejected":
            return "high"
        if smtp_status in {"indeterminate", "cannot-verify"}:
            return "low"
        return "low"

    return "low"


def verify_candidates(
    ordered_emails: list[str],
    mode: str,
    timeout_seconds: float,
    pause_ms: int,
    from_address: str,
    api_key: str,
    stop_on_first_hit: bool,
    hit_statuses: list[str],
    max_credits: int,
    stop_on_min_confidence: str,
    pattern_scores: dict[str, float] | None = None,
    smtp_mx_quorum: int = DEFAULT_SMTP_MX_QUORUM,
    smtp_sequence_check: bool = True,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    attempts: list[dict[str, Any]] = []
    verification_meta: dict[str, Any] = {
        "mode": mode,
        "max_credits": max_credits if mode == "validatedmails" else 0,
        "credits_used": 0,
        "stop_on_min_confidence": stop_on_min_confidence,
        "bayesian_scoring": "enabled",
    }
    hit_set = {s.lower() for s in hit_statuses}

    mx_hosts: list[str] = []
    catch_all_by_mx: dict[str, bool] = {}
    catch_all_probe_by_mx: dict[str, dict[str, Any]] = {}

    if mode == "smtp":
        domain = ordered_emails[0].split("@", 1)[1] if ordered_emails else ""
        mx_records = lookup_mx(domain, enable_doh=True, doh_use_curl=False, timeout=timeout_seconds)
        verification_meta["mx_records"] = [{"priority": p, "host": h} for p, h in mx_records]
        if not mx_records:
            raise ValueError("no mx records found for smtp verification")
        mx_hosts = [host for _priority, host in mx_records][: max(1, smtp_mx_quorum)]
        verification_meta["mx_hosts"] = mx_hosts
        verification_meta["smtp_mx_quorum"] = max(1, smtp_mx_quorum)
        verification_meta["smtp_sequence_check"] = smtp_sequence_check

        for mx_host in mx_hosts:
            catch_all_likely, catch_probe = check_catch_all(mx_host, domain, from_address, timeout_seconds)
            catch_all_by_mx[mx_host] = catch_all_likely
            catch_all_probe_by_mx[mx_host] = {
                "code": catch_probe.code,
                "message": catch_probe.message,
                "error": catch_probe.error,
                "mx_host": catch_probe.mx_host,
                "catch_all_likely": catch_all_likely,
            }
        verification_meta["mx_host"] = mx_hosts[0]
        verification_meta["catch_all_likely"] = catch_all_by_mx.get(mx_hosts[0], False)
        verification_meta["catch_all_probe"] = catch_all_probe_by_mx.get(mx_hosts[0], {})
        verification_meta["catch_all_probe_by_mx"] = catch_all_probe_by_mx

    for idx, email in enumerate(ordered_emails, start=1):
        if mode == "validatedmails" and verification_meta["credits_used"] >= max_credits:
            verification_meta["stopped_early"] = True
            verification_meta["stop_reason"] = "max_credits_reached"
            break

        if mode == "none":
            verdict = "unknown"
            reason = "verification disabled"
            details = {"verdict": verdict, "reason": reason}
        elif mode == "validatedmails":
            if not api_key:
                raise ValueError("validatedmails_api_key is required for verification_mode=validatedmails")
            details = verify_with_validatedmails(email=email, api_key=api_key, timeout_seconds=timeout_seconds)
            verdict = str(details.get("verdict", "unknown")).lower()
            reason = str(details.get("reason", ""))
        else:
            assert mode == "smtp"
            if not mx_hosts:
                raise ValueError("smtp verification requires mx hosts")
            per_host_results: list[dict[str, Any]] = []
            for mx_host in mx_hosts:
                probe = smtp_rcpt_probe(mx_host=mx_host, target_email=email, from_address=from_address, timeout=timeout_seconds)
                host_status = classify_smtp(probe.code, catch_all_likely=catch_all_by_mx.get(mx_host, False))
                per_host_results.append(
                    {
                        "mx_host": mx_host,
                        "smtp_status": host_status,
                        "smtp_code": probe.code,
                        "smtp_message": probe.message,
                        "smtp_error": probe.error,
                        "catch_all_likely": catch_all_by_mx.get(mx_host, False),
                    }
                )

            smtp_status, aggregate_reason = aggregate_multi_mx_status(per_host_results)
            verdict, reason = smtp_status_to_verdict(smtp_status)
            if aggregate_reason:
                reason = f"{reason}; {aggregate_reason}"

            sequence_sensitivity = None
            primary_mx = mx_hosts[0]
            if smtp_sequence_check:
                sequence_sensitivity = run_sequence_sensitivity_check(
                    mx_host=primary_mx,
                    target_email=email,
                    from_address=from_address,
                    timeout_seconds=timeout_seconds,
                    catch_all_likely=catch_all_by_mx.get(primary_mx, False),
                )

            primary_result = next((x for x in per_host_results if x.get("mx_host") == primary_mx), per_host_results[0])
            details = {
                "verdict": verdict,
                "reason": reason,
                "smtp_status": smtp_status,
                "smtp_code": primary_result.get("smtp_code"),
                "smtp_message": primary_result.get("smtp_message"),
                "smtp_error": primary_result.get("smtp_error"),
                "mx_host": primary_result.get("mx_host"),
                "multi_mx": {
                    "quorum": len(mx_hosts),
                    "aggregated_status": smtp_status,
                    "aggregated_reason": aggregate_reason,
                    "host_statuses": per_host_results,
                },
                "sequence_sensitivity": sequence_sensitivity,
            }

        confidence = infer_confidence(mode=mode, verdict=verdict, details=details)
        if mode == "validatedmails":
            verification_meta["credits_used"] += 1

        attempt = {
            "attempt": idx,
            "email": email,
            "verdict": verdict,
            "confidence": confidence,
            "is_hit": verdict in hit_set,
            "details": details,
        }
        p_valid = compute_attempt_p_valid(
            attempt=attempt,
            candidate_index=idx - 1,
            candidate_count=len(ordered_emails),
            pattern_score=(pattern_scores or {}).get(email),
        )
        attempt["p_valid"] = p_valid
        if isinstance(attempt.get("details"), dict):
            attempt["details"]["p_valid"] = p_valid
        attempts.append(attempt)

        if (
            stop_on_first_hit
            and attempt["is_hit"]
            and confidence_rank(attempt["confidence"]) >= confidence_rank(stop_on_min_confidence)
        ):
            verification_meta["stopped_early"] = True
            verification_meta["stop_reason"] = f"hit at attempt {idx} with confidence={attempt['confidence']}"
            break

        if pause_ms > 0 and idx < len(ordered_emails):
            time.sleep(pause_ms / 1000.0)

    verification_meta.setdefault("stopped_early", False)
    return attempts, verification_meta


def new_fingerprint_entry(domain: str) -> dict[str, Any]:
    return {
        "domain": domain,
        "created_at": utc_now_iso(),
        "updated_at": utc_now_iso(),
        "request_count": 0,
        "total_attempts": 0,
        "verdict_counts": {},
        "confidence_counts": {},
        "smtp_status_counts": {},
        "provider_status_counts": {},
        "mx_host_counts": {},
        "catch_all_signals": 0,
        "temp_fail_signals": 0,
        "sequence_sensitive_signals": 0,
        "outcome_counts": {},
        "outcome_events": 0,
    }


def increment_counter(counter: dict[str, int], key: str) -> None:
    if not key:
        return
    counter[key] = counter.get(key, 0) + 1


def summarize_fingerprint(entry: dict[str, Any]) -> dict[str, Any]:
    total_attempts = int(entry.get("total_attempts", 0))
    catch_all_signals = int(entry.get("catch_all_signals", 0))
    temp_fail_signals = int(entry.get("temp_fail_signals", 0))
    sequence_sensitive_signals = int(entry.get("sequence_sensitive_signals", 0))
    catch_all_rate = round(catch_all_signals / total_attempts, 4) if total_attempts > 0 else 0.0
    temp_fail_rate = round(temp_fail_signals / total_attempts, 4) if total_attempts > 0 else 0.0
    sequence_sensitive_rate = round(sequence_sensitive_signals / total_attempts, 4) if total_attempts > 0 else 0.0
    outcome_counts = entry.get("outcome_counts", {})
    if not isinstance(outcome_counts, dict):
        outcome_counts = {}
    delivered_outcomes = int(outcome_counts.get("delivered", 0))
    hard_bounce_outcomes = int(outcome_counts.get("hard_bounce", 0))
    soft_bounce_outcomes = int(outcome_counts.get("soft_bounce", 0))
    terminal_outcomes = delivered_outcomes + hard_bounce_outcomes + soft_bounce_outcomes
    observed_hard_bounce_rate = round(hard_bounce_outcomes / terminal_outcomes, 4) if terminal_outcomes > 0 else None
    observed_delivery_rate = round(delivered_outcomes / terminal_outcomes, 4) if terminal_outcomes > 0 else None
    risk_hint = "normal"
    if catch_all_rate >= 0.5:
        risk_hint = "accept-all-likely"
    elif temp_fail_rate >= 0.35:
        risk_hint = "transient-or-throttled"
    elif sequence_sensitive_rate >= 0.25:
        risk_hint = "sequence-sensitive"
    return {
        "domain": entry.get("domain"),
        "request_count": int(entry.get("request_count", 0)),
        "total_attempts": total_attempts,
        "catch_all_rate": catch_all_rate,
        "temp_fail_rate": temp_fail_rate,
        "sequence_sensitive_rate": sequence_sensitive_rate,
        "risk_hint": risk_hint,
        "outcome_events": int(entry.get("outcome_events", 0)),
        "outcome_counts": outcome_counts,
        "terminal_outcomes": terminal_outcomes,
        "observed_hard_bounce_rate": observed_hard_bounce_rate,
        "observed_delivery_rate": observed_delivery_rate,
        "verdict_counts": entry.get("verdict_counts", {}),
        "confidence_counts": entry.get("confidence_counts", {}),
        "smtp_status_counts": entry.get("smtp_status_counts", {}),
        "provider_status_counts": entry.get("provider_status_counts", {}),
        "mx_host_counts": entry.get("mx_host_counts", {}),
        "updated_at": entry.get("updated_at"),
    }


def update_domain_fingerprint(
    *,
    domain: str,
    attempts: list[dict[str, Any]],
    verification_meta: dict[str, Any],
    mode: str,
) -> dict[str, Any]:
    with FILE_LOCK:
        store = load_json_file(DOMAIN_FINGERPRINTS_PATH, {"version": 1, "domains": {}})
        if not isinstance(store, dict):
            store = {"version": 1, "domains": {}}
        domains = store.get("domains")
        if not isinstance(domains, dict):
            domains = {}
            store["domains"] = domains

        raw_entry = domains.get(domain)
        if not isinstance(raw_entry, dict):
            raw_entry = new_fingerprint_entry(domain)
            domains[domain] = raw_entry

        entry = raw_entry
        entry["updated_at"] = utc_now_iso()
        entry["request_count"] = int(entry.get("request_count", 0)) + 1
        mx_host = verification_meta.get("mx_host")
        if isinstance(mx_host, str):
            increment_counter(entry.setdefault("mx_host_counts", {}), mx_host)

        for attempt in attempts:
            entry["total_attempts"] = int(entry.get("total_attempts", 0)) + 1
            verdict = str(attempt.get("verdict", "unknown")).strip().lower()
            confidence = str(attempt.get("confidence", "low")).strip().lower()
            increment_counter(entry.setdefault("verdict_counts", {}), verdict)
            increment_counter(entry.setdefault("confidence_counts", {}), confidence)
            details = attempt.get("details", {})
            if isinstance(details, dict):
                smtp_status = str(details.get("smtp_status", "")).strip().lower()
                provider_status = str(details.get("provider_status", "")).strip().lower()
                if smtp_status:
                    increment_counter(entry.setdefault("smtp_status_counts", {}), smtp_status)
                if provider_status:
                    increment_counter(entry.setdefault("provider_status_counts", {}), provider_status)
                accept_all = details.get("accept_all")
                if accept_all is True or smtp_status == "accept-all-likely" or verdict == "risky-valid":
                    entry["catch_all_signals"] = int(entry.get("catch_all_signals", 0)) + 1
                smtp_code = details.get("smtp_code")
                if (
                    smtp_status in {"temporary-failure", "cannot-verify", "indeterminate"}
                    or verdict == "unknown"
                    or (isinstance(smtp_code, int) and 400 <= smtp_code < 500)
                ):
                    entry["temp_fail_signals"] = int(entry.get("temp_fail_signals", 0)) + 1
                sequence = details.get("sequence_sensitivity", {})
                if isinstance(sequence, dict) and bool(sequence.get("sequence_sensitive")):
                    entry["sequence_sensitive_signals"] = int(entry.get("sequence_sensitive_signals", 0)) + 1

        save_json_file(DOMAIN_FINGERPRINTS_PATH, store)
        return {
            "enabled": True,
            "path": DOMAIN_FINGERPRINTS_PATH,
            "summary": summarize_fingerprint(entry),
        }


def normalize_outcome_result(value: Any) -> str:
    text = str(value or "").strip().lower()
    mapping = {
        "delivered": "delivered",
        "delivered_ok": "delivered",
        "hard_bounce": "hard_bounce",
        "hard-bounce": "hard_bounce",
        "bounce_hard": "hard_bounce",
        "soft_bounce": "soft_bounce",
        "soft-bounce": "soft_bounce",
        "bounce_soft": "soft_bounce",
        "sent": "sent",
        "queued": "sent",
        "unknown": "unknown",
    }
    if text in mapping:
        return mapping[text]
    return "unknown"


def parse_outcome_events(payload: dict[str, Any]) -> list[dict[str, Any]]:
    raw_events = payload.get("events")
    if raw_events is None:
        raw_events = [payload]
    if not isinstance(raw_events, list) or not raw_events:
        raise ValueError("events must be a non-empty array, or provide a single event object")

    parsed: list[dict[str, Any]] = []
    for idx, raw in enumerate(raw_events):
        if not isinstance(raw, dict):
            raise ValueError(f"events[{idx}] must be an object")
        email = str(raw.get("email", "")).strip().lower()
        if not EMAIL_ADDR_RE.match(email):
            raise ValueError(f"events[{idx}].email is invalid")
        local, derived_domain = email.split("@", 1)
        _ = local
        domain = str(raw.get("domain", derived_domain)).strip().lower()
        if domain != derived_domain:
            raise ValueError(f"events[{idx}].domain must match email domain")

        result = normalize_outcome_result(raw.get("result"))
        if result == "unknown":
            if parse_bool(raw.get("hard_bounce"), False):
                result = "hard_bounce"
            elif parse_bool(raw.get("soft_bounce"), False):
                result = "soft_bounce"
            elif parse_bool(raw.get("delivered"), False):
                result = "delivered"
            elif parse_bool(raw.get("sent"), False):
                result = "sent"

        observed_at = str(raw.get("observed_at", raw.get("sent_at", ""))).strip()
        metadata = raw.get("metadata", {})
        if metadata is None:
            metadata = {}
        if not isinstance(metadata, dict):
            raise ValueError(f"events[{idx}].metadata must be an object when provided")

        parsed.append(
            {
                "email": email,
                "domain": domain,
                "result": result,
                "observed_at": observed_at or None,
                "metadata": metadata,
            }
        )
    return parsed


def record_outcomes(payload: dict[str, Any]) -> dict[str, Any]:
    events = parse_outcome_events(payload)
    recorded_at = utc_now_iso()
    event_rows = []
    for event in events:
        event_rows.append(
            {
                "event_id": f"out_{int(time.time() * 1000)}_{random.randint(1000, 9999)}",
                "recorded_at": recorded_at,
                **event,
            }
        )

    terminal_results = {"delivered", "hard_bounce", "soft_bounce"}
    resolved_retry_items = 0
    touched_domains: set[str] = set()

    with FILE_LOCK:
        outcomes_doc = load_json_file(OUTCOMES_PATH, {"version": 1, "events": []})
        if not isinstance(outcomes_doc, dict):
            outcomes_doc = {"version": 1, "events": []}
        events_list = outcomes_doc.get("events")
        if not isinstance(events_list, list):
            events_list = []
            outcomes_doc["events"] = events_list
        events_list.extend(event_rows)
        save_json_file(OUTCOMES_PATH, outcomes_doc)

        fp_doc = load_json_file(DOMAIN_FINGERPRINTS_PATH, {"version": 1, "domains": {}})
        if not isinstance(fp_doc, dict):
            fp_doc = {"version": 1, "domains": {}}
        domains = fp_doc.get("domains")
        if not isinstance(domains, dict):
            domains = {}
            fp_doc["domains"] = domains

        for event in event_rows:
            domain = event["domain"]
            touched_domains.add(domain)
            entry = domains.get(domain)
            if not isinstance(entry, dict):
                entry = new_fingerprint_entry(domain)
                domains[domain] = entry
            entry["updated_at"] = recorded_at
            entry["outcome_events"] = int(entry.get("outcome_events", 0)) + 1
            result = event["result"]
            increment_counter(entry.setdefault("outcome_counts", {}), result)

        save_json_file(DOMAIN_FINGERPRINTS_PATH, fp_doc)

        queue_doc = load_json_file(RETRY_QUEUE_PATH, {"version": 1, "items": []})
        if not isinstance(queue_doc, dict):
            queue_doc = {"version": 1, "items": []}
        queue_items = queue_doc.get("items")
        if not isinstance(queue_items, list):
            queue_items = []
            queue_doc["items"] = queue_items

        terminal_by_key = {
            (event["domain"], event["email"]): event["result"]
            for event in event_rows
            if event["result"] in terminal_results
        }

        if terminal_by_key:
            for item in queue_items:
                if not isinstance(item, dict):
                    continue
                if str(item.get("state", "")).lower() != "pending":
                    continue
                key = (str(item.get("domain", "")).lower(), str(item.get("email", "")).lower())
                outcome = terminal_by_key.get(key)
                if not outcome:
                    continue
                item["state"] = "failed" if outcome == "hard_bounce" else "resolved"
                item["resolved_at"] = recorded_at
                item["resolved_reason"] = f"outcome:{outcome}"
                item["last_verdict"] = "invalid" if outcome == "hard_bounce" else "likely-valid"
                resolved_retry_items += 1
            save_json_file(RETRY_QUEUE_PATH, queue_doc)

        summaries = []
        for domain in sorted(touched_domains):
            entry = domains.get(domain)
            if isinstance(entry, dict):
                summaries.append(summarize_fingerprint(entry))

    return {
        "ok": True,
        "recorded_count": len(event_rows),
        "events": event_rows,
        "outcomes_path": OUTCOMES_PATH,
        "resolved_retry_items": resolved_retry_items,
        "domain_summaries": summaries,
    }


def should_schedule_retry(mode: str, attempt: dict[str, Any]) -> tuple[bool, str]:
    verdict = str(attempt.get("verdict", "unknown")).strip().lower()
    if verdict in {"invalid", "likely-valid", "risky-valid"}:
        return False, ""

    details = attempt.get("details", {})
    if not isinstance(details, dict):
        return True, RETRY_REASON_TRANSIENT

    smtp_status = str(details.get("smtp_status", "")).strip().lower()
    smtp_code = details.get("smtp_code")
    provider_status = str(details.get("provider_status", "")).strip().lower()
    reason = str(details.get("reason", "")).strip().lower()

    if mode == "smtp":
        seq = details.get("sequence_sensitivity", {})
        if isinstance(seq, dict) and bool(seq.get("sequence_sensitive")):
            return True, RETRY_REASON_TRANSIENT
        if smtp_status in {"temporary-failure", "cannot-verify", "indeterminate"}:
            return True, RETRY_REASON_TRANSIENT
        if isinstance(smtp_code, int) and 400 <= smtp_code < 500:
            return True, RETRY_REASON_TRANSIENT
        if "timed out" in reason:
            return True, RETRY_REASON_TRANSIENT
        return False, ""

    if mode == "validatedmails":
        if provider_status == "unknown" or verdict == "unknown":
            return True, RETRY_REASON_TRANSIENT
        return False, ""

    return verdict == "unknown", RETRY_REASON_TRANSIENT if verdict == "unknown" else ""


def enqueue_retries(
    *,
    domain: str,
    attempts: list[dict[str, Any]],
    mode: str,
    timeout_seconds: float,
    from_address: str,
    retry_delays_seconds: list[int],
    retry_jitter_seconds: int,
    retry_max_items: int,
    smtp_mx_quorum: int,
    smtp_sequence_check: bool,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    candidates: list[dict[str, Any]] = []
    for attempt in attempts:
        should_retry, retry_reason = should_schedule_retry(mode, attempt)
        if not should_retry:
            continue
        if len(candidates) >= retry_max_items:
            break

        delays = []
        next_retry_at = None
        for delay_seconds in retry_delays_seconds:
            jitter = random.randint(0, retry_jitter_seconds) if retry_jitter_seconds > 0 else 0
            total_delay = int(delay_seconds) + jitter
            scheduled = now + timedelta(seconds=total_delay)
            delays.append(total_delay)
            if next_retry_at is None:
                next_retry_at = scheduled

        candidates.append(
            {
                "id": make_retry_id(),
                "domain": domain,
                "email": attempt["email"],
                "attempt": attempt["attempt"],
                "reason": retry_reason,
                "state": "pending",
                "created_at": utc_now_iso(),
                "next_retry_at": next_retry_at.isoformat() if next_retry_at else utc_now_iso(),
                "planned_delays_seconds": delays,
                "retries_done": 0,
                "verification_mode": mode,
                "probe_timeout_seconds": timeout_seconds,
                "from_address": from_address,
                "smtp_mx_quorum": smtp_mx_quorum,
                "smtp_sequence_check": smtp_sequence_check,
            }
        )

    if not candidates:
        return {
            "enabled": True,
            "path": RETRY_QUEUE_PATH,
            "enqueued": 0,
            "skipped_existing": 0,
            "items": [],
        }

    with FILE_LOCK:
        queue_doc = load_json_file(RETRY_QUEUE_PATH, {"version": 1, "items": []})
        if not isinstance(queue_doc, dict):
            queue_doc = {"version": 1, "items": []}
        items = queue_doc.get("items")
        if not isinstance(items, list):
            items = []
            queue_doc["items"] = items

        existing = {
            (str(x.get("domain", "")).lower(), str(x.get("email", "")).lower())
            for x in items
            if isinstance(x, dict) and str(x.get("state", "")).lower() == "pending"
        }

        enqueued = []
        skipped_existing = 0
        for item in candidates:
            key = (item["domain"].lower(), item["email"].lower())
            if key in existing:
                skipped_existing += 1
                continue
            items.append(item)
            existing.add(key)
            enqueued.append(item)

        save_json_file(RETRY_QUEUE_PATH, queue_doc)
        return {
            "enabled": True,
            "path": RETRY_QUEUE_PATH,
            "enqueued": len(enqueued),
            "skipped_existing": skipped_existing,
            "items": enqueued,
        }


def parse_iso_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        if text.endswith("Z"):
            text = f"{text[:-1]}+00:00"
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def run_retry_worker(payload: dict[str, Any]) -> dict[str, Any]:
    limit = bounded_int(payload.get("limit", 25), field="limit", default=25, min_value=1, max_value=500)
    dry_run = parse_bool(payload.get("dry_run", False), default=False)
    domain_filter = str(payload.get("domain", "")).strip().lower()

    now = datetime.now(timezone.utc)
    due_items: list[dict[str, Any]] = []
    with FILE_LOCK:
        queue_doc = load_json_file(RETRY_QUEUE_PATH, {"version": 1, "items": []})
        if not isinstance(queue_doc, dict):
            queue_doc = {"version": 1, "items": []}
        queue_items = queue_doc.get("items")
        if not isinstance(queue_items, list):
            queue_items = []
            queue_doc["items"] = queue_items

        for item in queue_items:
            if not isinstance(item, dict):
                continue
            if str(item.get("state", "")).lower() != "pending":
                continue
            item_domain = str(item.get("domain", "")).strip().lower()
            if domain_filter and item_domain != domain_filter:
                continue
            next_retry_at = parse_iso_dt(item.get("next_retry_at"))
            if next_retry_at is None or next_retry_at <= now:
                due_items.append(dict(item))

    due_items.sort(key=lambda x: str(x.get("next_retry_at", "")))
    due_items = due_items[:limit]

    processed_rows = []
    update_attempts_by_domain: dict[str, list[dict[str, Any]]] = {}
    updates_by_id: dict[str, dict[str, Any]] = {}
    updates_by_domain_email: dict[tuple[str, str], dict[str, Any]] = {}

    for item in due_items:
        queue_id = str(item.get("id", "")).strip()
        email = str(item.get("email", "")).strip().lower()
        domain = str(item.get("domain", "")).strip().lower()
        mode = str(item.get("verification_mode", "smtp")).strip().lower()
        timeout_seconds = bounded_float(
            item.get("probe_timeout_seconds", 8.0),
            field="probe_timeout_seconds",
            default=8.0,
            min_value=1.0,
            max_value=30.0,
        )
        from_address = str(item.get("from_address", "probe@localhost")).strip()
        smtp_mx_quorum = bounded_int(
            item.get("smtp_mx_quorum", DEFAULT_SMTP_MX_QUORUM),
            field="smtp_mx_quorum",
            default=DEFAULT_SMTP_MX_QUORUM,
            min_value=1,
            max_value=5,
        )
        smtp_sequence_check = parse_bool(item.get("smtp_sequence_check", True), default=True)

        attempt_row: dict[str, Any]
        verification_meta: dict[str, Any]
        try:
            attempts, verification_meta = verify_candidates(
                ordered_emails=[email],
                mode=mode,
                timeout_seconds=timeout_seconds,
                pause_ms=0,
                from_address=from_address,
                api_key=os.getenv("VALIDATEDMAILS_API_KEY", ""),
                stop_on_first_hit=False,
                hit_statuses=["likely-valid", "risky-valid"],
                max_credits=1,
                stop_on_min_confidence="none",
                pattern_scores=None,
                smtp_mx_quorum=smtp_mx_quorum,
                smtp_sequence_check=smtp_sequence_check,
            )
            if attempts:
                attempt_row = attempts[0]
            else:
                attempt_row = {
                    "attempt": 1,
                    "email": email,
                    "verdict": "unknown",
                    "confidence": "low",
                    "p_valid": 0.5,
                    "details": {"reason": "no attempts produced"},
                }
        except Exception as exc:  # noqa: BLE001
            verification_meta = {"mode": mode, "error": str(exc)}
            attempt_row = {
                "attempt": 1,
                "email": email,
                "verdict": "unknown",
                "confidence": "low",
                "p_valid": 0.5,
                "details": {"reason": f"retry-worker error: {exc}"},
            }

        verdict = str(attempt_row.get("verdict", "unknown")).strip().lower()
        retries_done_before = int(item.get("retries_done", 0))
        retries_done_after = retries_done_before + 1
        planned = item.get("planned_delays_seconds", [])
        if not isinstance(planned, list):
            planned = []
        planned = [int(x) for x in planned if isinstance(x, (int, float, str)) and str(x).isdigit()]
        is_terminal = verdict in {"likely-valid", "risky-valid", "invalid"}

        item_update = {
            "queue_id": queue_id,
            "email": email,
            "domain": domain,
            "verification_mode": mode,
            "retries_done_before": retries_done_before,
            "retries_done_after": retries_done_after,
            "attempt": attempt_row,
            "verification": verification_meta,
            "state": "pending",
            "resolved_reason": None,
            "next_retry_at": item.get("next_retry_at"),
        }

        if is_terminal:
            item_update["state"] = "resolved" if verdict != "invalid" else "failed"
            item_update["resolved_reason"] = f"terminal_verdict:{verdict}"
            item_update["next_retry_at"] = None
        elif retries_done_after >= len(planned):
            item_update["state"] = "failed"
            item_update["resolved_reason"] = "retry_budget_exhausted"
            item_update["next_retry_at"] = None
        else:
            next_delay = int(planned[retries_done_after])
            item_update["next_retry_at"] = (now + timedelta(seconds=next_delay)).isoformat()

        processed_rows.append(item_update)
        if queue_id:
            updates_by_id[queue_id] = item_update
        updates_by_domain_email[(domain, email)] = item_update
        if not dry_run:
            update_attempts_by_domain.setdefault(domain, []).append(attempt_row)

    if not dry_run and processed_rows:
        with FILE_LOCK:
            queue_doc = load_json_file(RETRY_QUEUE_PATH, {"version": 1, "items": []})
            if not isinstance(queue_doc, dict):
                queue_doc = {"version": 1, "items": []}
            queue_items = queue_doc.get("items")
            if not isinstance(queue_items, list):
                queue_items = []
                queue_doc["items"] = queue_items

            for item in queue_items:
                if not isinstance(item, dict):
                    continue
                queue_id = str(item.get("id", "")).strip()
                update = updates_by_id.get(queue_id)
                if not update:
                    key = (str(item.get("domain", "")).lower(), str(item.get("email", "")).lower())
                    update = updates_by_domain_email.get(key)
                if not update:
                    continue
                item["retries_done"] = update["retries_done_after"]
                item["last_attempt_at"] = utc_now_iso()
                attempt = update["attempt"]
                item["last_verdict"] = attempt.get("verdict")
                item["last_confidence"] = attempt.get("confidence")
                item["last_p_valid"] = attempt.get("p_valid")
                item["last_reason"] = str((attempt.get("details") or {}).get("reason", ""))
                item["state"] = update["state"]
                if update["state"] == "pending":
                    item["next_retry_at"] = update["next_retry_at"]
                else:
                    item["resolved_at"] = utc_now_iso()
                    item["resolved_reason"] = update["resolved_reason"]
                    item["next_retry_at"] = None
            save_json_file(RETRY_QUEUE_PATH, queue_doc)

        for domain, attempts in update_attempts_by_domain.items():
            try:
                update_domain_fingerprint(
                    domain=domain,
                    attempts=attempts,
                    verification_meta={"mode": "retry-worker"},
                    mode="retry-worker",
                )
            except Exception:  # noqa: BLE001
                pass

    state_counts: dict[str, int] = {}
    for row in processed_rows:
        state = str(row.get("state", "pending"))
        state_counts[state] = state_counts.get(state, 0) + 1

    return {
        "ok": True,
        "dry_run": dry_run,
        "limit": limit,
        "processed_count": len(processed_rows),
        "state_counts": state_counts,
        "items": processed_rows,
        "retry_queue_path": RETRY_QUEUE_PATH,
    }

def queue_item_from_attempt(attempt: dict[str, Any], route: str, reason: str) -> dict[str, Any]:
    return {
        "email": attempt["email"],
        "attempt": attempt["attempt"],
        "verdict": attempt["verdict"],
        "confidence": attempt["confidence"],
        "p_valid": attempt.get("p_valid"),
        "route": route,
        "route_reason": reason,
    }


def sort_queue_by_probability(items: list[dict[str, Any]]) -> None:
    items.sort(
        key=lambda x: (
            -(float(x.get("p_valid")) if isinstance(x.get("p_valid"), (int, float)) else -1.0),
            int(x.get("attempt", 10_000)),
        )
    )


def route_attempts(
    attempts: list[dict[str, Any]],
    *,
    high_confidence_only: bool,
    enable_risky_queue: bool,
    canary_mode: bool,
    canary_sent: int,
    canary_hard_bounces: int,
    canary_min_samples: int,
    canary_max_hard_bounce_rate: float,
) -> dict[str, Any]:
    high_confidence: list[dict[str, Any]] = []
    risky_queue: list[dict[str, Any]] = []
    suppressed: list[dict[str, Any]] = []
    review_queue: list[dict[str, Any]] = []

    for attempt in attempts:
        verdict = str(attempt.get("verdict", "unknown")).lower()
        confidence = str(attempt.get("confidence", "low")).lower()

        if verdict == "invalid":
            suppressed.append(queue_item_from_attempt(attempt, "suppressed", "invalid verdict"))
            continue

        if verdict in {"likely-valid", "risky-valid"}:
            if verdict == "likely-valid" and confidence == "high":
                high_confidence.append(queue_item_from_attempt(attempt, "high_confidence", "likely-valid + high confidence"))
            else:
                if enable_risky_queue:
                    risky_queue.append(queue_item_from_attempt(attempt, "risky_queue", "catch-all or lower-confidence signal"))
                else:
                    review_queue.append(queue_item_from_attempt(attempt, "review_queue", "risky queue disabled"))
            continue

        review_queue.append(queue_item_from_attempt(attempt, "review_queue", "unknown or indeterminate verdict"))

    canary_hard_bounce_rate = round((canary_hard_bounces / canary_sent), 4) if canary_sent > 0 else None
    canary = {
        "enabled": canary_mode,
        "policy": {
            "min_samples": canary_min_samples,
            "max_hard_bounce_rate": canary_max_hard_bounce_rate,
        },
        "observations": {
            "sent": canary_sent,
            "hard_bounces": canary_hard_bounces,
            "hard_bounce_rate": canary_hard_bounce_rate,
        },
        "decision": "disabled",
        "decision_reason": "canary_mode=false",
        "promoted_count": 0,
        "suppressed_count": 0,
    }

    if canary_mode:
        if not risky_queue:
            canary["decision"] = "no_risky_candidates"
            canary["decision_reason"] = "no risky candidates to evaluate"
        elif canary_sent < canary_min_samples:
            canary["decision"] = "hold"
            canary["decision_reason"] = f"need at least {canary_min_samples} observed canary sends"
        elif canary_hard_bounce_rate is not None and canary_hard_bounce_rate <= canary_max_hard_bounce_rate:
            promoted = []
            for item in risky_queue:
                promoted_item = dict(item)
                promoted_item["route"] = "high_confidence"
                promoted_item["route_reason"] = "promoted by canary policy"
                promoted.append(promoted_item)
            high_confidence.extend(promoted)
            canary["decision"] = "promote"
            canary["decision_reason"] = (
                f"hard_bounce_rate {canary_hard_bounce_rate:.4f} <= threshold {canary_max_hard_bounce_rate:.4f}"
            )
            canary["promoted_count"] = len(promoted)
            risky_queue = []
        else:
            demoted = []
            for item in risky_queue:
                demoted_item = dict(item)
                demoted_item["route"] = "suppressed"
                demoted_item["route_reason"] = "suppressed by canary policy"
                demoted.append(demoted_item)
            suppressed.extend(demoted)
            canary["decision"] = "suppress"
            canary["decision_reason"] = (
                f"hard_bounce_rate {canary_hard_bounce_rate:.4f} > threshold {canary_max_hard_bounce_rate:.4f}"
                if canary_hard_bounce_rate is not None
                else "no canary bounce-rate signal"
            )
            canary["suppressed_count"] = len(demoted)
            risky_queue = []

    eligible_send_now = list(high_confidence)
    if not high_confidence_only:
        eligible_send_now.extend(risky_queue)
    sort_queue_by_probability(high_confidence)
    sort_queue_by_probability(risky_queue)
    sort_queue_by_probability(suppressed)
    sort_queue_by_probability(review_queue)
    sort_queue_by_probability(eligible_send_now)

    return {
        "high_confidence_only": high_confidence_only,
        "enable_risky_queue": enable_risky_queue,
        "queues": {
            "eligible_send_now": eligible_send_now,
            "high_confidence": high_confidence,
            "risky_queue": risky_queue,
            "suppressed": suppressed,
            "review_queue": review_queue,
        },
        "canary": canary,
    }


def build_best_guess(attempts: list[dict[str, Any]], routing: dict[str, Any] | None = None) -> dict[str, Any] | None:
    if not attempts:
        return None
    if routing:
        eligible = routing.get("queues", {}).get("eligible_send_now", [])
        if eligible:
            top = eligible[0]
            return {
                "email": top.get("email"),
                "verdict": top.get("verdict"),
                "attempt": top.get("attempt"),
                "confidence": top.get("confidence"),
                "p_valid": top.get("p_valid"),
                "route": top.get("route"),
            }
        if routing.get("high_confidence_only", False):
            return None
    for attempt in attempts:
        if attempt["verdict"] in {"likely-valid", "risky-valid"}:
            return {
                "email": attempt["email"],
                "verdict": attempt["verdict"],
                "attempt": attempt["attempt"],
                "confidence": attempt["confidence"],
                "p_valid": attempt.get("p_valid"),
            }
    # Fallback to top-ranked attempted email when no positive hit exists.
    first = attempts[0]
    return {
        "email": first["email"],
        "verdict": first["verdict"],
        "attempt": first["attempt"],
        "confidence": first["confidence"],
        "p_valid": first.get("p_valid"),
    }


def run_single_guess(payload: dict[str, Any]) -> dict[str, Any]:
    started = time.perf_counter()
    (
        name,
        domain,
        max_candidates,
        known_emails,
        mode,
        timeout_seconds,
        pause_ms,
        from_address,
        stop_on_first_hit,
        hit_statuses,
        api_key,
        max_credits,
        stop_on_min_confidence,
        high_confidence_only,
        enable_risky_queue,
        canary_mode,
        canary_sent,
        canary_hard_bounces,
        canary_min_samples,
        canary_max_hard_bounce_rate,
        enable_domain_fingerprint,
        enable_retry_scheduler,
        retry_delays_seconds,
        retry_jitter_seconds,
        retry_max_items,
        smtp_mx_quorum,
        smtp_sequence_check,
    ) = validate_input(payload)

    ordered_candidates, pattern_scores, ordering_meta = build_candidates(
        name=name,
        domain=domain,
        max_candidates=max_candidates,
        known_emails=known_emails,
    )

    attempts, verification_meta = verify_candidates(
        ordered_emails=ordered_candidates,
        mode=mode,
        timeout_seconds=timeout_seconds,
        pause_ms=pause_ms,
        from_address=from_address,
        api_key=api_key,
        stop_on_first_hit=stop_on_first_hit,
        hit_statuses=hit_statuses,
        max_credits=max_credits,
        stop_on_min_confidence=stop_on_min_confidence,
        pattern_scores=pattern_scores or None,
        smtp_mx_quorum=smtp_mx_quorum,
        smtp_sequence_check=smtp_sequence_check,
    )

    routing = route_attempts(
        attempts,
        high_confidence_only=high_confidence_only,
        enable_risky_queue=enable_risky_queue,
        canary_mode=canary_mode,
        canary_sent=canary_sent,
        canary_hard_bounces=canary_hard_bounces,
        canary_min_samples=canary_min_samples,
        canary_max_hard_bounce_rate=canary_max_hard_bounce_rate,
    )

    if enable_domain_fingerprint:
        domain_fingerprint = update_domain_fingerprint(
            domain=domain,
            attempts=attempts,
            verification_meta=verification_meta,
            mode=mode,
        )
    else:
        domain_fingerprint = {
            "enabled": False,
            "path": DOMAIN_FINGERPRINTS_PATH,
            "summary": None,
        }

    if enable_retry_scheduler:
        retry_scheduler = enqueue_retries(
            domain=domain,
            attempts=attempts,
            mode=mode,
            timeout_seconds=timeout_seconds,
            from_address=from_address,
            retry_delays_seconds=retry_delays_seconds,
            retry_jitter_seconds=retry_jitter_seconds,
            retry_max_items=retry_max_items,
            smtp_mx_quorum=smtp_mx_quorum,
            smtp_sequence_check=smtp_sequence_check,
        )
    else:
        retry_scheduler = {
            "enabled": False,
            "path": RETRY_QUEUE_PATH,
            "enqueued": 0,
            "skipped_existing": 0,
            "items": [],
        }

    best_guess = build_best_guess(attempts, routing=routing)
    return {
        "ok": True,
        "input": {
            "name": name,
            "domain": domain,
            "max_candidates": max_candidates,
            "known_emails_count": len(known_emails),
            "verification_mode": mode,
            "stop_on_first_hit": stop_on_first_hit,
            "stop_on_min_confidence": stop_on_min_confidence,
            "max_credits": max_credits if mode == "validatedmails" else 0,
            "hit_statuses": hit_statuses,
            "high_confidence_only": high_confidence_only,
            "enable_risky_queue": enable_risky_queue,
            "canary_mode": canary_mode,
            "canary_observations": {
                "sent": canary_sent,
                "hard_bounces": canary_hard_bounces,
            },
            "canary_policy": {
                "min_samples": canary_min_samples,
                "max_hard_bounce_rate": canary_max_hard_bounce_rate,
            },
            "enable_domain_fingerprint": enable_domain_fingerprint,
            "enable_retry_scheduler": enable_retry_scheduler,
            "retry_delays_seconds": retry_delays_seconds,
            "retry_jitter_seconds": retry_jitter_seconds,
            "retry_max_items": retry_max_items,
            "smtp_mx_quorum": smtp_mx_quorum,
            "smtp_sequence_check": smtp_sequence_check,
        },
        "ordering": ordering_meta,
        "pattern_scores": pattern_scores,
        "ordered_candidates": ordered_candidates,
        "attempts": attempts,
        "verification": verification_meta,
        "routing": routing,
        "domain_fingerprint": domain_fingerprint,
        "retry_scheduler": retry_scheduler,
        "best_guess": best_guess,
        "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
    }


class EmailFinderApiHandler(BaseHTTPRequestHandler):
    server_version = "EmailFinderAPI/1.0"

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query or "")
        if path == "/health":
            json_response(self, 200, {"ok": True, "service": "email-finder-api"})
            return
        if path == "/v1/fingerprint":
            domain = str((query.get("domain") or [""])[0]).strip().lower()
            with FILE_LOCK:
                store = load_json_file(DOMAIN_FINGERPRINTS_PATH, {"version": 1, "domains": {}})
            domains = store.get("domains", {}) if isinstance(store, dict) else {}
            if domain:
                entry = domains.get(domain) if isinstance(domains, dict) else None
                summary = summarize_fingerprint(entry) if isinstance(entry, dict) else None
                json_response(
                    self,
                    200,
                    {
                        "ok": True,
                        "path": DOMAIN_FINGERPRINTS_PATH,
                        "domain": domain,
                        "found": summary is not None,
                        "summary": summary,
                    },
                )
                return
            summaries: list[dict[str, Any]] = []
            if isinstance(domains, dict):
                for key, entry in domains.items():
                    if isinstance(entry, dict):
                        summaries.append(summarize_fingerprint(entry))
            summaries.sort(key=lambda x: int(x.get("total_attempts", 0)), reverse=True)
            json_response(
                self,
                200,
                {
                    "ok": True,
                    "path": DOMAIN_FINGERPRINTS_PATH,
                    "domain_count": len(summaries),
                    "domains": summaries[:100],
                },
            )
            return
        if path == "/v1/retry-queue":
            try:
                limit = int((query.get("limit") or ["50"])[0])
            except ValueError:
                limit = 50
            limit = max(1, min(limit, 500))
            domain = str((query.get("domain") or [""])[0]).strip().lower()
            with FILE_LOCK:
                queue_doc = load_json_file(RETRY_QUEUE_PATH, {"version": 1, "items": []})
            items = queue_doc.get("items", []) if isinstance(queue_doc, dict) else []
            if not isinstance(items, list):
                items = []
            filtered = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                item_domain = str(item.get("domain", "")).strip().lower()
                if domain and item_domain != domain:
                    continue
                filtered.append(item)
            filtered.sort(key=lambda x: str(x.get("next_retry_at", "")))
            json_response(
                self,
                200,
                {
                    "ok": True,
                    "path": RETRY_QUEUE_PATH,
                    "total_items": len(filtered),
                    "items": filtered[:limit],
                },
            )
            return
        json_response(self, 404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path not in {"/v1/guess", "/v1/guess/batch", "/v1/outcomes", "/v1/retry-queue/run"}:
            json_response(self, 404, {"ok": False, "error": "not found"})
            return

        content_length = self.headers.get("Content-Length", "0")
        try:
            size = int(content_length)
        except ValueError:
            json_response(self, 400, {"ok": False, "error": "invalid content-length"})
            return
        if size <= 0 or size > 1_000_000:
            json_response(self, 400, {"ok": False, "error": "request body must be between 1 and 1,000,000 bytes"})
            return

        raw = self.rfile.read(size)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:  # noqa: BLE001
            json_response(self, 400, {"ok": False, "error": "invalid json body"})
            return
        if not isinstance(payload, dict):
            json_response(self, 400, {"ok": False, "error": "json body must be an object"})
            return

        if path == "/v1/guess":
            try:
                json_response(self, 200, run_single_guess(payload))
            except ValueError as exc:
                json_response(self, 400, {"ok": False, "error": str(exc)})
            except Exception as exc:  # noqa: BLE001
                json_response(self, 500, {"ok": False, "error": "internal error", "detail": str(exc)})
            return

        if path == "/v1/outcomes":
            try:
                json_response(self, 200, record_outcomes(payload))
            except ValueError as exc:
                json_response(self, 400, {"ok": False, "error": str(exc)})
            except Exception as exc:  # noqa: BLE001
                json_response(self, 500, {"ok": False, "error": "internal error", "detail": str(exc)})
            return

        if path == "/v1/retry-queue/run":
            try:
                json_response(self, 200, run_retry_worker(payload))
            except ValueError as exc:
                json_response(self, 400, {"ok": False, "error": str(exc)})
            except Exception as exc:  # noqa: BLE001
                json_response(self, 500, {"ok": False, "error": "internal error", "detail": str(exc)})
            return

        # /v1/guess/batch
        started = time.perf_counter()
        items = payload.get("items")
        if not isinstance(items, list):
            json_response(self, 400, {"ok": False, "error": "items must be an array"})
            return
        if not items:
            json_response(self, 400, {"ok": False, "error": "items must not be empty"})
            return
        if len(items) > MAX_BATCH_ITEMS:
            json_response(self, 400, {"ok": False, "error": f"max {MAX_BATCH_ITEMS} items per batch"})
            return

        raw_concurrency = payload.get("concurrency", 1)
        try:
            concurrency = int(raw_concurrency)
        except (TypeError, ValueError):
            json_response(self, 400, {"ok": False, "error": "concurrency must be an integer"})
            return
        concurrency = max(1, min(concurrency, MAX_BATCH_CONCURRENCY))
        continue_on_error = parse_bool(payload.get("continue_on_error", True), default=True)

        # When continue_on_error is false, force sequential processing so we can stop deterministically.
        if not continue_on_error:
            concurrency = 1

        default_item = payload.get("default_item", {})
        if default_item is None:
            default_item = {}
        if not isinstance(default_item, dict):
            json_response(self, 400, {"ok": False, "error": "default_item must be an object when provided"})
            return

        merged_items: list[dict[str, Any]] = []
        for idx, item in enumerate(items):
            if not isinstance(item, dict):
                json_response(self, 400, {"ok": False, "error": f"items[{idx}] must be an object"})
                return
            merged = dict(default_item)
            merged.update(item)
            merged_items.append(merged)

        results: list[dict[str, Any]] = []

        def run_indexed(index: int, item_payload: dict[str, Any]) -> dict[str, Any]:
            item_id = item_payload.get("id")
            item_started = time.perf_counter()
            try:
                result = run_single_guess(item_payload)
                return {
                    "index": index,
                    "id": item_id,
                    "ok": True,
                    "result": result,
                    "elapsed_ms": round((time.perf_counter() - item_started) * 1000, 2),
                }
            except ValueError as exc:
                return {
                    "index": index,
                    "id": item_id,
                    "ok": False,
                    "error": str(exc),
                    "error_type": "validation_error",
                    "elapsed_ms": round((time.perf_counter() - item_started) * 1000, 2),
                }
            except Exception as exc:  # noqa: BLE001
                return {
                    "index": index,
                    "id": item_id,
                    "ok": False,
                    "error": str(exc),
                    "error_type": "internal_error",
                    "elapsed_ms": round((time.perf_counter() - item_started) * 1000, 2),
                }

        if concurrency == 1:
            for idx, item_payload in enumerate(merged_items):
                one = run_indexed(idx, item_payload)
                results.append(one)
                if not continue_on_error and not one["ok"]:
                    break
        else:
            with ThreadPoolExecutor(max_workers=concurrency) as executor:
                future_to_index = {
                    executor.submit(run_indexed, idx, item_payload): idx
                    for idx, item_payload in enumerate(merged_items)
                }
                interim: dict[int, dict[str, Any]] = {}
                for future in as_completed(future_to_index):
                    index = future_to_index[future]
                    interim[index] = future.result()
                results = [interim[i] for i in sorted(interim)]

        success_count = sum(1 for r in results if r.get("ok"))
        error_count = len(results) - success_count
        batch_response = {
            "ok": True,
            "mode": "batch",
            "item_count": len(merged_items),
            "processed_count": len(results),
            "success_count": success_count,
            "error_count": error_count,
            "concurrency": concurrency,
            "continue_on_error": continue_on_error,
            "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
            "results": results,
        }
        json_response(self, 200, batch_response)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Email Finder API server.")
    parser.add_argument("--host", default="127.0.0.1", help="Bind host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8080, help="Bind port (default: 8080)")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    server = ThreadingHTTPServer((args.host, args.port), EmailFinderApiHandler)
    print(f"Email Finder API listening on http://{args.host}:{args.port}")
    print("POST /v1/guess")
    print("POST /v1/guess/batch")
    print("POST /v1/outcomes")
    print("POST /v1/retry-queue/run")
    print("GET  /health")
    print("GET  /v1/fingerprint")
    print("GET  /v1/retry-queue")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
