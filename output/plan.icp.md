## ICP
Early-stage B2B SaaS founder (Seed–Series A) or first GTM hire running outbound with low deliverability headroom and no time to “iterate manually.”
- **Motion:** cold/warm email outbound + basic lead sourcing; needs rapid messaging iteration
- **Stack:** Customer.io already in place (or willing to adopt), Google Workspace/O365 inboxes, lightweight CRM/spreadsheet
- **Constraints:** small list sizes, limited domain/inbox inventory, high downside to burning reputation
- **Buying trigger:** outbound plateau + need to test many angles fast without hiring an SDR team or lifecycle marketer

## Jobs To Be Done
- Generate many *credible* outbound sequence hypotheses for a specific ICP/offer.
- Run controlled micro-tests across variants without operational overhead.
- Detect winners early (reply + conversion), kill losers automatically, and scale safely.
- Keep sending centralized in Customer.io while tracking variant performance internally.
- Maintain compliance/suppression hygiene across imports and lists.

## Pain Points
- “I can’t run enough experiments fast enough” (manual copy + setup bottleneck).
- “We’re guessing what works” (no structured hypothesis→test→learn loop).
- Small sample sizes + noisy signals make decisions hard (reply sentiment vs true conversion).
- Tool sprawl: copy in docs, sends in one tool, replies elsewhere, results nowhere.
- Fear of damaging sender reputation (especially with limited domains/inboxes).
- Lead sourcing is brittle/expensive; actor quality varies; cost overruns.

## Must-Have Features
- **Customer.io-first sending model:** single template/event; variant content passed as variables; no template explosion.
- **Project→Campaign→Sequence→Experiment→Lead model** with clear experiment ownership and auditability.
- **Hypothesis Queue (LLM):** generate 50–200 ideas, force user approve/deny, store rationale + constraints.
- **Micro-batch runner:** batch sizing, throttles, holdouts, automatic stop rules (min N, max spend, fail-fast).
- **Winner/Loser system:** auto-pause underperformers; promote winners; simple global objective selection (conversion primary; reply sentiment fallback).
- **Reply ingestion + sentiment classification:** Gmail/Outlook/IMAP ingest, thread mapping, basic labels (positive/neutral/negative/OOO/unsub).
- **Lead import + suppression vault:** dedupe, global suppress, per-project suppress, unsubscribe handling.
- **Apify orchestration guardrails:** actor validation (README + pricing model), schema-driven input builder, hard caps + auto-abort on cost/item count.
- **High-density ops UI:** Evolution Grid + Winner’s Circle as the core daily surfaces (data-first, dark mode).

## Not Now (Explicit Cuts)
- Device farm / device fleet controls and remote infra management.
- Domain purchase/DNS automation (Namecheap/Cloudflare), warmup orchestration, complex deliverability tooling.
- Full CRM replacement, deep pipeline management, multi-touch attribution.
- Multi-channel outbound (SMS, LinkedIn, calls) and complex journey orchestration.
- “Universal Inbox” power features (assignment, SLAs, team workflows) beyond ingestion + labeling.
- Automated actor marketplace/discovery beyond LLM-suggest + human validation.
- AI auto-sending without human approval gates (keep explicit approvals in v1).

## Success Metric
**Primary:** conversion rate lift from baseline on scaled “winner” sequences (meetings booked / signups / demos) with statistically defensible stopping rules.  
**Operational:** time-to-first-validated-winner (e.g., <14 days) and % of variants automatically culled without manual analysis.

## Risks To Validate First
- **Signal reliability:** can v1 infer “conversion” cleanly (events/webhooks) or will it rely too heavily on noisy reply sentiment?
- **Sample size reality:** do target users have enough volume to run parallel micro-batches without false positives?
- **Inbox ingestion complexity:** threading + identity mapping across Gmail/O365/IMAP; handling OOO/unsub reliably.
- **Customer.io fit:** are users willing/able to route outbound through Customer.io (vs Apollo/HubSpot/Salesloft)?
- **Deliverability safety:** without domain/DNS automation, can users still scale winners safely, or will fear block adoption?
- **Apify economics:** actor costs/limits predictable enough for “autonomous” scouting without surprise spend?
- **Workflow acceptance:** will founders actually approve/deny 50–200 hypotheses, or is that too much friction?