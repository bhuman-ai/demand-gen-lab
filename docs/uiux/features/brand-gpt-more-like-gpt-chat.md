# Feature: brand-gpt-more-like-gpt-chat

## Request
Make the per-brand Brand GPT workspace feel more like a ChatGPT-style chat interface while keeping LastB2B branding and not copying another product pixel-for-pixel.
## Autonomy Mode
holistic_autopilot
## Target Users
Founder/operator using Brand GPT as the primary way to run marketing for a brand
## Optimization Target
Make the default brand page feel like a true chat app: centered, quiet, single composer, minimal chrome, no dashboard feel.
## Hard Constraints
- One primary action: send a message
- Keep brand context and work links reachable but not visible by default
- Reuse existing OperatorPanel and design tokens
- Do not clone ChatGPT pixel-for-pixel or copy OpenAI trade dress
## Scope
Optimize for Make the default brand page feel like a true chat app: centered, quiet, single composer, minimal chrome, no dashboard feel.. Start with smallest coherent slice that proves the per-brand Brand GPT workspace feel more like a ChatGPT-style chat interface while keeping LastB2B branding and not copying another product pixel-for-pixel..
## Touched Surfaces
- Brand home page
- Brand GPT inline chat panel
## Success Moment
[TODO] Define exact user outcome that proves this feature works.

## Failure Policy
[TODO] Describe recovery path on failure.

## Primary Action
Founder/operator using Brand GPT as the primary way to run marketing for a brand should be able to the per-brand Brand GPT workspace feel more like a ChatGPT-style chat interface while keeping LastB2B branding and not copying another product pixel-for-pixel. with one obvious first move.
## Primary Risk
Founder/operator using Brand GPT as the primary way to run marketing for a brand should not have to guess what matters first or what can go wrong.
## Information Budget
First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown.
## View Model Contract
Primary user: Founder/operator using Brand GPT as the primary way to run marketing for a brand
Current decision: the per-brand Brand GPT workspace feel more like a ChatGPT-style chat interface while keeping LastB2B branding and not copying another product pixel-for-pixel.
Why now: Founder/operator using Brand GPT as the primary way to run marketing for a brand needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: Founder/operator using Brand GPT as the primary way to run marketing for a brand should not have to guess what matters first or what can go wrong.
## Concept Options
1. ChatGPT-like single canvas: Keep the page as one full-height chat canvas. Top bar is only Brand GPT, brand name, and a Details control. Transcript is centered and quiet. Empty state is a centered question with prompt cards. Composer is sticky at the bottom with a rounded input and a small send button. Brand context, risk, delivery, and navigation live inside the Details popover. This best matches the request.
2. Split agent console: Keep a visible status/risk rail beside the chat. This preserves operational visibility, but it still feels like a dashboard instead of GPT.
3. Floating assistant drawer: Keep the brand dashboard and make the chatbot a larger overlay. This is close to the rejected sidebar pattern and does not make chat the product.
## Concept Winner
ChatGPT-like single canvas wins. The default brand page should read as one calm chat workspace: minimal top bar, centered empty state and transcript, sticky bottom composer, and no visible dashboard/status rail. Operational context remains available through a single Details popover, so the primary visual task is always messaging Brand GPT.
## Decisions
- Scope: Optimize for Make the default brand page feel like a true chat app: centered, quiet, single composer, minimal chrome, no dashboard feel.. Start with smallest coherent slice that proves the per-brand Brand GPT workspace feel more like a ChatGPT-style chat interface while keeping LastB2B branding and not copying another product pixel-for-pixel.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
- Primary Action: Founder/operator using Brand GPT as the primary way to run marketing for a brand should be able to the per-brand Brand GPT workspace feel more like a ChatGPT-style chat interface while keeping LastB2B branding and not copying another product pixel-for-pixel. with one obvious first move. (source: agent_assumption; why: Autopilot inferred default for primary_action from request, audience, optimization target, and mode.)
- Primary Risk: Founder/operator using Brand GPT as the primary way to run marketing for a brand should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for primary_risk from request, audience, optimization target, and mode.)
- Information Budget: First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown. (source: agent_assumption; why: Autopilot inferred default for information_budget from request, audience, optimization target, and mode.)
- View Model Contract: Primary user: Founder/operator using Brand GPT as the primary way to run marketing for a brand
Current decision: the per-brand Brand GPT workspace feel more like a ChatGPT-style chat interface while keeping LastB2B branding and not copying another product pixel-for-pixel.
Why now: Founder/operator using Brand GPT as the primary way to run marketing for a brand needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: Founder/operator using Brand GPT as the primary way to run marketing for a brand should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for view_model_contract from request, audience, optimization target, and mode.)
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-05-24 Implementation summary: Made the per-brand Brand GPT screen read more like a ChatGPT-style chat app while preserving LastB2B tokens. The Agent route now uses a chromeless main area with no duplicate app breadcrumb header. The Brand GPT page has one slim top bar, a Details popover for brand context/risk/work links/delivery setup, the chat canvas fills the page, and the inline OperatorPanel has centered messages, softer user bubbles, a quieter working state, mobile-first prompt cards, and a bottom composer. On mobile the workspace sidebar is hidden for the Agent route so the chat starts immediately instead of below navigation.
- Files: src/app/brands/[id]/brand-home-client.tsx, src/components/operator/operator-panel.tsx, src/components/layout/app-shell.tsx, docs/uiux/features/brand-gpt-more-like-gpt-chat.md
- Components: BrandHomeClient, OperatorPanel, AppShell
- Assumptions used: Use ChatGPT-style structure without copying OpenAI trade dress pixel-for-pixel., Keep the desktop left workspace sidebar, but hide it on mobile for the Agent route., Keep operational controls reachable through Details instead of visible in the default chat view.
## Doc Sync
- 2026-05-24 Synced after implementation.
- States touched: empty, loading, error, partial
- Code touched: src/app/brands/[id]/brand-home-client.tsx, src/components/operator/operator-panel.tsx, src/components/layout/app-shell.tsx, docs/uiux/features/brand-gpt-more-like-gpt-chat.md
