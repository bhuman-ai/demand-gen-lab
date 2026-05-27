# Feature: delivery-user-simplification

## Request
Look at the Delivery/Network UI and remove everything unnecessary for a normal user to see. The page should not expose internal sender plumbing, provider mechanics, diagnostic chips, or multiple equal-weight status blocks by default. Keep one simple sender status and one next action, with deeper diagnostics hidden behind explicit disclosure.
## Autonomy Mode
holistic_autopilot
## Target Users
Founder/operator who wants LastB2B to run outbound autonomously without understanding internal sender infrastructure
## Optimization Target
Reduce cognitive load and remove internal implementation details from the default Delivery UI
## Hard Constraints
- Default UI should show one simple status and one next action per sender
- Hide provider mechanics and detailed checks behind disclosure
- Do not remove the ability to troubleshoot when details are explicitly opened
- Reuse existing design tokens/components
## Scope
Optimize for Reduce cognitive load and remove internal implementation details from the default Delivery UI. Start with smallest coherent slice that proves Look at the Delivery/Network UI and remove everything unnecessary for a normal user to see. The should not expose internal sender plumbing, provider mechanics, diagnostic chips, or multiple equal-weight status blocks by default. Keep one simple sender status and one next action, with deeper diagnostics hidden behind explicit disclosure..
## Touched Surfaces
- Brand Delivery / Network sender cards
## Success Moment
Founder/operator who wants LastB2B to run outbound autonomously without understanding internal sender infrastructure completes Look at the Delivery/Network UI and remove everything unnecessary for a normal user to see. The should not expose internal sender plumbing, provider mechanics, diagnostic chips, or multiple equal-weight status blocks by default. Keep one simple sender status and one next action, with deeper diagnostics hidden behind explicit disclosure. and sees explicit confirmation of successful outcome.
## Failure Policy
Retry inline when safe, preserve context, and escalate to support or fallback path if repeated failure continues.
## Primary Action
Show whether each sender is usable and what LastB2B will do next.
## Primary Risk
Founder/operator who wants LastB2B to run outbound autonomously without understanding internal sender infrastructure should not have to guess what matters first or what can go wrong.
## Information Budget
Default sender row shows only: status, sender identity, one plain-English summary, today's safe capacity, and one next action. Everything else is behind Details.
## View Model Contract
Primary user: Founder/operator who wants LastB2B to run outbound autonomously without understanding internal sender infrastructure
Current decision: Look at the Delivery/Network UI and remove everything unnecessary for a normal user to see. The should not expose internal sender plumbing, provider mechanics, diagnostic chips, or multiple equal-weight status blocks by default. Keep one simple sender status and one next action, with deeper diagnostics hidden behind explicit disclosure.
Why now: Founder/operator who wants LastB2B to run outbound autonomously without understanding internal sender infrastructure needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: Founder/operator who wants LastB2B to run outbound autonomously without understanding internal sender infrastructure should not have to guess what matters first or what can go wrong.
## Concept Options
1. Keep current card layout and only rewrite labels. Rejected because the UI would still show too many equal-weight diagnostics.
2. Remove diagnostics entirely. Rejected because operators still need troubleshooting when a sender is blocked.
3. Simple default row with hidden diagnostics. Chosen: default shows one status, one sentence, today's safe capacity, and one next action. Provider details, health dimensions, routing, reply mailbox, warmup internals, and manual toggles move into a Details disclosure.
## Concept Winner
Use concept 3: simple default row with hidden diagnostics. It best matches LastB2B's autonomy promise because the normal user sees whether the sender is okay and what happens next, while advanced evidence remains available without dominating the page.
## Decisions
- Scope: Optimize for Reduce cognitive load and remove internal implementation details from the default Delivery UI. Start with smallest coherent slice that proves Look at the Delivery/Network UI and remove everything unnecessary for a normal user to see. The should not expose internal sender plumbing, provider mechanics, diagnostic chips, or multiple equal-weight status blocks by default. Keep one simple sender status and one next action, with deeper diagnostics hidden behind explicit disclosure.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
- Success Moment: Founder/operator who wants LastB2B to run outbound autonomously without understanding internal sender infrastructure completes Look at the Delivery/Network UI and remove everything unnecessary for a normal user to see. The should not expose internal sender plumbing, provider mechanics, diagnostic chips, or multiple equal-weight status blocks by default. Keep one simple sender status and one next action, with deeper diagnostics hidden behind explicit disclosure. and sees explicit confirmation of successful outcome. (source: agent_assumption; why: Autopilot inferred default for success_moment from request, audience, optimization target, and mode.)
- Primary Action: Founder/operator who wants LastB2B to run outbound autonomously without understanding internal sender infrastructure should be able to Look at the Delivery/Network UI and remove everything unnecessary for a normal user to see. The should not expose internal sender plumbing, provider mechanics, diagnostic chips, or multiple equal-weight status blocks by default. Keep one simple sender status and one next action, with deeper diagnostics hidden behind explicit disclosure. with one obvious first move. (source: agent_assumption; why: Autopilot inferred default for primary_action from request, audience, optimization target, and mode.)
- Primary Risk: Founder/operator who wants LastB2B to run outbound autonomously without understanding internal sender infrastructure should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for primary_risk from request, audience, optimization target, and mode.)
- Information Budget: First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown. (source: agent_assumption; why: Autopilot inferred default for information_budget from request, audience, optimization target, and mode.)
- View Model Contract: Primary user: Founder/operator who wants LastB2B to run outbound autonomously without understanding internal sender infrastructure
Current decision: Look at the Delivery/Network UI and remove everything unnecessary for a normal user to see. The should not expose internal sender plumbing, provider mechanics, diagnostic chips, or multiple equal-weight status blocks by default. Keep one simple sender status and one next action, with deeper diagnostics hidden behind explicit disclosure.
Why now: Founder/operator who wants LastB2B to run outbound autonomously without understanding internal sender infrastructure needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: Founder/operator who wants LastB2B to run outbound autonomously without understanding internal sender infrastructure should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for view_model_contract from request, audience, optimization target, and mode.)
- Failure Policy: Retry inline when safe, preserve context, and escalate to support or fallback path if repeated failure continues. (source: agent_assumption; why: Autopilot inferred default for failure_policy from request, audience, optimization target, and mode.)
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-05-27 Implementation summary: Simplified the Brand Delivery/Network screen around one user-facing decision: can LastB2B send safely today. The default page now has one Status panel, compact sender rows, plain-English sender states, no route-score/explainer/filter ledger, no provider mechanics in default copy, and a hidden setup backlog. Advanced health/routing/warmup/reply/manual controls remain behind Details for troubleshooting.
- Files: src/app/brands/[id]/network/network-client.tsx, docs/uiux/features/delivery-user-simplification.md, docs/uiux/states.md
- Components: Brand Delivery / Network page, Sender card, Delivery status panel
- Assumptions used: Normal users only need to know whether LastB2B can send safely today and what sender needs attention., Provider mechanics and diagnostic checks should be hidden unless the user explicitly opens Details., Long setup backlogs should not dominate the default page when active senders are available.
## Doc Sync
- 2026-05-27 Synced after implementation.
- States touched: partial
- Code touched: src/app/brands/[id]/network/network-client.tsx, docs/uiux/features/delivery-user-simplification.md, docs/uiux/states.md
