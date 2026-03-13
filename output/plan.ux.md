## UX North Star
Enable a founder to go from “outbound plateau” → “validated winning message angle” in <14 days **without** risking deliverability, creating template sprawl in Customer.io, or doing manual analysis.

The product is a tight loop:
**Hypothesis → Micro-test → Learn → Cull/Promote → Scale (still via Customer.io)**

---

## Main User Flow
1. **Create Project**
   - Define ICP/offer, connect Customer.io, connect inbox ingestion, set conversion event.
2. **Build Campaign + Sequence**
   - Choose a single Customer.io send model (one event + one template) and define variable placeholders.
3. **Generate Hypothesis Queue (LLM)**
   - Generate 50–200 variants with constraints; user approves a smaller set (e.g., 6–20) to test.
4. **Import Leads + Suppression Hygiene**
   - Upload CSV / paste list; dedupe; apply global + project suppression; validate required fields.
5. **Run Micro-batch Experiment**
   - Set batch size, throttle, holdout, stop rules; launch.
6. **Monitor Evolution Grid**
   - See variant performance (reply sentiment + conversion), automatic pausing of losers, promotion suggestions.
7. **Promote Winner to Scale**
   - Push winner variable-set to “Scaled” mode (still via the single Customer.io template/event), with safer throttles.

---

## Screens (max 6)

### 1) Project Setup
**Goal:** Create a safe, instrumented workspace with minimal required integrations.

**Key components**
- Project name
- ICP & Offer fields (freeform, used for hypothesis generation)
- **Customer.io connection**
  - Workspace selection
  - Choose **Event Name** used to trigger send (e.g., `outbound_send`)
  - Choose **Template ID** (single template)
  - Variable mapping preview (e.g., `{{subject}}`, `{{line1}}`, `{{cta}}`)
- **Inbox ingestion connection**
  - Connect Gmail / O365 / IMAP
  - Select mailbox identity (from address) for mapping
- **Conversion definition**
  - Primary conversion source: webhook/event (e.g., “demo booked”, “signup”)
  - Fallback: reply sentiment (positive)
- Default safety settings (editable later)
  - Max sends/day, min delay, pause on high negative/unsub

**Required states**
- Empty: prompts to connect Customer.io first
- Connected: show checkmarks + “Test connection”
- Error: actionable errors (auth failed, missing permissions)
- Conversion not configured: allow save but block experiment launch

---

### 2) Campaign & Sequence Builder
**Goal:** Define the experiment container and the “single-template, variable-driven” sending contract.

**Key components**
- Campaign name + goal metric selection (conversion primary; sentiment fallback)
- Sequence definition (minimal v1)
  - Step list (e.g., Email 1, Email 2 follow-up)
  - For each step: variable set required (subject/body blocks), delay
- **Customer.io send contract panel**
  - Confirms: one template, one event
  - Shows required variables per step
  - Payload preview JSON sent to Customer.io (read-only)
- Guardrails
  - “No template explosion” banner: all variants are variable payloads
  - Deliverability reminder: recommended throttle defaults

**Required states**
- Draft: incomplete variables/delays flagged inline
- Valid: ready to generate hypotheses
- Blocking validation: missing required variables / missing Customer.io mapping

---

### 3) Hypothesis Queue (LLM) + Approval
**Goal:** Rapidly generate many credible angles, force human gating, and store rationale.

**Key components**
- Inputs (top of screen)
  - ICP + offer (pre-filled from Project)
  - Constraints toggles: “no spammy claims”, “avoid competitor mentions”, “include proof point”, “short-only”
  - Tone selector (neutral, assertive, consultative)
  - Output count (50/100/200)
- Queue table (high-density)
  - Hypothesis title (angle)
  - Subject + opener preview
  - Rationale (why it should work)
  - Risk flags (e.g., “needs proof”, “could trigger spam words”)
  - Buttons: Approve / Deny / Edit
- “Approved set” counter + target range suggestion (e.g., “Aim for 6–20 variants for micro-tests”)
- Bulk actions: approve top N, deny all flagged, export

**Required states**
- Generating: streaming rows, disable launch
- Queue ready: allow approve/deny
- Edited: track changes + keep original rationale
- Approval threshold: block experiment creation until at least 2 variants approved

---

### 4) Leads + Suppression Vault
**Goal:** Import leads safely, dedupe, and enforce suppression/unsubscribe hygiene before any send.

**Key components**
- Import methods
  - CSV upload
  - Paste table
  - (Optional v1) Apify import: “Bring leads” as a separate tab with strict caps
- Field mapper
  - Required: email, first_name (optional), company (optional)
  - Custom properties passthrough to Customer.io
- Dedupe & hygiene summary
  - Duplicates removed
  - Invalid emails filtered
  - Already contacted (project) filtered (if tracked)
- **Suppression Vault**
  - Global suppression list count
  - Project suppression list count
  - Add emails/domains (manual)
  - Auto-add rules: “Add unsubscribes to global suppression”
- Compliance confirmation checkbox (required): “I have permission to contact these leads and will honor unsubscribes.”

**Required states**
- Pre-import: show required fields + sample CSV
- Mapping errors: missing email column, malformed CSV
- Post-import review: must confirm suppression actions before “Ready for experiment”
- Hard block: if unsubscribe list not connected/handled (at minimum, local suppression must exist)

---

### 5) Micro-batch Experiment Launch
**Goal:** Configure a controlled test that minimizes reputation risk and operational overhead.

**Key components**
- Experiment name + link back to Campaign/Sequence
- Variant picker
  - Select approved hypotheses (variants)
  - Assign to sequence steps (Email 1, Email 2) as variable bundles
- Batch & throttle controls
  - Total test size (e.g., 200 leads)
  - Batch size per variant (e.g., 20 each)
  - Sends/day cap and min delay
  - Holdout group toggle (e.g., 10% baseline or “no-send”)
- Stop rules (simple but defensible)
  - Minimum N per variant before judging
  - Auto-pause if negative/unsub rate exceeds threshold
  - Auto-kill if statistically dominated after min N (use conservative defaults)
  - Max spend cap (for Apify-sourced leads if used)
- Launch checklist (hard gates)
  - Customer.io connected + event/template confirmed
  - Inbox ingestion connected
  - Conversion event configured OR explicit “sentiment-only mode” acknowledged
  - Suppression vault active

**Required states**
- Draft: can save without launching
- Blocked: missing any hard gate item
- Ready: shows “Expected duration” estimate based on throttle + list size
- Running: shows next batch schedule + pause button

---

### 6) Evolution Grid + Winner’s Circle (Daily Ops)
**Goal:** One place to monitor outcomes, trust auto-culling, and promote winners to scale safely.

**Key components**
- Top KPI strip
  - Leads sent, replies, positive rate, conversion rate, unsub rate
  - “Time to winner” tracker
- **Evolution Grid (core)**
  - Rows: variants (hypotheses)
  - Columns: sends, delivered (if available), replies by label, positive %, conversions, cost/lead (if Apify), status
  - Status: Running / Paused (auto) / Killed / Winner candidate / Scaled
  - Sorting + filters (e.g., show only “needs min N”, “auto-paused”)
- **Winner’s Circle**
  - Top 1–3 variants with explanation: “why promoted” + confidence indicator
  - “Promote to Scale” action
  - “Create next wave” action (auto-generate follow-on hypotheses from winner)
- Reply panel (right drawer)
  - Thread view (read-only), sentiment label, “mark as wrong” correction
- Audit log
  - Auto-pauses, rule triggers, manual overrides

**Required states**
- Low-sample warning: “Too early to call” until min N met
- Ingestion delayed: show “Reply sync lagging” and last sync timestamp
- Winner pending human approval: winners never auto-scale without explicit click
- Scale mode: separate throttle defaults + extra safety prompt

---

## UX Rules
1. **Customer.io-first always**
   - Only one Customer.io template + one event per sequence; all variants are variables.
2. **Human approval gates for anything risky**
   - Must approve hypotheses before use.
   - Must approve winner promotion to scale.
3. **Safety defaults > flexibility**
   - Conservative throttles by default; warn but allow override with explicit acknowledgment.
4. **High-density, decision-first UI**
   - Ops surfaces optimize for scanning and actions (pause/kill/promote), not long-form analytics.
5. **Single objective hierarchy**
   - Primary: conversion event. Fallback: positive reply sentiment. Always show which mode is active.
6. **Never hide suppression**
   - Suppression vault is visible in launch checklist and experiment header; unsubscribes auto-enforced.
7. **No ambiguous states**
   - Every experiment/variant shows: what’s running, what’s paused, why it happened, and what to do next.

---

## Copy Tone
- Crisp, technical, non-salesy.
- Uses “risk-aware” language: “safe”, “cap”, “pause”, “holdout”, “min sample”.
- Avoids hype about AI; frames LLM as “draft generator” requiring approval.
- Uses short, action-oriented labels: “Approve”, “Deny”, “Promote”, “Kill”, “Pause”.

---

## Edge Cases
1. **Conversion signal missing or unreliable**
   - If no conversion event within X days, auto-switch dashboard emphasis to sentiment with a banner: “Conversion not detected; using reply