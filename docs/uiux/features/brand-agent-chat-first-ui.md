# Feature: brand-agent-chat-first-ui

## Request
Reorganize the LastB2B UI so the default per-brand experience is focused on direct chatting with the agent for each brand rather than managing or setting up tools manually.
## Autonomy Mode
holistic_autopilot
## Target Users
founder/operator managing outbound brands
## Optimization Target
one obvious per-brand action: message the brand agent
## Hard Constraints
- Use kid-simple-ui: one primary action; hide setup/tool management by default.
- Use existing repo UI primitives and tokens first.
- Do not expose raw internal tool names in the default user-facing UI.
- Do not send messages, launch campaigns, or connect channels without existing backend guardrails.
- Keep secondary setup, integrations, and diagnostics behind progressive disclosure.
## Scope
Optimize for one obvious per-brand action: message the brand agent. Start with the smallest coherent slice that proves the default per-brand experience can feel like briefing an agent instead of configuring tools.
## Touched Surfaces
- brand home
- brand navigation
- Brand GPT operator panel
- mission/operator status surfaces
## Success Moment
A founder opens a brand and immediately sees the brand agent as the main surface, types a plain-language request, and can see the one current blocker or recommended next move without visiting tool setup pages.
## Failure Policy
If chat or agent planning fails, keep the conversation visible, preserve the user's draft, show the plain failure reason, and offer retry from the same brand context. If a channel or setup issue blocks progress, name the blocker in the side context and link to the relevant settings surface without making setup the default screen.
## Primary Action
Message the brand agent.
## Primary Risk
The user may not trust the agent if setup, tool names, or diagnostics still dominate the first screen.
## Information Budget
Default brand view shows one composer, the latest agent response or starter prompt, one current blocker or risk, and one plain secondary path to details. Tool setup, integrations, diagnostics, and raw execution detail stay behind explicit disclosure or settings links.
## View Model Contract
Primary user: founder/operator managing outbound brands.
Current decision: what should I ask this brand agent to do next?
Why now: the product should feel like briefing an agent, not configuring outreach machinery.
Next action: type a request into the brand agent composer.
Top risk: hiding too much context could make blockers feel mysterious, so one blocker/risk summary remains visible.
## Concept Options
1. Launcher-first brand home: keep the existing brand dashboard and make Ask GPT larger. Lowest risk, but still frames chat as an accessory to setup/status management.
2. Embedded brand agent desk: make the brand home a two-column agent workspace with chat/composer as the main left surface and a narrow context rail for current blocker, recent receipts, and secondary links. Best balance: direct chat becomes primary while guardrails and context remain visible.
3. Full-screen chat only: make each brand route a pure chat transcript. Cleanest mental model, but it hides useful receipts/blockers too aggressively and risks making the product feel less trustworthy during autonomous work.
## Concept Winner
Concept 2 wins: Embedded brand agent desk. The brand page should open on a direct Brand GPT conversation/composer and keep only a compact context rail for current work, one visible risk, and links to secondary details. This beats launcher-first because chat is no longer a hidden panel, and it beats full-screen chat because autonomous work still needs visible blockers and receipts.
## Decisions
- Scope: Optimize for one obvious per-brand action: message the brand agent. Start with smallest coherent slice that proves Reorganize the LastB2B UI so the default per-brand experience is focused on direct chatting with the agent for each brand rather than managing or setting up tools manually.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
- Primary Action: founder/operator managing outbound brands should be able to Reorganize the LastB2B UI so the default per-brand experience is focused on direct chatting with the agent for each brand rather than managing or setting up tools manually. with one obvious first move. (source: agent_assumption; why: Autopilot inferred default for primary_action from request, audience, optimization target, and mode.)
- Primary Risk: founder/operator managing outbound brands should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for primary_risk from request, audience, optimization target, and mode.)
- Information Budget: First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown. (source: agent_assumption; why: Autopilot inferred default for information_budget from request, audience, optimization target, and mode.)
- View Model Contract: Primary user: founder/operator managing outbound brands
Current decision: Reorganize the LastB2B UI so the default per-brand experience is focused on direct chatting with the agent for each brand rather than managing or setting up tools manually.
Why now: founder/operator managing outbound brands needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: founder/operator managing outbound brands should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for view_model_contract from request, audience, optimization target, and mode.)
## Open Questions
None for this slice.

## Design Notes
Patch/Redesign mode: Redesign the brand home default composition while reusing the existing Brand GPT/operator runtime and UI primitives. Keep the first screen focused on a large conversation area with a plain composer. Move campaign, mission, inbox, social discovery, settings, and diagnostics into secondary links or details. Avoid new colors, gradients, decorative dashboard cards, or raw tool labels.
## Implementation Notes
- 2026-05-23 Implementation summary: Reorganized the per-brand default surface into an embedded Brand GPT agent desk. The brand home now places the chat thread/composer as the main work area, shows only one current risk and a compact work rail, and moves brand context, extra work, delivery setup, LinkedIn connection, and outreach settings behind collapsed details. AppShell now makes Agent the first brand nav item and hides campaign/delivery/social/system pages behind secondary disclosure. OperatorPanel now supports the existing drawer and a reusable inline variant for the brand home.
- Files: /Users/don/lastb2b/src/app/brands/[id]/brand-home-client.tsx, /Users/don/lastb2b/src/components/operator/operator-panel.tsx, /Users/don/lastb2b/src/components/layout/app-shell.tsx, /Users/don/lastb2b/docs/uiux/features/brand-agent-chat-first-ui.md
- Components: BrandHomeClient, OperatorPanel, AppShell
- Assumptions used: The existing Brand GPT/operator runtime remains the single chat backend; the brand home embeds it instead of creating a second chat system., Setup/tool management should remain reachable but not visible by default on the brand landing surface., The current risk rail should preserve trust while keeping the composer as the primary action.
## Doc Sync
- 2026-05-23 Synced after implementation.
- States touched: loading, error, partial
- Code touched: /Users/don/lastb2b/src/app/brands/[id]/brand-home-client.tsx, /Users/don/lastb2b/src/components/operator/operator-panel.tsx, /Users/don/lastb2b/src/components/layout/app-shell.tsx, /Users/don/lastb2b/docs/uiux/features/brand-agent-chat-first-ui.md
