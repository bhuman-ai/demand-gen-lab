# Product Plan

## Product Thesis
A Customer.io-first outbound experimentation console that helps a seed–Series A founder find a winning email angle fast by running safe micro-batch tests across AI-generated variants, auto-culling losers, and scaling winners—without template sprawl, manual analysis, or deliverability roulette.

## ICP
**Primary user:** Early-stage B2B SaaS founder (Seed–Series A) or first GTM hire running outbound.

**Must be true (v1 qualifiers):**
- Uses **Customer.io** (or will adopt) for sending.
- Has **a mailbox** (Gmail or O365) willing to connect for reply ingestion.
- Operates on **small/medium lists** and cannot burn sender reputation.
- Needs rapid iteration on messaging without hiring SDR/lifecycle staff.

**Buying trigger:** Outbound plateau + urgency to test many angles safely and quickly.

## Core Job
Go from “we’re guessing messaging” to “validated winner sequence variant” by:
1) generating credible hypotheses,  
2) running controlled micro-tests,  
3) learning from replies + conversions,  
4) auto-killing losers, and  
5) promoting winners to scaled sending (still through a single Customer.io template/event).

## Main Flow
1. **Create Project**
   - Enter ICP/offer context.
   - Connect Customer.io (event + template).
   - Connect inbox (Gmail or O365).
   - Define conversion event (optional but recommended).
2. **Define Campaign + Sequence Contract**
   - Create sequence steps (Email 1, Email 2).
   - Confirm required variable placeholders per step.
3. **Generate Hypotheses + Approve**
   - LLM generates variants.
   - User approves a small set to test.
4. **Import Leads + Enforce Suppression**
   - CSV import, field map, dedupe, suppression rules.
5. **Launch Micro-batch Experiment**
   - Assign approved variants to steps (variable bundles).
   - Set throttle + stop rules.
   - Launch via Customer.io event with per-lead payload variables.
6. **Operate in Evolution Grid**
   - Monitor sends/replies/conversions.
   - Auto-pause/kill per rules.
   - Human-promote winners to scale.

## Screens
> Cut to **5 screens** for MVP clarity. Combine “Winner’s Circle” into Evolution Grid. Defer Apify UI to “later”.

### 1) Project Setup (Integrations + Safety)
**Purpose:** create an instrumented workspace with minimal required integrations.

**Inputs**
- Project name
- ICP + Offer (freeform text)
- **Customer.io connection**
  - API key / workspace
  - Event name (e.g., `outbound_send`)
  - Template ID (single template)
  - Variable list preview (read-only examples)
  - “Test connection”
- **Inbox connection (reply ingest)**
  - Gmail OAuth OR O365 OAuth (IMAP deferred)
  - Choose “From identity” (email address)
  - “Test connection”
- **Conversion definition (optional)**
  - Conversion event name / webhook key (internal capture endpoint)
  - Fallback mode: positive reply sentiment

**Hard gates**
- Can save project without conversion configured.
- Cannot launch experiments without: Customer.io connected + Inbox connected.

---

### 2) Sequence Contract (Campaign + Steps)
**Purpose:** define the single-template, variable-driven sending contract.

**Components**
- Campaign name
- Objective mode display:
  - Primary: Conversion (if configured)
  - Fallback: Positive replies
- Sequence steps (v1 = max 2 steps)
  - Step name (Email 1 / Follow-up)
  - Delay (days)
  - Required variables per step (e.g., `subject`, `line1`, `cta`)
- Customer.io payload preview (read-only JSON)

**Validations**
- Must define variables for each step (names only; values come from variants).
- Banner: “One template + one event; all variants are variable payloads.”

---

### 3) Hypothesis Queue (Generate + Approve)
**Purpose:** generate many angles; force human gating.

**Inputs**
- Constraints toggles (checkboxes): no spammy claims, avoid competitor mentions, include proof point, short-only
- Tone: neutral / consultative / assertive
- Count: 50 / 100 (cap at 100 for v1)

**Table (dense)**
- Hypothesis title (angle)
- Step 1 preview (subject + opener)
- Step 2 preview (optional)
- Rationale (1–2 lines)
- Risk flags (simple heuristic tags)
- Actions: Approve / Deny / Edit

**Rules**
- Must approve **≥2 variants** to proceed to experiment launch.
- Store original + edited content with audit trail.

---

### 4) Leads + Suppression
**Purpose:** prevent unsafe sends; ensure dedupe + unsubscribe hygiene.

**Import**
- CSV upload
- Field mapping:
  - Required: email
  - Optional: first_name, company, any custom fields passthrough

**Hygiene summary**
- Invalid emails filtered
- Duplicates removed (project-level)
- Suppressed filtered (global + project)

**Suppression Vault (v1)**
- Global suppression: manual add (emails/domains)
- Project suppression: manual add
- Auto-add: any detected unsubscribe reply → global suppression

**Compliance gate**
- Checkbox required before “Ready to launch”: permission + honor unsubscribes.

---

### 5) Experiment Run (Launch + Evolution Grid)
**Purpose:** launch micro-batches; monitor outcomes; cull/promote.

**Launch panel**
- Choose approved variants
- Assign variants to steps as variable bundles (Step1 required; Step2 optional)
- Test size + batch config:
  - Total leads to include
  - Per-variant allocation (equal split default)
  - Sends/day cap
  - Min delay between sends
- Stop rules (simple, conservative defaults)
  - Minimum sends per variant before judgment
  - Auto-pause on unsub rate threshold
  - Auto-pause on negative reply threshold
  - Auto-kill if dominated after min N (conservative)
- Checklist (hard gates)
  - Customer.io connected
  - Inbox connected
  - Suppression active + compliance checked
  - Conversion configured OR “Sentiment-only mode” acknowledged

**Evolution Grid (same screen, below)**
- Rows = variants
- Columns:
  - Sends
  - Replies (pos/neutral/neg/OOO/unsub)
  - Positive rate
  - Conversions (if configured)
  - Status: Running / Paused(auto) / Killed / Winner-candidate / Scaled
  - “Why” (latest rule trigger)
- Actions per variant:
  - Pause / Kill / Promote to Scale
- Winner panel (right side or top)
  - Top 1–3 candidates with reason + confidence
  - **Promotion requires explicit click**
- Reply drawer (read-only thread view)
  - Sentiment label + “mark wrong” correction (feeds classifier tuning later; no model training required in v1)

## UX Rules
1. **Customer.io single-template rule:** one template + one event per sequence; all variants are payload variables.
2. **Human gates:** approve variants before send; promote before scale.
3. **Safety defaults:** conservative throttles and stop rules; overrides require explicit acknowledgment.
4. **Decision-first density:** tables > cards; show “what/why/next action” inline.
5. **Objective clarity:** always show whether the experiment is judged by Conversion or Sentiment-only mode.
6. **Suppression is always visible:** counts and enforcement appear in launch checklist and run header.
7. **No ambiguous automation:** every auto-pause/kill shows the rule and the triggering metric.

## Non-Goals
- Device farm / infra control
- Domain purchase/DNS/warmup automation
- Multi-channel outbound (SMS/LinkedIn/calls)
- CRM replacement or pipeline management
- Advanced inbox workflows (assignment, SLAs, team routing)
- Apify lead sourcing UI + autonomous actor discovery (defer entirely; keep internal hooks only)
- IMAP support (v1 = Gmail + O365 only)

## Success Metric
**Primary:** time-to-first-validated-winner ≤ **14 days** (winner = variant with best objective metric after min N and not violating safety thresholds).

**Secondary:**
- ≥50% of tested variants are auto-paused/killed without manual analysis.
- Zero “unsafe sends” incidents attributable to missing suppression enforcement (tracked as severity-1 events).

## Build Handoff Notes
**MVP scope cuts (implementation sanity):**
- Max 2-step sequences.
- Max 100 generated hypotheses per run.
- Gmail + O365 only for reply ingestion.
- Apify not exposed in UI.

**Key integrations**
- **Customer.io**
  - Send model: trigger **one event** with payload containing variant variables.
  - Do not create templates programmatically.
- **Inbox ingestion**
  - Polling or webhook where available; store raw message + parsed fields.
  - Thread mapping: minimum viable = match on Message-ID/In-Reply-To + recipient address.
  - Sentiment labels: positive / neutral / negative / OOO / unsubscribe (rule-based + LLM optional, but must be deterministic fallback).
- **Conversion**
  - Provide a simple inbound endpoint to record conversions keyed by lead (email) + project.
  - If not configured, enforce “sentiment-only mode” banner + acknowledgment at launch.

**Core entities (minimal)**
- Project
- Campaign
- Sequence (with steps + variable schema)
- HypothesisVariant (content per step + rationale + status)
- Lead (email + properties + suppression flags)
- Experiment (variant set + allocation + rules + status)
- SendLog (lead, variant, step, timestamp, Customer.io delivery id if available)
- ReplyLog (lead, thread id, label, timestamp)
- ConversionLog (lead, type, timestamp)

**Operational logic**
- Allocator: equal split across variants by default.
- Scheduler: enforce sends/day + min delay.
- Stop-rule evaluator runs periodically; writes AuditLog entries.
- Winner candidate = best metric after min N and within safety thresholds; never auto-scale.

**UI aesthetic constraints**
- Dark mode only; high-density; monospace for IDs/metrics; no marketing copy; “glass & graphite” styling via Tailwind + shadcn.