# Feature: brand-gpt-full-chat-workspace

## Request
Make the per-brand UI basically just a chatbot instead of a thin sidebar/panel. Brand GPT should feel like the main product: full-width chat workspace, primary action is send message, secondary brand metrics/settings hidden behind details.
## Autonomy Mode
holistic_autopilot
## Target Users
Founder/operator using Brand GPT to run marketing for a brand
## Optimization Target
make Brand GPT feel like the product and reduce dashboard/sidebar clutter
## Hard Constraints
- One primary action: send a message to Brand GPT
- Reuse existing OperatorPanel and design tokens
- Do not expose dashboards/settings by default
- Keep evidence/tool traces available but secondary
- Keep approval cards inside chat
## Scope
Optimize for make Brand GPT feel like the product and reduce dashboard/sidebar clutter. Start with smallest coherent slice that proves the per-brand UI basically just a chatbot instead of a thin sidebar/panel. Brand GPT should feel like the main product: full-width chat workspace, primary action is send message, secondary brand metrics/settings hidden behind details..
## Touched Surfaces
- Brand home page
- Brand GPT chat panel inline variant
- Brand navigation/default brand workspace
## Success Moment
[TODO] Define exact user outcome that proves this feature works.

## Failure Policy
[TODO] Describe recovery path on failure.

## Primary Action
Founder/operator using Brand GPT to run marketing for a brand should be able to the per-brand UI basically just a chatbot instead of a thin sidebar/panel. Brand GPT should feel like the main product: full-width chat workspace, primary action is send message, secondary brand metrics/settings hidden behind details. with one obvious first move.
## Primary Risk
Founder/operator using Brand GPT to run marketing for a brand should not have to guess what matters first or what can go wrong.
## Information Budget
First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown.
## View Model Contract
Primary user: Founder/operator using Brand GPT to run marketing for a brand
Current decision: the per-brand UI basically just a chatbot instead of a thin sidebar/panel. Brand GPT should feel like the main product: full-width chat workspace, primary action is send message, secondary brand metrics/settings hidden behind details.
Why now: Founder/operator using Brand GPT to run marketing for a brand needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: Founder/operator using Brand GPT to run marketing for a brand should not have to guess what matters first or what can go wrong.
## Concept Options
1. Full chat workspace: brand home is one large Brand GPT transcript/composer. Top row only shows brand name and compact status. Evidence, tool calls, and approvals stay inline in the chat. Brand context, work links, and setup move into collapsed details below or behind a small secondary area. This best matches the user’s request that the product feel basically like a chatbot.
2. Wider two-column agent desk: keep chat as the main column and keep the current risk/work rail visible. Lower code risk, but it still reads like a dashboard/sidebar surface.
3. Drawer-only cleanup: keep the right drawer but make it wider and simpler. Too small a change; it keeps the mental model the user explicitly rejected.
## Concept Winner
Familiar full chat workspace wins. The default per-brand screen should use a ChatGPT/Codex-like structure without copying another product pixel-for-pixel: centered transcript, centered rounded composer, minimal brand/status bar, starter prompts only in the empty state, inline evidence/actions, and all dashboard/setup controls behind Details. This directly addresses the user’s complaint that the old UI felt like a thin sidebar widget.
## Decisions
- Scope: Optimize for make Brand GPT feel like the product and reduce dashboard/sidebar clutter. Start with smallest coherent slice that proves the per-brand UI basically just a chatbot instead of a thin sidebar/panel. Brand GPT should feel like the main product: full-width chat workspace, primary action is send message, secondary brand metrics/settings hidden behind details.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
- Primary Action: Founder/operator using Brand GPT to run marketing for a brand should be able to the per-brand UI basically just a chatbot instead of a thin sidebar/panel. Brand GPT should feel like the main product: full-width chat workspace, primary action is send message, secondary brand metrics/settings hidden behind details. with one obvious first move. (source: agent_assumption; why: Autopilot inferred default for primary_action from request, audience, optimization target, and mode.)
- Primary Risk: Founder/operator using Brand GPT to run marketing for a brand should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for primary_risk from request, audience, optimization target, and mode.)
- Information Budget: First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown. (source: agent_assumption; why: Autopilot inferred default for information_budget from request, audience, optimization target, and mode.)
- View Model Contract: Primary user: Founder/operator using Brand GPT to run marketing for a brand
Current decision: the per-brand UI basically just a chatbot instead of a thin sidebar/panel. Brand GPT should feel like the main product: full-width chat workspace, primary action is send message, secondary brand metrics/settings hidden behind details.
Why now: Founder/operator using Brand GPT to run marketing for a brand needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: Founder/operator using Brand GPT to run marketing for a brand should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for view_model_contract from request, audience, optimization target, and mode.)
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-05-23 Implementation summary: Changed the per-brand default surface from a two-column agent desk into a familiar full chat workspace. Brand home now centers Brand GPT with a compact brand/status bar, removes the visible side rail/current-focus cards, embeds the inline OperatorPanel as the page itself, and collapses brand context, work links, delivery account, LinkedIn, and settings behind a single Details disclosure. OperatorPanel inline mode now hides drawer chrome, removes duplicate Brand GPT headers, centers the empty-state prompts, constrains messages to a chat-width column, and uses a rounded bottom composer with an icon send button.
- Files: src/app/brands/[id]/brand-home-client.tsx, src/components/operator/operator-panel.tsx, docs/uiux/features/brand-gpt-full-chat-workspace.md
- Components: BrandHomeClient, OperatorPanel
- Assumptions used: Use a ChatGPT/Codex-like structure without copying another product pixel-for-pixel., Keep the existing left app navigation for now; the brand content itself becomes chat-first., Keep details and setup reachable but collapsed by default.
## Doc Sync
- 2026-05-23 Synced after implementation.
- States touched: empty, loading, error, partial
- Code touched: src/app/brands/[id]/brand-home-client.tsx, src/components/operator/operator-panel.tsx, docs/uiux/features/brand-gpt-full-chat-workspace.md
