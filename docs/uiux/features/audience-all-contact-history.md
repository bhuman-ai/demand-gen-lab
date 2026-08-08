# Feature: audience-all-contact-history

## Request
Fix the Audience page so it shows everyone the brand has ever tried to email/contact, not just manual leads or people who replied. The screenshot shows /brands/brand_mlg68b9l/leads incorrectly reporting zero audience even though outreach run leads/messages exist.
## Autonomy Mode
holistic_autopilot
## Target Users
Founder/operator using LastB2B to understand who the agent has contacted or queued for outreach
## Optimization Target
decision speed and accurate operating record
## Hard Constraints
- Do not invent contacts from replies only
- Include outreach run leads and sent/scheduled/canceled/failed contact attempts
- Keep manual Add lead secondary
- Reuse existing UI tokens/components
## Scope
Make `/brands/[brandId]/leads` an accurate audience register for everyone the brand has entered into outbound or mailbox history. Include manual leads, run leads, scheduled/sent/failed message activity, and reply contacts. Keep this scoped to read/display behavior plus manual lead add persistence.
## Touched Surfaces
- /brands/[brandId]/leads
- Audience page
- Brand workspace sidebar
## Success Moment
A founder opens Audience and immediately sees the actual people the agent has sourced, queued, emailed, failed, or received replies from; the page no longer says empty when outreach run leads exist.
## Failure Policy
If no outreach/manual/reply history exists, show the empty state. If some contacts lack email/company/title, still show the person with available identifiers instead of hiding the row.
## Primary Action
Review the current audience register and filter it to understand who has been found, queued, emailed, failed, or replied.
## Primary Risk
The page must not imply zero audience or zero activity just because contacts came from outbound runtime tables instead of the manual brand lead list.
## Information Budget
First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown.
## View Model Contract
Primary user: Founder/operator checking whether Brand GPT has a real audience.
Current decision: Which people exist in the brand's contact history and what state are they in?
Why now: The old page hid runtime outreach contacts and made active brands look empty.
Next action: Filter/review the audience register; manual Add lead is secondary.
Top risk: Runtime history and manual history drifting into separate, contradictory views.
## Concept Options
1. Manual-only patch: keep the existing manual lead table and add a small imported run-lead count. Rejected because it still treats real outbound history as secondary and can keep the page looking empty.
2. Unified audience register: merge manual brand leads with outreach run leads and message/reply activity into one deduplicated contact register. Chosen direction because the page becomes the operating record for everyone the agent has touched or queued.
3. Separate tabs for Manual, Outbound, Replies: clear provenance but too much navigation for the immediate founder/operator question; useful later only if the register becomes large.
## Concept Winner
Use the unified audience register. Server-side, build a brand audience summary from manual brand leads, outreach run leads, outreach messages, and reply threads. Client-side, keep the existing LastB2B panel/table grammar but show source, status, last touch, attempts, and reply signal. The empty state appears only when there are truly no manual leads, run leads, messages, or reply contacts for the brand.
## Decisions
- Scope: Optimize for decision speed and accurate operating record. Start with smallest coherent slice that proves Fix the Audience so it shows everyone the brand has ever tried to email/contact, not just manual leads or people who replied. The screenshot shows /brands/brand_mlg68b9l/leads incorrectly reporting zero audience even though outreach run leads/messages exist.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
- Primary Action: Founder/operator using LastB2B to understand who the agent has contacted or queued for outreach should be able to Fix the Audience so it shows everyone the brand has ever tried to email/contact, not just manual leads or people who replied. The screenshot shows /brands/brand_mlg68b9l/leads incorrectly reporting zero audience even though outreach run leads/messages exist. with one obvious first move. (source: agent_assumption; why: Autopilot inferred default for primary_action from request, audience, optimization target, and mode.)
- Primary Risk: Founder/operator using LastB2B to understand who the agent has contacted or queued for outreach should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for primary_risk from request, audience, optimization target, and mode.)
- Information Budget: First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown. (source: agent_assumption; why: Autopilot inferred default for information_budget from request, audience, optimization target, and mode.)
- View Model Contract: Primary user: Founder/operator using LastB2B to understand who the agent has contacted or queued for outreach
Current decision: Fix the Audience so it shows everyone the brand has ever tried to email/contact, not just manual leads or people who replied. The screenshot shows /brands/brand_mlg68b9l/leads incorrectly reporting zero audience even though outreach run leads/messages exist.
Why now: Founder/operator using LastB2B to understand who the agent has contacted or queued for outreach needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: Founder/operator using LastB2B to understand who the agent has contacted or queued for outreach should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for view_model_contract from request, audience, optimization target, and mode.)
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-05-27 Implementation summary: Audience page now builds a unified server-side audience snapshot from manual leads, outreach run leads, outreach messages, and reply threads. The register dedupes by email/lead, shows source, status, touch count, last touch, and keeps manual Add lead below the primary register.
- Files: src/lib/audience-data.ts, src/lib/outreach-data.ts, src/app/brands/[id]/leads/page.tsx, src/app/brands/[id]/leads/leads-client.tsx
- Components: LeadsPage, LeadsClient, Audience register
- Assumptions used: Manual lead entry remains secondary to the unified audience register., Contacts are deduped by email first, then lead id, then source-specific fallback id., Canceled messages keep the person visible through run-lead history but do not count as touches.
## Doc Sync
- 2026-05-27 Synced after implementation.
- States touched: empty
- Code touched: src/lib/audience-data.ts, src/lib/outreach-data.ts, src/app/brands/[id]/leads/page.tsx, src/app/brands/[id]/leads/leads-client.tsx
