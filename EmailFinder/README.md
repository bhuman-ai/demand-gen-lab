# Email Finder Lab

Hands-on CLI to understand how email finder systems usually work:

1. Generate likely addresses from `name + domain`.
2. Run passive checks:
   - address syntax
   - domain DNS resolution
   - MX lookup
3. Optionally run web-index OSINT checks (Bing RSS queries).
4. Optionally run SMTP RCPT probing (opt-in).
5. Optionally run API-consensus checks for unknown results.

## Quick Start

```bash
python3 email_finder_lab.py --domain bhuman.ai --name "Don Bosco"
```

Enable SMTP probing (only for domains you own or have explicit authorization to test):

```bash
python3 email_finder_lab.py \
  --domain bhuman.ai \
  --name "Don Bosco" \
  --probe-smtp \
  --max-candidates 8
```

Force DNS-over-HTTPS via curl and write a JSON report:

```bash
python3 email_finder_lab.py \
  --domain bhuman.ai \
  --name "Don Bosco" \
  --probe-smtp \
  --curl-doh \
  --report report_don_bosco.json
```

If you only want passive checks but still want a report:

```bash
python3 email_finder_lab.py \
  --domain bhuman.ai \
  --name "Don Bosco" \
  --curl-doh \
  --report report_don_bosco_passive.json
```

Run OSINT + SMTP + report together:

```bash
python3 email_finder_lab.py \
  --domain bhuman.ai \
  --name "Don Bosco" \
  --osint \
  --probe-smtp \
  --curl-doh \
  --report report_don_bosco_full.json
```

Use known company emails to infer local-part pattern and rank candidates:

```bash
python3 email_finder_lab.py \
  --domain mysuncash.com \
  --name "Desmond Pyfrom" \
  --known-email "known.person@mysuncash.com" \
  --known-email "known.initial@mysuncash.com" \
  --osint \
  --probe-smtp \
  --report report_desmond_ranked.json
```

Enable API consensus on unknown candidates (provider keys via env vars):

```bash
export HUNTER_API_KEY="..."
export ABSTRACT_API_KEY="..."
python3 email_finder_lab.py \
  --domain mysuncash.com \
  --name "Desmond Pyfrom" \
  --probe-smtp \
  --api-consensus \
  --consensus-providers hunter,abstract \
  --report report_desmond_consensus.json
```

Run SMTP timing benchmark mode (catch-all vs non-catch-all comparison):

1. Create a CSV with columns `email,label` (label examples: `catch_all`, `non_catch_all`):

```csv
email,label
known.user@company.com,non_catch_all
random-anything@company.com,catch_all
```

2. Run benchmark mode:

```bash
python3 email_finder_lab.py \
  --benchmark-file benchmark_cases.csv \
  --benchmark-runs 5 \
  --benchmark-starttls \
  --timeout 5 \
  --report report_benchmark.json
```

## API Server

Run the local HTTP API:

```bash
python3 email_finder_api.py --host 127.0.0.1 --port 8080
```

Health check:

```bash
curl http://127.0.0.1:8080/health
```

Inspect learned domain fingerprint stats:

```bash
curl "http://127.0.0.1:8080/v1/fingerprint?domain=bhuman.ai"
```

Inspect pending retry queue entries:

```bash
curl "http://127.0.0.1:8080/v1/retry-queue?domain=bhuman.ai&limit=25"
```

Record real delivery outcomes (feeds calibration):

```bash
curl -X POST http://127.0.0.1:8080/v1/outcomes \
  -H "Content-Type: application/json" \
  -d '{
    "events": [
      {"email": "don@bhuman.ai", "result": "delivered"},
      {"email": "don.bosco@bhuman.ai", "result": "hard_bounce"}
    ]
  }'
```

Run due retry items now:

```bash
curl -X POST http://127.0.0.1:8080/v1/retry-queue/run \
  -H "Content-Type: application/json" \
  -d '{"limit": 25, "dry_run": false}'
```

Sequential guessing (most probable to least probable) with ValidatedMails verification:

```bash
curl -X POST http://127.0.0.1:8080/v1/guess \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Don Bosco",
    "domain": "bhuman.ai",
    "max_candidates": 12,
    "known_emails": ["don@bhuman.ai"],
    "verification_mode": "validatedmails",
    "validatedmails_api_key": "YOUR_VALIDATEDMAILS_KEY",
    "stop_on_first_hit": true,
    "stop_on_min_confidence": "high",
    "max_credits": 7,
    "high_confidence_only": true,
    "enable_risky_queue": true,
    "canary_mode": true,
    "canary_observations": {
      "sent": 120,
      "hard_bounces": 2
    },
    "canary_policy": {
      "min_samples": 25,
      "max_hard_bounce_rate": 0.03
    },
    "enable_domain_fingerprint": true,
    "enable_retry_scheduler": true,
    "retry_delays_seconds": [300, 1800],
    "retry_jitter_seconds": 45,
    "retry_max_items": 10,
    "smtp_mx_quorum": 2,
    "smtp_sequence_check": true
  }'
```

Batch guessing with controlled concurrency:

```bash
curl -X POST http://127.0.0.1:8080/v1/guess/batch \
  -H "Content-Type: application/json" \
  -d '{
    "concurrency": 3,
    "continue_on_error": true,
    "default_item": {
      "verification_mode": "validatedmails",
      "validatedmails_api_key": "YOUR_VALIDATEDMAILS_KEY",
      "max_candidates": 12,
      "max_credits": 7,
      "stop_on_first_hit": true,
      "stop_on_min_confidence": "high"
    },
    "items": [
      {"id": "lead-1", "name": "Don Bosco", "domain": "bhuman.ai"},
      {"id": "lead-2", "name": "Katrina Garvin", "domain": "barrierreef.org"}
    ]
  }'
```

SMTP fallback mode:

```bash
curl -X POST http://127.0.0.1:8080/v1/guess \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Don Bosco",
    "domain": "bhuman.ai",
    "verification_mode": "smtp",
    "probe_timeout_seconds": 8,
    "pause_ms": 300,
    "stop_on_first_hit": false
  }'
```

Notes:
- `verification_mode=validatedmails` returns verdicts like `likely-valid`, `risky-valid`, `invalid`, `unknown`.
- `risky-valid` means deliverable but catch-all behavior (`accept_all=true`) was detected.
- `stop_on_first_hit` defaults to `true`.
- `stop_on_min_confidence` defaults to `high` and only stops on hits at/above that confidence.
- `max_credits` defaults to `7` for `verification_mode=validatedmails` (1 verification call = 1 credit).
- `high_confidence_only` defaults to `true`; only high-confidence recipients are put in `routing.queues.eligible_send_now`.
- `enable_risky_queue` defaults to `true`; lower-confidence/catch-all positives are isolated in `routing.queues.risky_queue`.
- `canary_mode=true` uses your observed outcomes to auto-handle risky queue:
  - `decision=hold` when `canary_observations.sent < canary_policy.min_samples`
  - `decision=promote` when hard bounce rate is <= `max_hard_bounce_rate`
  - `decision=suppress` when hard bounce rate is > `max_hard_bounce_rate`
- `enable_domain_fingerprint=true` (default) writes per-domain behavior to `domain_fingerprints.json`.
- `enable_retry_scheduler=true` (default) enqueues transient/unknown results in `retry_queue.json`.
- `retry_delays_seconds` controls planned retry intervals (default `[300, 1800]` seconds).
- `retry_jitter_seconds` adds random delay to avoid retry spikes (default `45`).
- `retry_max_items` caps new queued retries per request (default `10`).
- `smtp_mx_quorum` probes multiple MX hosts and takes a majority/consensus status (default `2`, max `5`).
- `smtp_sequence_check=true` runs an RCPT order-sensitivity check on the primary MX.
- Each attempt now includes Bayesian `p_valid` and queues are ordered by highest `p_valid`.
- `POST /v1/outcomes` records real outcomes (`delivered`, `hard_bounce`, `soft_bounce`, `sent`) and updates domain fingerprint priors.
- `POST /v1/retry-queue/run` processes pending due retry items and marks them `resolved`/`failed`/`pending`.
- `/v1/guess/batch` supports up to `200` items per request and max concurrency of `10`.
- Batch results are returned in original input order, with per-item `ok/result` or `ok/error`.

## Notes On Interpretation

- `accepted` means the MX accepted `RCPT TO` for that address in that session.
- `accept-all-likely` means random fake mailbox was also accepted, so the signal is weak.
- `rejected` usually means mailbox invalid or policy-blocked.
- `temporary-failure` often means throttling, greylisting, or anti-abuse behavior.
- `cannot-verify` / `indeterminate` means do not treat as hard valid/invalid.
- `known-email` pattern signals are weighted above generation-order when ranking.

## Safety

- Do not probe domains you do not control or lack permission to test.
- This tool is for learning and authorized deliverability testing.
