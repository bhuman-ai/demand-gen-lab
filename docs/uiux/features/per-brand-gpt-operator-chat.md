# Feature: per-brand-gpt-operator-chat

## Request
Add a simple per-brand GPT chatbox/operator surface so users can ask the brand agent what to do next and initiate channel actions like Leadr LinkedIn login without seeing raw internal tool plumbing.
## Autonomy Mode
holistic_autopilot
## Target Users
founder/operator using LastB2B to run autonomous B2B growth per brand
## Optimization Target
one obvious per-brand action: ask GPT / connect required channel
## Hard Constraints
- Keep UI simple with one primary action; hide raw Leadr/internal tool names from default user-facing UI.
- Use existing repo components/tokens/patterns first.
- Do not send messages or launch campaigns from the UI without existing backend guardrails.
## Scope
Optimize for one obvious per-brand action: ask GPT / connect required channel. Start with smallest coherent slice that proves Add a simple per-brand GPT chatbox/operator surface so users can ask the brand agent what to do next and initiate channel actions like Leadr LinkedIn login without seeing raw internal tool plumbing..
## Touched Surfaces
- brand home
- brand missions
- operator panel
- Leadr channel auth
## Success Moment
A founder opens a brand, clicks one obvious GPT action, asks for LinkedIn access or the next move, and gets either a clear answer, a safe confirmation card, or a Leadr sign-in link without seeing raw internal tool setup.

## Failure Policy
If GPT/tool execution fails, keep the chat open, preserve the user's message, show the plain failure reason, and let the user retry or ask a follow-up from the same brand context.

## Primary Action
Ask GPT for this brand.
## Primary Risk
The user may not realize Leadr login is a human OAuth step while campaign/channel work stays autonomous after connection.
## Information Budget
First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown.
## View Model Contract
Primary user: founder/operator using LastB2B to run autonomous B2B growth per brand
Current decision: ask the brand GPT what to do or connect LinkedIn.
Why now: Leadr is available as a backend capability, but the user needs a simple way to initiate the required LinkedIn login.
Next action: open the brand-scoped GPT panel with a clear prompt.
Top risk: exposing raw tool names, account IDs, or backend channel setup as the default UI.
## Concept Options
1. Header-only operator: keep the existing global Operator button and rely on users to discover it. Lowest code cost, but weak for Leadr login because the brand-level next action is hidden.
2. Brand-home GPT card: add one plain brand-home panel with Ask GPT as the primary action and Connect LinkedIn as the only explicit channel shortcut. It opens the existing brand-scoped Operator panel so chat, confirmations, and receipts stay centralized.
3. Full embedded chat: place the entire chat transcript directly in brand home. Most visible, but it turns the brand page into a dashboard and competes with mission setup/profile editing.

## Concept Winner
Concept 2 wins. It makes the per-brand GPT obvious, gives Leadr login a human-readable entry point, and reuses the existing Operator panel instead of adding a second chat surface.

## Decisions
- Scope: Optimize for one obvious per-brand action: ask GPT / connect required channel. Start with smallest coherent slice that proves Add a simple per-brand GPT chatbox/operator surface so users can ask the brand agent what to do next and initiate channel actions like Leadr LinkedIn login without seeing raw internal tool plumbing.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
- Primary Action: founder/operator using LastB2B to run autonomous B2B growth per brand should be able to Add a simple per-brand GPT chatbox/operator surface so users can ask the brand agent what to do next and initiate channel actions like Leadr LinkedIn login without seeing raw internal tool plumbing. with one obvious first move. (source: agent_assumption; why: Autopilot inferred default for primary_action from request, audience, optimization target, and mode.)
- Primary Risk: founder/operator using LastB2B to run autonomous B2B growth per brand should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for primary_risk from request, audience, optimization target, and mode.)
- Information Budget: First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown. (source: agent_assumption; why: Autopilot inferred default for information_budget from request, audience, optimization target, and mode.)
- View Model Contract: Primary user: founder/operator using LastB2B to run autonomous B2B growth per brand
Current decision: Add a simple per-brand GPT chatbox/operator surface so users can ask the brand agent what to do next and initiate channel actions like Leadr LinkedIn login without seeing raw internal tool plumbing.
Why now: founder/operator using LastB2B to run autonomous B2B growth per brand needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: founder/operator using LastB2B to run autonomous B2B growth per brand should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for view_model_contract from request, audience, optimization target, and mode.)
## Open Questions
None for the first slice.

## Design Notes
Default brand home should show one GPT-focused entry point. Raw tool names stay hidden by default; execution cards show human intent, target, status, receipts, and links. Internal tool names can remain available only in secondary detail if needed for debugging.

## Implementation Notes
Pending implementation.
- 2026-05-22 Implementation summary: Added a simple per-brand GPT entry path on brand home. Ask GPT and Connect LinkedIn dispatch a brand-scoped operator open request, AppShell forwards that request into the existing Operator panel, and the panel can prefill/auto-send the requested prompt. Operator receipts now render action details and links, including Leadr sign-in links, while raw tool names are hidden behind a technical-details disclosure.
- Files: /Users/don/lastb2b/src/app/brands/[id]/brand-home-client.tsx, /Users/don/lastb2b/src/components/layout/app-shell.tsx, /Users/don/lastb2b/src/components/operator/operator-panel.tsx, /Users/don/lastb2b/docs/uiux/features/per-brand-gpt-operator-chat.md
- Components: BrandHomeClient, AppShell, OperatorPanel, ExecutionCard
- Assumptions used: Leadr login is a human OAuth step, so the UI should create/open the sign-in link instead of pretending the agent can log in by itself., The existing Operator panel remains the single chat surface; brand home only provides obvious entry points.
## Doc Sync
- 2026-05-22 Synced after implementation.
- States touched: loading, error, partial
- Code touched: /Users/don/lastb2b/src/app/brands/[id]/brand-home-client.tsx, /Users/don/lastb2b/src/components/layout/app-shell.tsx, /Users/don/lastb2b/src/components/operator/operator-panel.tsx, /Users/don/lastb2b/docs/uiux/features/per-brand-gpt-operator-chat.md
