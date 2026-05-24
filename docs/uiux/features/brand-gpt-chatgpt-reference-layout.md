# Feature: brand-gpt-chatgpt-reference-layout

## Request
Make the per-brand Brand GPT UI look more like the provided ChatGPT screenshot: flat left sidebar, plain nav rows, central chat reading column, slim top bar, and floating bottom composer, while keeping LastB2B branding and not copying OpenAI trade dress exactly.
## Autonomy Mode
holistic_autopilot
## Target Users
Founder/operator using Brand GPT as their primary B2B growth operator chat
## Optimization Target
Make Brand GPT feel more like a mature chat product instead of a boxed dashboard or custom admin app.
## Hard Constraints
- Borrow structure from the screenshot but keep LastB2B branding/tokens
- One primary action remains sending a Brand GPT message
- Avoid exact pixel clone or OpenAI trade dress
- Keep operational controls reachable through Details or secondary nav
## Scope
Optimize for Make Brand GPT feel more like a mature chat product instead of a boxed dashboard or custom admin app.. Start with smallest coherent slice that proves the per-brand Brand GPT UI look more like the provided ChatGPT screenshot: flat left sidebar, plain nav rows, central chat reading column, slim top bar, and floating bottom composer, while keeping LastB2B branding and not copying OpenAI trade dress exactly..
## Touched Surfaces
- Brand GPT Agent route
- AppShell sidebar
- Brand switcher
- Inline OperatorPanel
## Success Moment
[TODO] Define exact user outcome that proves this feature works.

## Failure Policy
[TODO] Describe recovery path on failure.

## Primary Action
Founder/operator using Brand GPT as their primary B2B growth operator chat should be able to the per-brand Brand GPT UI look more like the provided ChatGPT screenshot: flat left sidebar, plain nav rows, central chat reading column, slim top bar, and floating bottom composer, while keeping LastB2B branding and not copying OpenAI trade dress exactly. with one obvious first move.
## Primary Risk
Founder/operator using Brand GPT as their primary B2B growth operator chat should not have to guess what matters first or what can go wrong.
## Information Budget
First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown.
## View Model Contract
Primary user: Founder/operator using Brand GPT as their primary B2B growth operator chat
Current decision: the per-brand Brand GPT UI look more like the provided ChatGPT screenshot: flat left sidebar, plain nav rows, central chat reading column, slim top bar, and floating bottom composer, while keeping LastB2B branding and not copying OpenAI trade dress exactly.
Why now: Founder/operator using Brand GPT as their primary B2B growth operator chat needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: Founder/operator using Brand GPT as their primary B2B growth operator chat should not have to guess what matters first or what can go wrong.
## Concept Options
1. Reference-aligned chat shell: Use a wider flat sidebar, plain icon/text nav rows, a simple brand/chat list section, bottom account row, a slim chat top bar, centered transcript, and floating composer. This borrows the screenshot's product grammar while keeping LastB2B labels and tokens.
2. Main-panel-only refinement: Keep existing sidebar mostly unchanged and only tune the central chat. Lower risk, but it misses the screenshot's strongest signal: the flat ChatGPT-style sidebar and mature shell.
3. Full pixel clone: Copy exact sidebar labels, spacing, and controls. Rejected because it would copy OpenAI trade dress and include unrelated ChatGPT concepts.
## Concept Winner
Reference-aligned chat shell wins. The implementation should make the Agent route feel like a mature chat product: flat persistent sidebar on desktop, hidden sidebar on mobile, no boxed dashboard cards, one centered chat column, one slim top bar, and a floating composer. Preserve LastB2B naming, routes, and semantic tokens rather than cloning ChatGPT's exact visual identity.
## Decisions
- Scope: Optimize for Make Brand GPT feel more like a mature chat product instead of a boxed dashboard or custom admin app.. Start with smallest coherent slice that proves the per-brand Brand GPT UI look more like the provided ChatGPT screenshot: flat left sidebar, plain nav rows, central chat reading column, slim top bar, and floating bottom composer, while keeping LastB2B branding and not copying OpenAI trade dress exactly.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
- Primary Action: Founder/operator using Brand GPT as their primary B2B growth operator chat should be able to the per-brand Brand GPT UI look more like the provided ChatGPT screenshot: flat left sidebar, plain nav rows, central chat reading column, slim top bar, and floating bottom composer, while keeping LastB2B branding and not copying OpenAI trade dress exactly. with one obvious first move. (source: agent_assumption; why: Autopilot inferred default for primary_action from request, audience, optimization target, and mode.)
- Primary Risk: Founder/operator using Brand GPT as their primary B2B growth operator chat should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for primary_risk from request, audience, optimization target, and mode.)
- Information Budget: First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown. (source: agent_assumption; why: Autopilot inferred default for information_budget from request, audience, optimization target, and mode.)
- View Model Contract: Primary user: Founder/operator using Brand GPT as their primary B2B growth operator chat
Current decision: the per-brand Brand GPT UI look more like the provided ChatGPT screenshot: flat left sidebar, plain nav rows, central chat reading column, slim top bar, and floating bottom composer, while keeping LastB2B branding and not copying OpenAI trade dress exactly.
Why now: Founder/operator using Brand GPT as their primary B2B growth operator chat needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: Founder/operator using Brand GPT as their primary B2B growth operator chat should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for view_model_contract from request, audience, optimization target, and mode.)
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-05-24 Implementation summary: Updated the Brand GPT Agent route to follow the provided ChatGPT screenshot's product grammar without copying OpenAI trade dress. The desktop shell now uses a wider flat sidebar with plain rows, a compact brand selector, and a bottom workspace identity row. The main chat keeps a slim top bar, wider centered chat column, and a floating composer. The composer now has a functional plus action that opens Brand Details/context. Mobile continues to hide the sidebar so the chat starts immediately.
- Files: src/components/layout/app-shell.tsx, src/components/layout/brand-switcher.tsx, src/components/operator/operator-panel.tsx, src/app/brands/[id]/brand-home-client.tsx, docs/uiux/features/brand-gpt-chatgpt-reference-layout.md
- Components: AppShell, BrandSwitcher, OperatorPanel, BrandHomeClient
- Assumptions used: Use the screenshot as structure/reference, not a pixel clone., Keep LastB2B route names and operational concepts instead of ChatGPT labels., Make the composer plus button functional by opening Details/context.
## Doc Sync
- 2026-05-24 Synced after implementation.
- States touched: empty, loading, error, partial
- Code touched: src/components/layout/app-shell.tsx, src/components/layout/brand-switcher.tsx, src/components/operator/operator-panel.tsx, src/app/brands/[id]/brand-home-client.tsx, docs/uiux/features/brand-gpt-chatgpt-reference-layout.md
