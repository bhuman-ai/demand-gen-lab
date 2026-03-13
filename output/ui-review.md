# UI Review

## Fit Score (0-10)
**1/10** — Current UI does not express (or enable) the product thesis/main flow. It looks like an unrelated/unfinished app with broken routes and raw API errors, so it can’t convert an ICP user to first value.

## What Works
- **Dark-mode aesthetic direction** on the home card aligns with “glass & graphite” (01-home desktop/mobile).
- **A single primary CTA (“Retry”)** exists, but it’s not tied to an understandable next step.

## Gaps vs ICP and Core Job
- **ICP mismatch / unclear positioning:** Nothing indicates “Customer.io-first outbound experimentation,” micro-batch safety, hypotheses, suppression, or evolution grid. The brand “FluentPhone” reads like voice/telephony, not outbound email experimentation.
- **No “time-to-first-value” path:** The plan requires a tight 5-screen MVP (Project Setup → Sequence Contract → Hypothesis Queue → Leads/Suppression → Experiment Run). None are present.
- **Conversion blockers (critical):**
  - Multiple routes show **404 Not Found** with raw JSON (`/brands`, `/brands/new`, `/logic`, `/doctor`).
  - Home shows **`null`** as content/state with no explanation.
- **Violates UX rules:**
  - No objective clarity (Conversion vs Sentiment-only).
  - No suppression visibility or compliance gate.
  - No human gates (approve variants, promote winners).
  - No decision-first density (no tables/metrics).
  - “No ambiguous automation” can’t be met because there’s no run/audit surface.

## Screen-by-Screen Feedback

### 01-home (desktop + mobile)
**Observed**
- Large card header “FluentPhone”
- Red text: `null`
- Green button: “Retry”
- No nav, no onboarding, no explanation of what failed.

**Issues vs plan**
- Missing entry into **Project Setup** (integrations + safety) which is the required first step for ICP.
- `null` is a developer artifact; founders will read this as “broken/unsafe,” which is fatal given deliverability/safety positioning.

**Recommendations**
- Replace this with a **Project Setup landing**:
  - “Create Project” form (Project name, ICP + Offer text)
  - Integration tiles with status chips: **Customer.io (Required)**, **Inbox (Required)**, Conversion (Optional)
  - Hard gates messaging: “You can save without conversion; you can’t launch without Customer.io + Inbox.”

---

### 02-brands (desktop + mobile)
**Observed**
- Plain white page with “Pretty-print” checkbox and raw JSON:
  - `{"message":"Route GET:/brands not found","error":"Not Found","statusCode":404}`

**Issues vs plan**
- Raw API error breaks trust and halts progression.
- The route concept “brands” is not part of the MVP information architecture (Projects/Campaigns/Sequences/Experiments are).

**Recommendations**
- Implement an app shell with:
  - Left nav: **Project Setup, Sequence Contract, Hypotheses, Leads, Experiment**
  - Proper empty/error states: friendly explanation + next action + link back to Project Setup.

---

### 03-brands/new (desktop + mobile)
**Observed**
- Same raw JSON 404 for `GET:/brands/new`

**Issues vs plan**
- If this was meant to be “create new X,” it should map to **Create Project**.

**Recommendations**
- Route `/projects/new` → Project Setup wizard.
- Ensure wizard progression matches hard gates (can’t reach Launch without integrations).

---

### 04-logic (desktop)
**Observed**
- Raw JSON 404 for `GET:/logic`

**Issues vs plan**
- “Logic” could have been sequence rules/stop rules, but it’s not implemented and currently looks broken.
- Stop rules belong on **Experiment Run** with conservative defaults + explicit acknowledgments.

**Recommendations**
- Remove/redirect `/logic` to **Experiment Run** configuration section (throttle + stop rules + checklist).

---

### 05-doctor (desktop)
**Observed**
- Raw JSON 404 for `GET:/doctor`

**Issues vs plan**
- Not in MVP; reads like debug tooling.
- Exposing debug routes undermines “safe experimentation” trust.

**Recommendations**
- Remove from production navigation and block in production builds.
- If needed internally, gate behind admin and never show raw JSON.

## Top 5 Fixes (highest leverage first)
1. **Replace broken routes + raw JSON with a real MVP IA and guarded routing**
   - Implement the 5 screens exactly (Project Setup → Sequence Contract → Hypotheses → Leads/Suppression → Experiment Run).
   - Add an app shell nav and redirect unknown routes to home with a helpful message.

2. **Build Project Setup as the true “first value” conversion screen (with hard gates)**
   - Customer.io connect (API key/workspace, event name, template ID, variable preview, test connection).
   - Inbox connect (Gmail/O365 OAuth, from identity, test connection).
   - Conversion optional + sentiment fallback copy.
   - Explicit gate: “Cannot launch until Customer.io + Inbox connected.”

3. **Make safety and objective clarity persistent UI elements**
   - Header badges: Objective (Conversion vs Sentiment-only), Suppression active count, Send cap.
   - Any auto-actions (pause/kill) must show “why” inline per variant.

4. **Implement Hypothesis Queue + human approval gate before any sending**
   - Dense table with previews, rationale, risk flags, Approve/Deny/Edit.
   - Enforce “Approve ≥2 variants” to proceed.

5. **Implement Leads + Suppression with compliance gate before Launch**
   - CSV import + mapping + dedupe summary.
   - Suppression vault (global/project) + auto-add unsub replies.
   - Required compliance checkbox gating “Ready to launch.”