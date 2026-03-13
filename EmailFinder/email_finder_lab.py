#!/usr/bin/env python3
"""
Email Finder Lab

A small CLI to explore how email finder pipelines work:
1) Generate likely email patterns from name + domain.
2) Run passive checks (syntax, DNS, MX).
3) Optionally run web-index OSINT checks.
4) Optionally run SMTP RCPT checks (only for domains you own or are authorized to test).
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import os
import random
import re
import socket
import string
import subprocess
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from statistics import mean, median
from typing import Iterable
from urllib.parse import quote as urlquote
from urllib.request import Request, urlopen

import smtplib


EMAIL_RE = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$")


@dataclass
class SmtpProbeResult:
    mx_host: str
    code: int | None
    message: str
    error: str | None = None


def normalize_name(name: str) -> list[str]:
    parts = [p.strip().lower() for p in re.split(r"\s+", name.strip()) if p.strip()]
    return [re.sub(r"[^a-z0-9'-]", "", p) for p in parts if p]


def unique_in_order(items: Iterable[str]) -> list[str]:
    seen = set()
    ordered = []
    for item in items:
        if item and item not in seen:
            seen.add(item)
            ordered.append(item)
    return ordered


def generate_local_parts(full_name: str) -> list[str]:
    parts = normalize_name(full_name)
    if not parts:
        return []
    first = parts[0]
    last = parts[-1] if len(parts) > 1 else ""
    fi = first[0] if first else ""
    li = last[0] if last else ""

    candidates = [first]
    if last:
        candidates.extend(
            [
                f"{first}.{last}",
                f"{first}_{last}",
                f"{first}-{last}",
                f"{first}{last}",
                f"{fi}{last}",
                f"{first}{li}",
                f"{fi}.{last}",
                f"{first}.{li}",
                f"{last}.{first}",
                f"{last}{fi}",
                f"{fi}_{last}",
                last,
            ]
        )

    cleaned = []
    for c in candidates:
        x = re.sub(r"\.+", ".", c.strip("."))
        x = re.sub(r"[_-]{2,}", "_", x)
        if x:
            cleaned.append(x)
    return unique_in_order(cleaned)


def local_shape(local_part: str) -> dict:
    has_dot = "." in local_part
    has_underscore = "_" in local_part
    has_hyphen = "-" in local_part

    if sum([has_dot, has_underscore, has_hyphen]) > 1:
        separator = "mixed"
        tokens = [t for t in re.split(r"[._-]+", local_part) if t]
    elif has_dot:
        separator = "."
        tokens = [t for t in local_part.split(".") if t]
    elif has_underscore:
        separator = "_"
        tokens = [t for t in local_part.split("_") if t]
    elif has_hyphen:
        separator = "-"
        tokens = [t for t in local_part.split("-") if t]
    else:
        separator = "none"
        tokens = [local_part]

    first = tokens[0] if tokens else ""
    second = tokens[1] if len(tokens) > 1 else ""
    return {
        "separator": separator,
        "token_count": len(tokens),
        "first_token_len": len(first),
        "second_token_len": len(second),
        "first_initial": len(first) == 1,
        "second_initial": len(second) == 1 if second else False,
        "has_digits": any(ch.isdigit() for ch in local_part),
    }


def distribution_score(value, counts: dict) -> float:
    total = sum(counts.values())
    # Laplace smoothing keeps unseen values from collapsing to zero.
    return (counts.get(value, 0) + 0.5) / (total + 0.5 * (len(counts) + 1))


def build_pattern_profile(known_emails: list[str], domain: str) -> dict:
    valid_known = []
    ignored = []
    for raw in known_emails:
        email = raw.strip().lower()
        if not email:
            continue
        if not EMAIL_RE.match(email):
            ignored.append({"email": email, "reason": "invalid email syntax"})
            continue
        local, d = email.split("@", 1)
        if d != domain:
            ignored.append({"email": email, "reason": "different domain"})
            continue
        valid_known.append({"email": email, "local_part": local, "shape": local_shape(local)})

    sep_counts: dict[str, int] = {}
    token_counts: dict[int, int] = {}
    first_initial_counts: dict[bool, int] = {}
    second_initial_counts: dict[bool, int] = {}
    digit_counts: dict[bool, int] = {}
    first_lengths = []
    second_lengths = []

    for item in valid_known:
        shape = item["shape"]
        sep_counts[shape["separator"]] = sep_counts.get(shape["separator"], 0) + 1
        token_counts[shape["token_count"]] = token_counts.get(shape["token_count"], 0) + 1
        first_initial_counts[shape["first_initial"]] = first_initial_counts.get(shape["first_initial"], 0) + 1
        second_initial_counts[shape["second_initial"]] = second_initial_counts.get(shape["second_initial"], 0) + 1
        digit_counts[shape["has_digits"]] = digit_counts.get(shape["has_digits"], 0) + 1
        first_lengths.append(shape["first_token_len"])
        if shape["second_token_len"] > 0:
            second_lengths.append(shape["second_token_len"])

    sample_size = len(valid_known)
    return {
        "stage": "completed" if sample_size else "empty",
        "sample_size": sample_size,
        "known_emails_used": [x["email"] for x in valid_known],
        "ignored_inputs": ignored,
        "separator_counts": sep_counts,
        "token_count_counts": token_counts,
        "first_initial_counts": first_initial_counts,
        "second_initial_counts": second_initial_counts,
        "digit_counts": digit_counts,
        "mean_first_token_len": (sum(first_lengths) / sample_size) if sample_size else None,
        "mean_second_token_len": (sum(second_lengths) / len(second_lengths)) if second_lengths else None,
    }


def score_candidate_with_pattern(local_part: str, profile: dict) -> float:
    if profile.get("sample_size", 0) == 0:
        return 0.5

    shape = local_shape(local_part)
    score = 0.0
    score += 0.40 * distribution_score(shape["separator"], profile.get("separator_counts", {}))
    score += 0.25 * distribution_score(shape["token_count"], profile.get("token_count_counts", {}))
    score += 0.15 * distribution_score(shape["first_initial"], profile.get("first_initial_counts", {}))
    score += 0.05 * distribution_score(shape["second_initial"], profile.get("second_initial_counts", {}))
    score += 0.05 * distribution_score(shape["has_digits"], profile.get("digit_counts", {}))

    mean_first = profile.get("mean_first_token_len")
    if mean_first:
        delta = abs(shape["first_token_len"] - float(mean_first))
        score += 0.10 * max(0.0, 1.0 - (delta / 10.0))

    return round(max(0.0, min(score, 1.0)), 3)


def build_pattern_scores(emails: list[str], profile: dict) -> list[dict]:
    rows = []
    for email in emails:
        local_part = email.split("@", 1)[0]
        rows.append(
            {
                "email": email,
                "pattern_score": score_candidate_with_pattern(local_part, profile),
                "shape": local_shape(local_part),
            }
        )
    rows.sort(key=lambda x: x["pattern_score"], reverse=True)
    return rows


def run_cmd_args(args: list[str]) -> str:
    try:
        out = subprocess.check_output(args, stderr=subprocess.DEVNULL, text=True)
        return out.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


def summarize_ms(values: list[float]) -> dict | None:
    if not values:
        return None
    return {
        "count": len(values),
        "min_ms": round(min(values), 2),
        "max_ms": round(max(values), 2),
        "mean_ms": round(mean(values), 2),
        "median_ms": round(median(values), 2),
    }


def count_values(values: list[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return counts


def load_benchmark_cases(csv_path: str, max_cases: int) -> dict:
    cases = []
    ignored = []
    try:
        with open(csv_path, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            if not reader.fieldnames or "email" not in [h.strip().lower() for h in reader.fieldnames]:
                return {
                    "stage": "error",
                    "reason": "benchmark CSV must include an 'email' column",
                    "cases": [],
                    "ignored": [],
                }

            for row in reader:
                if len(cases) >= max(max_cases, 1):
                    break
                email = str(row.get("email", "")).strip().lower()
                label = str(row.get("label", "unlabeled")).strip().lower() or "unlabeled"
                if not EMAIL_RE.match(email):
                    ignored.append({"email": email, "label": label, "reason": "invalid email syntax"})
                    continue
                local, domain = email.split("@", 1)
                cases.append({"email": email, "label": label, "domain": domain, "local_part": local})
    except FileNotFoundError:
        return {
            "stage": "error",
            "reason": f"benchmark file not found: {csv_path}",
            "cases": [],
            "ignored": [],
        }

    return {
        "stage": "completed",
        "case_count": len(cases),
        "cases": cases,
        "ignored": ignored,
    }


def smtp_timed_probe(
    mx_host: str,
    target_email: str,
    from_address: str,
    timeout: float,
    use_starttls: bool,
) -> dict:
    timings: dict[str, float] = {}
    result: dict = {
        "mx_host": mx_host,
        "email": target_email,
        "smtp_code": None,
        "smtp_message": "",
        "mail_code": None,
        "mail_message": "",
        "error": None,
        "status": "unknown",
        "timings_ms": {},
    }

    t_total = time.perf_counter()
    smtp = None
    try:
        t = time.perf_counter()
        smtp = smtplib.SMTP(mx_host, 25, timeout=timeout)
        timings["connect"] = time.perf_counter() - t

        t = time.perf_counter()
        ehlo_code, _ehlo_msg = smtp.ehlo()
        timings["ehlo"] = time.perf_counter() - t
        result["ehlo_code"] = ehlo_code

        if use_starttls and smtp.has_extn("starttls"):
            t = time.perf_counter()
            smtp.starttls()
            smtp.ehlo()
            timings["starttls"] = time.perf_counter() - t

        t = time.perf_counter()
        mail_code, mail_msg = smtp.mail(from_address)
        timings["mail_from"] = time.perf_counter() - t
        result["mail_code"] = mail_code
        result["mail_message"] = smtp_text(mail_msg)

        if mail_code >= 500:
            result["smtp_code"] = mail_code
            result["smtp_message"] = smtp_text(mail_msg)
            result["status"] = classify_smtp(mail_code, catch_all_likely=False)
        else:
            t = time.perf_counter()
            rcpt_code, rcpt_msg = smtp.rcpt(target_email)
            timings["rcpt_to"] = time.perf_counter() - t
            result["smtp_code"] = rcpt_code
            result["smtp_message"] = smtp_text(rcpt_msg)
            result["status"] = classify_smtp(rcpt_code, catch_all_likely=False)
    except Exception as exc:  # noqa: BLE001
        result["error"] = str(exc)
    finally:
        timings["total"] = time.perf_counter() - t_total
        result["timings_ms"] = {k: round(v * 1000.0, 2) for k, v in timings.items()}
        if smtp is not None:
            try:
                smtp.quit()
            except Exception:  # noqa: BLE001
                try:
                    smtp.close()
                except Exception:  # noqa: BLE001
                    pass

    return result


def run_timing_benchmark(
    cases: list[dict],
    runs: int,
    pause_ms: int,
    timeout: float,
    from_address: str,
    use_starttls: bool,
    enable_doh: bool,
    doh_use_curl: bool,
) -> dict:
    case_results = []
    all_attempts_for_label: dict[str, list[dict]] = {}

    for case in cases:
        email = case["email"]
        label = case.get("label", "unlabeled")
        domain = case["domain"]

        mx_records = lookup_mx(domain, enable_doh=enable_doh, doh_use_curl=doh_use_curl, timeout=timeout)
        row = {
            "email": email,
            "label": label,
            "domain": domain,
            "mx_records": [{"priority": p, "host": h} for p, h in mx_records],
            "attempts": [],
        }

        if not mx_records:
            row["summary"] = {"stage": "error", "reason": "no mx records"}
            case_results.append(row)
            continue

        mx_host = mx_records[0][1]
        for i in range(max(runs, 1)):
            probe = smtp_timed_probe(
                mx_host=mx_host,
                target_email=email,
                from_address=from_address,
                timeout=timeout,
                use_starttls=use_starttls,
            )
            probe["attempt"] = i + 1
            row["attempts"].append(probe)
            all_attempts_for_label.setdefault(label, []).append(probe)
            time.sleep(max(pause_ms, 0) / 1000.0)

        totals = [a.get("timings_ms", {}).get("total") for a in row["attempts"] if a.get("timings_ms", {}).get("total") is not None]
        connect_vals = [a.get("timings_ms", {}).get("connect") for a in row["attempts"] if a.get("timings_ms", {}).get("connect") is not None]
        rcpt_vals = [a.get("timings_ms", {}).get("rcpt_to") for a in row["attempts"] if a.get("timings_ms", {}).get("rcpt_to") is not None]
        statuses = [a.get("status", "unknown") for a in row["attempts"]]
        codes = [str(a.get("smtp_code")) for a in row["attempts"]]

        row["summary"] = {
            "stage": "completed",
            "status_counts": count_values(statuses),
            "smtp_code_counts": count_values(codes),
            "total_timing_ms": summarize_ms([float(v) for v in totals if isinstance(v, (int, float))]),
            "connect_timing_ms": summarize_ms([float(v) for v in connect_vals if isinstance(v, (int, float))]),
            "rcpt_timing_ms": summarize_ms([float(v) for v in rcpt_vals if isinstance(v, (int, float))]),
        }
        case_results.append(row)

    label_summary = {}
    for label, attempts in all_attempts_for_label.items():
        totals = [a.get("timings_ms", {}).get("total") for a in attempts if a.get("timings_ms", {}).get("total") is not None]
        rcpt_vals = [a.get("timings_ms", {}).get("rcpt_to") for a in attempts if a.get("timings_ms", {}).get("rcpt_to") is not None]
        statuses = [a.get("status", "unknown") for a in attempts]
        label_summary[label] = {
            "attempt_count": len(attempts),
            "status_counts": count_values(statuses),
            "total_timing_ms": summarize_ms([float(v) for v in totals if isinstance(v, (int, float))]),
            "rcpt_timing_ms": summarize_ms([float(v) for v in rcpt_vals if isinstance(v, (int, float))]),
        }

    return {
        "stage": "completed",
        "runs_per_email": max(runs, 1),
        "case_count": len(case_results),
        "cases": case_results,
        "label_summary": label_summary,
    }


def fetch_json_via_curl(url: str, timeout: float, headers: list[str] | None = None) -> tuple[dict | None, str | None]:
    args = ["curl", "-sS", "--max-time", f"{max(timeout, 1.0):.2f}"]
    for header in headers or []:
        args.extend(["-H", header])
    args.append(url)
    raw = run_cmd_args(args)
    if not raw:
        return None, "empty response"
    try:
        return json.loads(raw), None
    except json.JSONDecodeError:
        return None, "invalid json response"


def normalize_verifier_verdict(value: str) -> str:
    v = value.strip().lower()
    if v in {"valid", "deliverable", "verified"}:
        return "valid"
    if v in {"invalid", "undeliverable", "disposable", "reject"}:
        return "invalid"
    return "unknown"


def verify_with_hunter(email: str, timeout: float) -> dict:
    api_key = os.getenv("HUNTER_API_KEY", "").strip()
    if not api_key:
        return {"provider": "hunter", "stage": "skipped", "reason": "missing HUNTER_API_KEY"}

    url = (
        "https://api.hunter.io/v2/email-verifier"
        f"?email={urlquote(email)}&api_key={urlquote(api_key)}"
    )
    payload, err = fetch_json_via_curl(url, timeout=timeout)
    if err or not payload:
        return {"provider": "hunter", "stage": "error", "reason": err or "request failed"}

    data = payload.get("data", {}) if isinstance(payload, dict) else {}
    status_raw = str(data.get("status", "")).lower()
    verdict = normalize_verifier_verdict(status_raw)
    if status_raw in {"accept_all", "webmail", "unknown"}:
        verdict = "unknown"

    score_raw = data.get("score")
    confidence = None
    if isinstance(score_raw, (int, float)):
        confidence = round(float(score_raw) / 100.0, 3)

    return {
        "provider": "hunter",
        "stage": "completed",
        "raw_status": status_raw or "unknown",
        "verdict": verdict,
        "confidence": confidence,
    }


def verify_with_abstract(email: str, timeout: float) -> dict:
    api_key = os.getenv("ABSTRACT_API_KEY", "").strip()
    if not api_key:
        return {"provider": "abstract", "stage": "skipped", "reason": "missing ABSTRACT_API_KEY"}

    url = (
        "https://emailvalidation.abstractapi.com/v1/"
        f"?api_key={urlquote(api_key)}&email={urlquote(email)}"
    )
    payload, err = fetch_json_via_curl(url, timeout=timeout)
    if err or not payload:
        return {"provider": "abstract", "stage": "error", "reason": err or "request failed"}

    deliverability = str(payload.get("deliverability", "")).lower()
    verdict = normalize_verifier_verdict(deliverability)
    if deliverability in {"risky", "unknown"}:
        verdict = "unknown"

    quality = payload.get("quality_score")
    confidence = None
    if isinstance(quality, (int, float)):
        confidence = round(float(quality), 3)
    elif isinstance(quality, str):
        try:
            confidence = round(float(quality), 3)
        except ValueError:
            confidence = None

    return {
        "provider": "abstract",
        "stage": "completed",
        "raw_status": deliverability or "unknown",
        "verdict": verdict,
        "confidence": confidence,
    }


def provider_check(email: str, provider: str, timeout: float) -> dict:
    p = provider.strip().lower()
    if p == "hunter":
        return verify_with_hunter(email, timeout=timeout)
    if p == "abstract":
        return verify_with_abstract(email, timeout=timeout)
    return {"provider": p, "stage": "skipped", "reason": "unsupported provider"}


def consensus_verdict(votes: list[str]) -> str:
    valid_votes = votes.count("valid")
    invalid_votes = votes.count("invalid")
    if valid_votes > 0 and invalid_votes == 0:
        return "valid"
    if invalid_votes > 0 and valid_votes == 0:
        return "invalid"
    return "unknown"


def run_api_consensus(
    emails: list[str],
    providers: list[str],
    timeout: float,
    delay_ms: int,
) -> dict:
    normalized_providers = unique_in_order([p.strip().lower() for p in providers if p.strip()])
    if not normalized_providers:
        return {"stage": "skipped", "reason": "no providers configured", "results": []}

    rows = []
    for email in emails:
        provider_results = []
        for provider in normalized_providers:
            result = provider_check(email, provider, timeout=timeout)
            provider_results.append(result)
            time.sleep(max(delay_ms, 0) / 1000.0)

        votes = [r["verdict"] for r in provider_results if r.get("stage") == "completed" and r.get("verdict")]
        rows.append(
            {
                "email": email,
                "votes": votes,
                "consensus_verdict": consensus_verdict(votes),
                "provider_results": provider_results,
            }
        )

    return {
        "stage": "completed",
        "providers_requested": normalized_providers,
        "results": rows,
    }


def extract_between(text: str, tag: str) -> str:
    m = re.search(rf"<{tag}>(.*?)</{tag}>", text, flags=re.IGNORECASE | re.DOTALL)
    if not m:
        return ""
    return html.unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip()


def parse_rss_items(xml_text: str, max_items: int) -> list[dict]:
    items = []
    blocks = re.findall(r"<item>(.*?)</item>", xml_text, flags=re.IGNORECASE | re.DOTALL)
    for block in blocks[: max(max_items, 1)]:
        items.append(
            {
                "title": extract_between(block, "title"),
                "link": extract_between(block, "link"),
                "description": extract_between(block, "description"),
                "pub_date": extract_between(block, "pubDate"),
            }
        )
    return items


def bing_rss_search(query: str, timeout: float, max_items: int) -> list[dict]:
    url = f"https://www.bing.com/search?format=rss&q={urlquote(query)}"
    raw = run_cmd_args(
        [
            "curl",
            "-sS",
            "--max-time",
            f"{max(timeout, 1.0):.2f}",
            "-A",
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
            url,
        ]
    )
    if not raw:
        return []
    return parse_rss_items(raw, max_items=max_items)


def extract_domain_emails(text: str, domain: str) -> list[str]:
    rx = re.compile(rf"\b[A-Za-z0-9._%+-]+@{re.escape(domain)}\b", flags=re.IGNORECASE)
    return unique_in_order([m.group(0).lower() for m in rx.finditer(text)])


def run_osint_stage(
    name: str,
    domain: str,
    emails: list[str],
    timeout: float,
    max_results: int,
    max_candidate_checks: int,
    delay_ms: int,
) -> dict:
    discovery_queries = [f'"{name}" "@{domain}"', f'"@{domain}"']
    discovery_results = []
    discovered_emails: list[str] = []

    for q in discovery_queries:
        items = bing_rss_search(q, timeout=timeout, max_items=max_results)
        discovery_results.append({"query": q, "result_count": len(items), "results": items})
        for item in items:
            blob = " ".join([item.get("title", ""), item.get("description", ""), item.get("link", "")])
            discovered_emails.extend(extract_domain_emails(blob, domain))
        time.sleep(max(delay_ms, 0) / 1000.0)

    discovered_emails = unique_in_order(discovered_emails)
    discovered_locals = {e.split("@", 1)[0] for e in discovered_emails}

    candidate_scores = []
    for email in emails[: max(max_candidate_checks, 0)]:
        q = f'"{email}"'
        items = bing_rss_search(q, timeout=timeout, max_items=max_results)
        mention_urls = []
        for item in items:
            blob = " ".join([item.get("title", ""), item.get("description", ""), item.get("link", "")]).lower()
            if email.lower() in blob:
                link = item.get("link", "")
                if link:
                    mention_urls.append(link)
        mention_urls = unique_in_order(mention_urls)
        local_part = email.split("@", 1)[0]
        score = 0.0
        if mention_urls:
            score += 0.75
        if local_part in discovered_locals:
            score += 0.25
        candidate_scores.append(
            {
                "email": email,
                "query": q,
                "result_count": len(items),
                "exact_mentions": len(mention_urls),
                "mention_urls": mention_urls[:3],
                "osint_confidence": round(min(score, 1.0), 3),
            }
        )
        time.sleep(max(delay_ms, 0) / 1000.0)

    candidate_scores.sort(key=lambda x: x["osint_confidence"], reverse=True)
    return {
        "stage": "completed",
        "engine": "bing-rss",
        "discovery_queries": discovery_results,
        "discovered_domain_emails": discovered_emails,
        "candidate_scores": candidate_scores,
    }


def doh_lookup_via_urllib(domain: str, rrtype: str, timeout: float) -> dict | None:
    url = f"https://cloudflare-dns.com/dns-query?name={urlquote(domain)}&type={urlquote(rrtype)}"
    req = Request(
        url,
        headers={
            "accept": "application/dns-json",
            "user-agent": "email-finder-lab/1.0",
        },
    )
    try:
        with urlopen(req, timeout=max(timeout, 1.0)) as resp:
            return json.loads(resp.read().decode())
    except Exception:  # noqa: BLE001
        return None


def doh_lookup_via_curl(domain: str, rrtype: str, timeout: float) -> dict | None:
    url = f"https://cloudflare-dns.com/dns-query?name={urlquote(domain)}&type={urlquote(rrtype)}"
    out = run_cmd_args(
        [
            "curl",
            "-sS",
            "--max-time",
            f"{max(timeout, 1.0):.2f}",
            url,
            "-H",
            "accept: application/dns-json",
        ]
    )
    if not out:
        return None
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return None


def doh_lookup(domain: str, rrtype: str, timeout: float, use_curl: bool) -> dict | None:
    if use_curl:
        return doh_lookup_via_curl(domain, rrtype, timeout)

    payload = doh_lookup_via_urllib(domain, rrtype, timeout)
    if payload:
        return payload
    return doh_lookup_via_curl(domain, rrtype, timeout)


def doh_has_answers(payload: dict | None) -> bool:
    if not payload:
        return False
    if payload.get("Status") != 0:
        return False
    answers = payload.get("Answer")
    return isinstance(answers, list) and len(answers) > 0


def domain_resolves(domain: str, enable_doh: bool, doh_use_curl: bool, timeout: float) -> tuple[bool, str]:
    try:
        socket.getaddrinfo(domain, None)
        return True, "A/AAAA lookup succeeded"
    except socket.gaierror as exc:
        if not enable_doh:
            return False, f"DNS resolution failed: {exc}"

        doh_a = doh_lookup(domain, "A", timeout, doh_use_curl)
        doh_aaaa = doh_lookup(domain, "AAAA", timeout, doh_use_curl)
        if doh_has_answers(doh_a) or doh_has_answers(doh_aaaa):
            if doh_use_curl:
                return True, "A/AAAA lookup succeeded via DoH (curl)"
            return True, "A/AAAA lookup succeeded via DoH"
        return False, f"DNS resolution failed: {exc}"


def lookup_mx(domain: str, enable_doh: bool, doh_use_curl: bool, timeout: float) -> list[tuple[int, str]]:
    mx_records: list[tuple[int, str]] = []

    dig_out = run_cmd_args(["dig", "+short", "MX", domain])
    if dig_out:
        for line in dig_out.splitlines():
            pieces = line.strip().split()
            if len(pieces) >= 2:
                try:
                    prio = int(pieces[0])
                except ValueError:
                    continue
                host = pieces[1].rstrip(".")
                mx_records.append((prio, host))

    if not mx_records:
        ns_out = run_cmd_args(["nslookup", "-type=mx", domain])
        for line in ns_out.splitlines():
            m = re.search(r"mail exchanger = ([^\s]+)", line)
            if m:
                mx_records.append((50, m.group(1).rstrip(".")))

    if enable_doh and not mx_records:
        doh_mx = doh_lookup(domain, "MX", timeout, doh_use_curl)
        if doh_has_answers(doh_mx):
            for ans in doh_mx.get("Answer", []):
                data = str(ans.get("data", "")).strip()
                parts = data.split()
                if len(parts) >= 2 and parts[0].isdigit():
                    mx_records.append((int(parts[0]), parts[1].rstrip(".")))

    mx_records.sort(key=lambda x: x[0])
    return unique_in_order(mx_records)


def smtp_text(raw: bytes | str) -> str:
    if isinstance(raw, bytes):
        return raw.decode(errors="replace")
    return str(raw)


def classify_smtp(code: int | None, catch_all_likely: bool) -> str:
    if code is None:
        return "unknown"
    if code in (250, 251):
        return "accept-all-likely" if catch_all_likely else "accepted"
    if code in (550, 551, 553):
        return "rejected"
    if 400 <= code < 500:
        return "temporary-failure"
    if code == 252:
        return "cannot-verify"
    return "indeterminate"


def smtp_status_score(status: str) -> float:
    mapping = {
        "accepted": 1.0,
        "accept-all-likely": 0.35,
        "rejected": 0.0,
        "temporary-failure": 0.35,
        "cannot-verify": 0.45,
        "indeterminate": 0.45,
        "unknown": 0.45,
    }
    return mapping.get(status, 0.45)


def consensus_score(verdict: str) -> float:
    if verdict == "valid":
        return 1.0
    if verdict == "invalid":
        return 0.0
    return 0.5


def build_ranked_candidates(
    emails: list[str],
    pattern_scores: dict[str, float] | None = None,
    osint_scores: dict[str, float] | None = None,
    smtp_statuses: dict[str, str] | None = None,
    consensus_verdicts: dict[str, str] | None = None,
) -> list[dict]:
    ranked = []
    denom = max(len(emails) - 1, 1)
    has_pattern = bool(pattern_scores)
    for idx, email in enumerate(emails):
        base_order_score = 1.0 - (idx / denom)
        # Once we have known-pattern evidence, generation order should matter less.
        weighted = [(0.10 if has_pattern else 0.20, base_order_score)]

        evidence = {"base_order_score": round(base_order_score, 3)}
        if pattern_scores:
            p_score = float(pattern_scores.get(email, 0.5))
            weighted.append((0.40, p_score))
            evidence["pattern_score"] = round(p_score, 3)
        if osint_scores:
            o_score = float(osint_scores.get(email, 0.0))
            weighted.append((0.20, o_score))
            evidence["osint_score"] = round(o_score, 3)
        if smtp_statuses:
            smtp_status = smtp_statuses.get(email, "unknown")
            s_score = smtp_status_score(smtp_status)
            weighted.append((0.20, s_score))
            evidence["smtp_status"] = smtp_status
            evidence["smtp_score"] = round(s_score, 3)
        if consensus_verdicts:
            c_verdict = consensus_verdicts.get(email, "unknown")
            c_score = consensus_score(c_verdict)
            weighted.append((0.20, c_score))
            evidence["api_consensus_verdict"] = c_verdict
            evidence["api_consensus_score"] = round(c_score, 3)

        total_weight = sum(w for w, _ in weighted)
        final_score = sum(w * s for w, s in weighted) / total_weight
        ranked.append(
            {
                "email": email,
                "final_score": round(final_score, 3),
                "evidence": evidence,
            }
        )

    ranked.sort(key=lambda x: x["final_score"], reverse=True)
    return ranked


def smtp_rcpt_probe(mx_host: str, target_email: str, from_address: str, timeout: float) -> SmtpProbeResult:
    try:
        with smtplib.SMTP(mx_host, 25, timeout=timeout) as smtp:
            smtp.ehlo_or_helo_if_needed()
            try:
                if smtp.has_extn("starttls"):
                    smtp.starttls()
                    smtp.ehlo()
            except smtplib.SMTPException:
                pass

            mail_code, mail_msg = smtp.mail(from_address)
            if mail_code >= 500:
                return SmtpProbeResult(mx_host=mx_host, code=mail_code, message=smtp_text(mail_msg))

            rcpt_code, rcpt_msg = smtp.rcpt(target_email)
            return SmtpProbeResult(
                mx_host=mx_host,
                code=rcpt_code,
                message=smtp_text(rcpt_msg),
            )
    except Exception as exc:  # noqa: BLE001
        return SmtpProbeResult(mx_host=mx_host, code=None, message="", error=str(exc))


def random_local_part(length: int = 16) -> str:
    chars = string.ascii_lowercase + string.digits
    return "".join(random.choice(chars) for _ in range(length))


def check_catch_all(mx_host: str, domain: str, from_address: str, timeout: float) -> tuple[bool, SmtpProbeResult]:
    fake_addr = f"{random_local_part()}@{domain}"
    result = smtp_rcpt_probe(mx_host, fake_addr, from_address, timeout)
    return (result.code in (250, 251), result)


def print_header(title: str) -> None:
    print(f"\n=== {title} ===")


def write_report(report: dict, report_path: str) -> None:
    payload = json.dumps(report, indent=2, sort_keys=True)
    if report_path == "-":
        print(payload)
        return
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(payload + "\n")
    print(f"\nReport written: {report_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a local email finder verification lab.")
    parser.add_argument("--domain", help="Target domain, e.g. bhuman.ai")
    parser.add_argument("--name", help='Target full name, e.g. "Don Bosco"')
    parser.add_argument("--max-candidates", type=int, default=12, help="How many generated addresses to test")
    parser.add_argument(
        "--known-email",
        action="append",
        default=[],
        help="Known valid email on this domain to infer company naming pattern (repeatable)",
    )
    parser.add_argument("--probe-smtp", action="store_true", help="Enable SMTP RCPT probing")
    parser.add_argument("--timeout", type=float, default=8.0, help="SMTP timeout seconds")
    parser.add_argument("--pause-ms", type=int, default=700, help="Pause between SMTP probes")
    parser.add_argument("--from-address", default="probe@localhost", help="MAIL FROM used in SMTP probe")
    parser.add_argument("--no-doh", action="store_true", help="Disable DNS-over-HTTPS fallback")
    parser.add_argument("--curl-doh", action="store_true", help="Force DoH lookup through curl")
    parser.add_argument("--osint", action="store_true", help="Enable web-index OSINT search stage")
    parser.add_argument("--osint-max-results", type=int, default=6, help="Max RSS results per OSINT query")
    parser.add_argument("--osint-max-candidates", type=int, default=8, help="How many candidates to check with exact-query OSINT")
    parser.add_argument("--osint-delay-ms", type=int, default=300, help="Pause between OSINT web queries")
    parser.add_argument("--api-consensus", action="store_true", help="Enable verifier API consensus checks")
    parser.add_argument(
        "--consensus-providers",
        default="hunter,abstract",
        help="Comma-separated verifier providers for consensus (supported: hunter,abstract)",
    )
    parser.add_argument(
        "--consensus-max-candidates",
        type=int,
        default=6,
        help="Max unknown candidates to send to API consensus checks",
    )
    parser.add_argument(
        "--consensus-delay-ms",
        type=int,
        default=250,
        help="Pause between API consensus calls",
    )
    parser.add_argument("--benchmark-file", help="CSV file with benchmark cases (columns: email,label)")
    parser.add_argument("--benchmark-runs", type=int, default=3, help="SMTP probe attempts per benchmark email")
    parser.add_argument("--benchmark-pause-ms", type=int, default=200, help="Pause between benchmark attempts")
    parser.add_argument("--benchmark-max-cases", type=int, default=50, help="Max benchmark CSV rows to execute")
    parser.add_argument("--benchmark-starttls", action="store_true", help="Attempt STARTTLS during timing benchmark")
    parser.add_argument("--report", help="Write JSON report to path (or '-' for stdout)")

    args = parser.parse_args()
    domain = args.domain.strip().lower() if args.domain else ""
    name = args.name.strip() if args.name else ""
    if not args.benchmark_file and (not domain or not name):
        parser.error("--domain and --name are required unless --benchmark-file is used")

    use_doh = not args.no_doh

    report: dict = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "input": {"name": name, "domain": domain},
        "settings": {
            "max_candidates": max(args.max_candidates, 1),
            "known_emails": args.known_email,
            "probe_smtp": args.probe_smtp,
            "timeout_seconds": args.timeout,
            "pause_ms": max(args.pause_ms, 0),
            "from_address": args.from_address,
            "doh_enabled": use_doh,
            "doh_via_curl": args.curl_doh,
            "osint_enabled": args.osint,
            "osint_max_results": max(args.osint_max_results, 1),
            "osint_max_candidates": max(args.osint_max_candidates, 0),
            "osint_delay_ms": max(args.osint_delay_ms, 0),
            "api_consensus_enabled": args.api_consensus,
            "consensus_providers": [p.strip() for p in args.consensus_providers.split(",") if p.strip()],
            "consensus_max_candidates": max(args.consensus_max_candidates, 1),
            "consensus_delay_ms": max(args.consensus_delay_ms, 0),
            "benchmark_file": args.benchmark_file,
            "benchmark_runs": max(args.benchmark_runs, 1),
            "benchmark_pause_ms": max(args.benchmark_pause_ms, 0),
            "benchmark_max_cases": max(args.benchmark_max_cases, 1),
            "benchmark_starttls": args.benchmark_starttls,
        },
    }

    print_header("Input")
    if name:
        print(f"Name:   {name}")
    if domain:
        print(f"Domain: {domain}")
    if args.benchmark_file:
        print(f"Benchmark CSV: {args.benchmark_file}")

    if args.benchmark_file:
        print_header("SMTP Timing Benchmark")
        loaded = load_benchmark_cases(args.benchmark_file, max_cases=max(args.benchmark_max_cases, 1))
        report["benchmark"] = {
            "stage": loaded.get("stage", "error"),
            "loader": {
                "reason": loaded.get("reason"),
                "case_count": loaded.get("case_count", 0),
                "ignored": loaded.get("ignored", []),
            },
        }

        if loaded.get("stage") != "completed":
            print(f"Benchmark load error: {loaded.get('reason', 'unknown error')}")
            if args.report:
                write_report(report, args.report)
            return

        print(f"Loaded benchmark cases: {loaded.get('case_count', 0)}")
        if loaded.get("ignored"):
            print(f"Ignored rows: {len(loaded['ignored'])}")

        benchmark_result = run_timing_benchmark(
            cases=loaded.get("cases", []),
            runs=max(args.benchmark_runs, 1),
            pause_ms=max(args.benchmark_pause_ms, 0),
            timeout=args.timeout,
            from_address=args.from_address,
            use_starttls=args.benchmark_starttls,
            enable_doh=use_doh,
            doh_use_curl=args.curl_doh,
        )
        report["benchmark"]["result"] = benchmark_result

        label_summary = benchmark_result.get("label_summary", {})
        print("Label timing summary:")
        for label, stats in label_summary.items():
            total_stats = stats.get("total_timing_ms") or {}
            median_ms = total_stats.get("median_ms")
            print(
                f"- {label}: attempts={stats.get('attempt_count', 0)} "
                f"median_total_ms={median_ms}"
            )

        if args.report:
            write_report(report, args.report)
        return

    locals_ = generate_local_parts(name)
    if not locals_:
        print("Could not generate candidates from the provided name.")
        raise SystemExit(1)

    emails = [f"{local}@{domain}" for local in locals_][: max(args.max_candidates, 1)]
    report["candidates"] = emails

    print_header("Generated Candidates")
    for i, email in enumerate(emails, start=1):
        print(f"{i:2d}. {email}")

    pattern_score_by_email: dict[str, float] = {}
    if args.known_email:
        pattern_profile = build_pattern_profile(args.known_email, domain)
        pattern_rows = build_pattern_scores(emails, pattern_profile)
        pattern_score_by_email = {row["email"]: row["pattern_score"] for row in pattern_rows}
        report["pattern"] = {"profile": pattern_profile, "candidate_scores": pattern_rows}

        print_header("Pattern Inference")
        print(f"Known emails used: {pattern_profile.get('sample_size', 0)}")
        if pattern_profile.get("ignored_inputs"):
            print(f"Ignored known-email inputs: {len(pattern_profile['ignored_inputs'])}")
        print("Top pattern-ranked candidates:")
        for row in pattern_rows[:5]:
            print(f"- {row['email']} pattern_score={row['pattern_score']}")
    else:
        report["pattern"] = {"stage": "skipped", "reason": "no known-email provided"}

    print_header("Passive Verification")
    resolves, dns_note = domain_resolves(domain, enable_doh=use_doh, doh_use_curl=args.curl_doh, timeout=args.timeout)
    print(f"Domain resolves: {resolves} ({dns_note})")
    mx_records = lookup_mx(domain, enable_doh=use_doh, doh_use_curl=args.curl_doh, timeout=args.timeout)
    if mx_records:
        print("MX records:")
        for prio, host in mx_records:
            print(f"- {prio:>3} {host}")
    else:
        print("MX records: none found")

    syntax_ok = sum(1 for e in emails if EMAIL_RE.match(e))
    print(f"Syntax-valid candidates: {syntax_ok}/{len(emails)}")
    report["passive"] = {
        "domain_resolves": resolves,
        "domain_note": dns_note,
        "mx_records": [{"priority": p, "host": h} for p, h in mx_records],
        "syntax_valid_count": syntax_ok,
        "candidate_count": len(emails),
    }

    osint_score_by_email: dict[str, float] = {}
    if args.osint:
        print_header("OSINT Verification")
        print("Running web-index checks (Bing RSS) for direct mentions and domain pattern clues...")
        osint_result = run_osint_stage(
            name=name,
            domain=domain,
            emails=emails,
            timeout=args.timeout,
            max_results=max(args.osint_max_results, 1),
            max_candidate_checks=max(args.osint_max_candidates, 0),
            delay_ms=max(args.osint_delay_ms, 0),
        )
        report["osint"] = osint_result
        osint_score_by_email = {row["email"]: float(row["osint_confidence"]) for row in osint_result.get("candidate_scores", [])}
        discovered = osint_result.get("discovered_domain_emails", [])
        print(f"Discovered public emails on domain: {len(discovered)}")
        for em in discovered[:8]:
            print(f"- {em}")
        print("Top OSINT candidates:")
        for row in osint_result.get("candidate_scores", [])[:5]:
            print(
                f"- {row['email']} score={row['osint_confidence']} "
                f"mentions={row['exact_mentions']}"
            )
    else:
        report["osint"] = {"stage": "skipped", "reason": "osint disabled"}

    candidate_results = []
    smtp_status_by_email: dict[str, str] = {}
    if not args.probe_smtp:
        print_header("SMTP Stage Skipped")
        print("Use --probe-smtp to run RCPT checks. Only test domains you own or are authorized to test.")
        report["smtp"] = {"stage": "skipped", "reason": "probe disabled"}
    elif not mx_records:
        print_header("SMTP Stage")
        print("No MX host available, skipping SMTP probes.")
        report["smtp"] = {"stage": "skipped", "reason": "no mx records"}
    else:
        top_mx = mx_records[0][1]
        print_header("SMTP Verification")
        print(f"Using MX host: {top_mx}")
        print("Note: providers may tarp it / block / accept-all, so RCPT result is probabilistic.")

        catch_all, catch_result = check_catch_all(top_mx, domain, args.from_address, args.timeout)
        print(
            f"Catch-all test with random mailbox: code={catch_result.code} "
            f"status={'accept-all-likely' if catch_all else 'not-accept-all'}"
        )
        if catch_result.error:
            print(f"Catch-all probe error: {catch_result.error}")

        print("\nCandidate probe results:")
        print("email,status,smtp_code,mx_host,detail")
        for email in emails:
            result = smtp_rcpt_probe(top_mx, email, args.from_address, args.timeout)
            status = classify_smtp(result.code, catch_all_likely=catch_all)
            detail = result.error or result.message.replace(",", ";")
            print(f"{email},{status},{result.code},{result.mx_host},{detail}")
            candidate_results.append(
                {
                    "email": email,
                    "status": status,
                    "smtp_code": result.code,
                    "mx_host": result.mx_host,
                    "detail": detail,
                }
            )
            smtp_status_by_email[email] = status
            time.sleep(max(args.pause_ms, 0) / 1000.0)

        report["smtp"] = {
            "stage": "completed",
            "mx_host": top_mx,
            "catch_all_likely": catch_all,
            "catch_all_probe": {
                "code": catch_result.code,
                "detail": catch_result.error or catch_result.message,
            },
            "results": candidate_results,
        }

    consensus_verdict_by_email: dict[str, str] = {}
    if args.api_consensus:
        print_header("API Consensus")
        provider_list = [p.strip() for p in args.consensus_providers.split(",") if p.strip()]
        unknown_statuses = {"unknown", "indeterminate", "cannot-verify", "temporary-failure", "accept-all-likely"}
        if candidate_results:
            target_emails = [r["email"] for r in candidate_results if r.get("status") in unknown_statuses]
        else:
            target_emails = list(emails)

        target_emails = target_emails[: max(args.consensus_max_candidates, 1)]
        print(f"Consensus targets: {len(target_emails)}")
        if target_emails:
            consensus_result = run_api_consensus(
                emails=target_emails,
                providers=provider_list,
                timeout=args.timeout,
                delay_ms=max(args.consensus_delay_ms, 0),
            )
        else:
            consensus_result = {"stage": "skipped", "reason": "no target emails", "results": []}

        for row in consensus_result.get("results", []):
            consensus_verdict_by_email[row["email"]] = row.get("consensus_verdict", "unknown")
        report["api_consensus"] = consensus_result
        for row in consensus_result.get("results", [])[:5]:
            print(f"- {row['email']} consensus={row['consensus_verdict']} votes={row['votes']}")
    else:
        report["api_consensus"] = {"stage": "skipped", "reason": "api_consensus disabled"}

    ranked_candidates = build_ranked_candidates(
        emails=emails,
        pattern_scores=pattern_score_by_email or None,
        osint_scores=osint_score_by_email or None,
        smtp_statuses=smtp_status_by_email or None,
        consensus_verdicts=consensus_verdict_by_email or None,
    )
    report["ranked_candidates"] = ranked_candidates
    print_header("Final Ranking")
    for row in ranked_candidates[:5]:
        print(f"- {row['email']} final_score={row['final_score']}")

    if args.report:
        write_report(report, args.report)


if __name__ == "__main__":
    main()
