# Feature: instagram-growth-marketer-ui

## Request
Create a separate marketer-facing UI for Instagram growth/brand growth using the existing social discovery comment posting and comment-like promotion workflow. The UI should be marketable to people who want to grow their Instagram/brand, but should hide auth/debug complexity and preserve guardrails around approved comments, account health, throttles, and platform compliance.
## Autonomy Mode
holistic_autopilot
## Target Users
Founder/operator or marketer trying to grow an Instagram account or brand through approved social comment opportunities
## Optimization Target
Make the growth workflow easy to understand and launch without exposing internal automation/debug controls.
## Hard Constraints
- Do not expose low-level OAuth/debug/token controls in the default marketer-facing view.
- Do not encourage spam
- impersonation
- or deceptive engagement buying.
- Reuse existing social discovery/comment delivery infrastructure where possible.
- Keep manual approval and account-health guardrails visible before posting.
## Scope
Optimize for Make the growth workflow easy to understand and launch without exposing internal automation/debug controls.. Start with smallest coherent slice that proves a separate marketer-facing UI for Instagram growth/brand growth using the existing social discovery comment posting and comment-like promotion workflow. The UI should be marketable to people who want to grow their Instagram/brand, but should hide auth/debug complexity and preserve guardrails around approved comments, account health, throttles, and platform compliance..
## Touched Surfaces
- /brands/[id]/social-discovery
- new Instagram growth surface
## Success Moment
[TODO] Define exact user outcome that proves this feature works.

## Failure Policy
[TODO] Describe recovery path on failure.

## Primary Action
Founder/operator or marketer trying to grow an Instagram account or brand through approved social comment opportunities should be able to a separate marketer-facing UI for Instagram growth/brand growth using the existing social discovery comment posting and comment-like promotion workflow. The UI should be marketable to people who want to grow their Instagram/brand, but should hide auth/debug complexity and preserve guardrails around approved comments, account health, throttles, and platform compliance. with one obvious first move.
## Primary Risk
Founder/operator or marketer trying to grow an Instagram account or brand through approved social comment opportunities should not have to guess what matters first or what can go wrong.
## Information Budget
First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown.
## View Model Contract
Primary user: Founder/operator or marketer trying to grow an Instagram account or brand through approved social comment opportunities
Current decision: a separate marketer-facing UI for Instagram growth/brand growth using the existing social discovery comment posting and comment-like promotion workflow. The UI should be marketable to people who want to grow their Instagram/brand, but should hide auth/debug complexity and preserve guardrails around approved comments, account health, throttles, and platform compliance.
Why now: Founder/operator or marketer trying to grow an Instagram account or brand through approved social comment opportunities needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: Founder/operator or marketer trying to grow an Instagram account or brand through approved social comment opportunities should not have to guess what matters first or what can go wrong.
## Concept Options
Primary Action: review one qualified Instagram growth opportunity, approve the comment, and launch the next safe action.

Primary Risk: the UI could make the product feel like spam or engagement manipulation instead of approved, account-safe participation in relevant conversations.

Information Budget: first screen shows one queue, one selected opportunity, one account/risk state, and one launch action. Account setup, promotion purchase details, API diagnostics, and raw payloads stay behind explicit secondary views.

View Model Contract:
- Primary user: marketer or founder/operator trying to grow an Instagram account or brand.
- Current decision: which Instagram opportunity is safe and worthwhile to engage now.
- Why now: growth depends on timely, relevant comments while avoiding account-risk behavior.
- Next action: approve/post the selected comment or skip it.
- Top risk: posting from an unhealthy account or launching copy that sounds promotional, fake, or coordinated.

Concept Options:

1. Growth Desk
- Dedicated route focused on Instagram opportunities.
- Left column: compact queue grouped by Ready, Needs edit, Posted, Blocked.
- Main inspector: selected post context, recommended account health, editable comment, and clear approve/post action.
- Secondary rail/tabs: account pool, promotion history, and advanced setup.
- Best fit because the product can be sold as a daily marketer workflow while still reusing the existing Social Discovery backend.

2. Campaign Wizard
- Step-by-step setup: target audience -> connect account -> generate comments -> launch.
- Good for first-time onboarding, but too slow for repeated daily use and likely to hide queue health.
- Rejected for the first build; can become an onboarding overlay later.

3. Reskinned Social Discovery
- Keep the current Social Discovery page and add an Instagram mode switch plus friendlier copy.
- Lowest implementation cost, but it keeps the operator/debug mental model and does not create a clean marketable product surface.
- Rejected because the user asked for a separate UI.
## Concept Winner
Use Concept 1: Growth Desk.

The new surface should be a dedicated Instagram Growth route that feels like a marketer workbench, not an internal automation console. It should preserve the current Social Discovery infrastructure but translate it into an actor-specific view model: opportunity, account readiness, draft quality, next safe action.

Implementation direction:
- Add a new brand route for Instagram Growth rather than overloading the existing Social Discovery first screen.
- Build the first slice as a client UI that can read real brand context and present representative opportunity states from the existing data shape.
- Reuse shared Button/Card/Input/Textarea primitives and existing semantic tokens.
- Keep posting and promotion actions wired as guarded affordances only when an opportunity/account is valid; no raw OAuth, token, Unipile, or BuyShazam details on the default screen.
- Keep copy compliance-aware: approve, post, skip, account health, cooldown, draft quality. Avoid language that promises fake growth, botting, spam, or guaranteed engagement.
## Decisions
- Scope: Optimize for Make the growth workflow easy to understand and launch without exposing internal automation/debug controls.. Start with smallest coherent slice that proves a separate marketer-facing UI for Instagram growth/brand growth using the existing social discovery comment posting and comment-like promotion workflow. The UI should be marketable to people who want to grow their Instagram/brand, but should hide auth/debug complexity and preserve guardrails around approved comments, account health, throttles, and platform compliance.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
- Primary Action: Founder/operator or marketer trying to grow an Instagram account or brand through approved social comment opportunities should be able to a separate marketer-facing UI for Instagram growth/brand growth using the existing social discovery comment posting and comment-like promotion workflow. The UI should be marketable to people who want to grow their Instagram/brand, but should hide auth/debug complexity and preserve guardrails around approved comments, account health, throttles, and platform compliance. with one obvious first move. (source: agent_assumption; why: Autopilot inferred default for primary_action from request, audience, optimization target, and mode.)
- Primary Risk: Founder/operator or marketer trying to grow an Instagram account or brand through approved social comment opportunities should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for primary_risk from request, audience, optimization target, and mode.)
- Information Budget: First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown. (source: agent_assumption; why: Autopilot inferred default for information_budget from request, audience, optimization target, and mode.)
- View Model Contract: Primary user: Founder/operator or marketer trying to grow an Instagram account or brand through approved social comment opportunities
Current decision: a separate marketer-facing UI for Instagram growth/brand growth using the existing social discovery comment posting and comment-like promotion workflow. The UI should be marketable to people who want to grow their Instagram/brand, but should hide auth/debug complexity and preserve guardrails around approved comments, account health, throttles, and platform compliance.
Why now: Founder/operator or marketer trying to grow an Instagram account or brand through approved social comment opportunities needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: Founder/operator or marketer trying to grow an Instagram account or brand through approved social comment opportunities should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for view_model_contract from request, audience, optimization target, and mode.)
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-06-07 Implementation summary: Added a dedicated /brands/[id]/instagram-growth route with server-loaded Instagram opportunities and Instagram-capable social accounts, a queue/inspector review UI, editable comment composer, account health and cooldown guardrails, post-through to the existing social-discovery comment endpoint, an empty state, and an AppShell navigation entry.
- Files: src/app/brands/[id]/instagram-growth/page.tsx, src/app/brands/[id]/instagram-growth/instagram-growth-client.tsx, src/components/layout/app-shell.tsx
- Components: InstagramGrowthPage, InstagramGrowthClient, AppShell navigation
- Assumptions used: The marketer-facing route should reuse the existing social-discovery data model and comment posting endpoint rather than introduce a parallel backend flow., The default UI should keep manual approval, account health, cooldown, and risk notes visible before posting., Low-level OAuth, Unipile, BuyShazam, and token diagnostics should stay out of the default marketer surface., When there are no Instagram opportunities yet, the route should start from a simple empty state that links back to Social Discovery for sourcing/setup.
## Doc Sync
- 2026-06-07 Synced after implementation.
- States touched: empty, error, partial
- Code touched: src/app/brands/[id]/instagram-growth/page.tsx, src/app/brands/[id]/instagram-growth/instagram-growth-client.tsx, src/components/layout/app-shell.tsx
