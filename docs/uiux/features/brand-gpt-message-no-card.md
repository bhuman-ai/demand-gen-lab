# Feature: brand-gpt-message-no-card

## Request
Fix Brand GPT chat message rendering because assistant/AI text still appears inside a bordered block. Non-user Brand GPT messages should render as plain text in the chat reading column with no card, no bubble, no border, no rounded wrapper. User messages should keep a ChatGPT-like rounded bubble.
## Autonomy Mode
holistic_autopilot
## Target Users
Founder/operator using Brand GPT as the main marketing agent chat
## Optimization Target
Make the Brand GPT transcript visually match ChatGPT expectations: assistant output is plain prose, user prompts are the only visible bubbles.
## Hard Constraints
- No bordered wrapper around assistant/AI text in inline Brand GPT chat
- User messages keep a compact rounded ChatGPT-like bubble
- Do not change backend agent behavior
- Reuse existing LastB2B semantic tokens
## Scope
Optimize for Make the Brand GPT transcript visually match ChatGPT expectations: assistant output is plain prose, user prompts are the only visible bubbles.. Start with smallest coherent slice that proves Fix Brand GPT chat message rendering because assistant/AI text still appears inside a bordered block. Non-user Brand GPT messages should render as plain text in the chat reading column with no card, no bubble, no border, no rounded wrapper. User messages should keep a ChatGPT-like rounded bubble..
## Touched Surfaces
- Brand GPT inline transcript
- OperatorPanel message renderer
## Success Moment
A user sees Brand GPT responses as plain reading-column text with no visible rectangle, border, background, rounded corners, or extra padding. The user's prompt remains the only rounded chat bubble.

## Failure Policy
If assistant chrome appears again, fix the inline message renderer structure first. Do not rely on later class overrides to hide a generic card wrapper.

## Primary Action
Founder/operator using Brand GPT as the main marketing agent chat should be able to Fix Brand GPT chat message rendering because assistant/AI text still appears inside a bordered block. Non-user Brand GPT messages should render as plain text in the chat reading column with no card, no bubble, no border, no rounded wrapper. User messages should keep a ChatGPT-like rounded bubble. with one obvious first move.
## Primary Risk
Founder/operator using Brand GPT as the main marketing agent chat should not have to guess what matters first or what can go wrong.
## Information Budget
First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown.
## View Model Contract
Primary user: Founder/operator using Brand GPT as the main marketing agent chat
Current decision: Fix Brand GPT chat message rendering because assistant/AI text still appears inside a bordered block. Non-user Brand GPT messages should render as plain text in the chat reading column with no card, no bubble, no border, no rounded wrapper. User messages should keep a ChatGPT-like rounded bubble.
Why now: Founder/operator using Brand GPT as the main marketing agent chat needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: Founder/operator using Brand GPT as the main marketing agent chat should not have to guess what matters first or what can go wrong.
## Concept Options
1. Split inline message rendering by role: In inline Brand GPT mode, render user messages through a compact rounded bubble wrapper and render all non-user messages through a plain prose wrapper with no border, background, radius, or padding. This removes the structural source of the assistant card.
2. Keep one generic message card and override classes harder: Rejected because the current bug proves inherited wrapper chrome can leak through and remain visually wrong.
3. Make assistant border transparent only: Rejected because it still leaves card geometry, padding, and layout shape, which reads as a bubble even if the border disappears.
## Concept Winner
Split inline message rendering by role. The inline transcript should not rely on class overrides to hide assistant card styling. User messages use the only chat bubble. Every non-user inline message uses a plain block in the reading column, with width constrained by the transcript column but no visible wrapper chrome.
## Decisions
- Scope: Optimize for Make the Brand GPT transcript visually match ChatGPT expectations: assistant output is plain prose, user prompts are the only visible bubbles.. Start with smallest coherent slice that proves Fix Brand GPT chat message rendering because assistant/AI text still appears inside a bordered block. Non-user Brand GPT messages should render as plain text in the chat reading column with no card, no bubble, no border, no rounded wrapper. User messages should keep a ChatGPT-like rounded bubble.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
- Primary Action: Founder/operator using Brand GPT as the main marketing agent chat should be able to Fix Brand GPT chat message rendering because assistant/AI text still appears inside a bordered block. Non-user Brand GPT messages should render as plain text in the chat reading column with no card, no bubble, no border, no rounded wrapper. User messages should keep a ChatGPT-like rounded bubble. with one obvious first move. (source: agent_assumption; why: Autopilot inferred default for primary_action from request, audience, optimization target, and mode.)
- Primary Risk: Founder/operator using Brand GPT as the main marketing agent chat should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for primary_risk from request, audience, optimization target, and mode.)
- Information Budget: First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown. (source: agent_assumption; why: Autopilot inferred default for information_budget from request, audience, optimization target, and mode.)
- View Model Contract: Primary user: Founder/operator using Brand GPT as the main marketing agent chat
Current decision: Fix Brand GPT chat message rendering because assistant/AI text still appears inside a bordered block. Non-user Brand GPT messages should render as plain text in the chat reading column with no card, no bubble, no border, no rounded wrapper. User messages should keep a ChatGPT-like rounded bubble.
Why now: Founder/operator using Brand GPT as the main marketing agent chat needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: Founder/operator using Brand GPT as the main marketing agent chat should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for view_model_contract from request, audience, optimization target, and mode.)
## Open Questions
None for this slice.

## Design Notes
Inline Brand GPT transcript rendering is role-specific. User messages are the only bubble. Non-user messages are plain prose blocks in the shared chat width, so the visual hierarchy matches ChatGPT's transcript model.

## Implementation Notes
- 2026-05-24 Implementation summary: Changed inline Brand GPT message rendering from class overrides to role-specific DOM branches. User messages render through a compact rounded bubble. Every non-user inline message renders through a plain prose wrapper with no border, no background, no radius, and no padding, preventing assistant card chrome from leaking through.
- Files: src/components/operator/operator-panel.tsx, docs/uiux/features/brand-gpt-message-no-card.md
- Components: OperatorPanel
- Assumptions used: ChatGPT-style transcript hierarchy means assistant output is prose in the reading column and only user prompts are bubbles., Backend agent behavior and drawer-mode OperatorPanel cards should remain unchanged.
## Doc Sync
- 2026-05-24 Synced after implementation.
- States touched: partial
- Code touched: src/components/operator/operator-panel.tsx, docs/uiux/features/brand-gpt-message-no-card.md
