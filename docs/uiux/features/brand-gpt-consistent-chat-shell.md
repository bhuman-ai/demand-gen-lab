# Feature: brand-gpt-consistent-chat-shell

## Request
Apply the new ChatGPT-like sidebar styling across all app pages instead of only the Agent page, and fix Brand GPT chat message rendering so assistant text has no visible bubble/container while user messages use a ChatGPT-like rounded bubble.
## Autonomy Mode
holistic_autopilot
## Target Users
Founder/operator using LastB2B across agent, missions, inbox, leads, and related brand pages
## Optimization Target
Make the chat product shell consistent everywhere and make message rendering match ChatGPT expectations: assistant prose is plain text, user prompts are compact bubbles.
## Hard Constraints
- Use the flat sidebar shell for all routes
- not only the Agent route
- Assistant messages must not render as bordered cards or bubbles in inline chat
- User messages should render as compact rounded bubbles similar to ChatGPT
- Preserve LastB2B branding and existing routes
- Keep mobile Agent route chat-first
## Scope
Optimize for Make the chat product shell consistent everywhere and make message rendering match ChatGPT expectations: assistant prose is plain text, user prompts are compact bubbles.. Start with smallest coherent slice that proves Apply the new ChatGPT-like sidebar styling across all pages instead of only the Agent , and fix Brand GPT chat message rendering so assistant text has no visible bubble/container while user messages use a ChatGPT-like rounded bubble..
## Touched Surfaces
- AppShell sidebar on all pages
- BrandSwitcher in sidebar
- Brand GPT inline chat message list
## Success Moment
A user can switch from Agent to Missions, Inbox, Leads, or secondary pages and still see the same flat ChatGPT-like sidebar. In Brand GPT, assistant replies read like plain document text in the main column, while only the user's prompts appear as rounded bubbles.

## Failure Policy
If the shared shell causes a route-specific regression, keep the global shell structure and patch the route-specific content area instead of restoring an Agent-only sidebar fork.

## Primary Action
Founder/operator using LastB2B across agent, missions, inbox, leads, and related brand pages should be able to Apply the new ChatGPT-like sidebar styling across all pages instead of only the Agent , and fix Brand GPT chat message rendering so assistant text has no visible bubble/container while user messages use a ChatGPT-like rounded bubble. with one obvious first move.
## Primary Risk
Founder/operator using LastB2B across agent, missions, inbox, leads, and related brand pages should not have to guess what matters first or what can go wrong.
## Information Budget
First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown.
## View Model Contract
Primary user: Founder/operator using LastB2B across agent, missions, inbox, leads, and related brand pages
Current decision: Apply the new ChatGPT-like sidebar styling across all pages instead of only the Agent , and fix Brand GPT chat message rendering so assistant text has no visible bubble/container while user messages use a ChatGPT-like rounded bubble.
Why now: Founder/operator using LastB2B across agent, missions, inbox, leads, and related brand pages needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: Founder/operator using LastB2B across agent, missions, inbox, leads, and related brand pages should not have to guess what matters first or what can go wrong.
## Concept Options
1. Global flat shell: Remove the Agent-only branch in AppShell and make the flat ChatGPT-like sidebar the default across all authenticated pages. Keep the Agent route's mobile sidebar hiding, but use the same desktop sidebar width, spacing, compact brand switcher, plain nav rows, and bottom identity row everywhere. For chat, render assistant messages as unboxed prose and user messages as compact rounded muted bubbles. This directly answers both issues.
2. Duplicate style variants: Keep old sidebar for non-Agent pages and add a second flag for new pages. Rejected because it keeps the inconsistency the user called out.
3. Chat-only patch: Fix message bubbles only. Lower blast radius, but leaves the most visible navigation inconsistency unresolved.
## Concept Winner
Global flat shell wins. The sidebar should no longer depend on the Agent route except for mobile visibility. All desktop app pages should share the same flat rail, compact brand selector, plain rows, and bottom workspace identity. The inline Brand GPT transcript should follow ChatGPT-style message hierarchy: assistant output is plain text in the reading column, user prompts are the only visible chat bubbles.
## Decisions
- Scope: Optimize for Make the chat product shell consistent everywhere and make message rendering match ChatGPT expectations: assistant prose is plain text, user prompts are compact bubbles.. Start with smallest coherent slice that proves Apply the new ChatGPT-like sidebar styling across all pages instead of only the Agent , and fix Brand GPT chat message rendering so assistant text has no visible bubble/container while user messages use a ChatGPT-like rounded bubble.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
- Primary Action: Founder/operator using LastB2B across agent, missions, inbox, leads, and related brand pages should be able to Apply the new ChatGPT-like sidebar styling across all pages instead of only the Agent , and fix Brand GPT chat message rendering so assistant text has no visible bubble/container while user messages use a ChatGPT-like rounded bubble. with one obvious first move. (source: agent_assumption; why: Autopilot inferred default for primary_action from request, audience, optimization target, and mode.)
- Primary Risk: Founder/operator using LastB2B across agent, missions, inbox, leads, and related brand pages should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for primary_risk from request, audience, optimization target, and mode.)
- Information Budget: First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown. (source: agent_assumption; why: Autopilot inferred default for information_budget from request, audience, optimization target, and mode.)
- View Model Contract: Primary user: Founder/operator using LastB2B across agent, missions, inbox, leads, and related brand pages
Current decision: Apply the new ChatGPT-like sidebar styling across all pages instead of only the Agent , and fix Brand GPT chat message rendering so assistant text has no visible bubble/container while user messages use a ChatGPT-like rounded bubble.
Why now: Founder/operator using LastB2B across agent, missions, inbox, leads, and related brand pages needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: Founder/operator using LastB2B across agent, missions, inbox, leads, and related brand pages should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for view_model_contract from request, audience, optimization target, and mode.)
## Open Questions
None for this slice.

## Design Notes
Use one global desktop app shell. The sidebar keeps the ChatGPT-like rail structure: simple wordmark row, compact brand selector, plain nav rows, progressive More/System sections, and one workspace identity row at the bottom. The Agent route can still hide the sidebar on mobile so chat remains first.

Inline Brand GPT transcripts should follow a reading-first hierarchy: assistant output is unboxed prose in the central column; user prompts are compact rounded bubbles aligned to the right.

## Implementation Notes
`AppShell` no longer branches into an old non-Agent sidebar style. `OperatorPanel` removes inline assistant message chrome and keeps user-message bubble styling scoped to the inline chat experience.
- 2026-05-24 Implementation summary: Made the flat ChatGPT-like sidebar the shared AppShell sidebar across authenticated pages while preserving the Agent route's mobile chat-first behavior. Updated inline Brand GPT message rendering so assistant/tool output is unboxed prose and user prompts remain compact rounded muted bubbles.
- Files: src/components/layout/app-shell.tsx, src/components/operator/operator-panel.tsx, docs/uiux/features/brand-gpt-consistent-chat-shell.md
- Components: AppShell, BrandSwitcher, OperatorPanel
- Assumptions used: ChatGPT is the reference product grammar for shell and transcript hierarchy, while LastB2B semantic tokens remain the visual source of truth., The Agent route may keep hiding the desktop sidebar on mobile to preserve the chat-first mobile experience.
## Doc Sync
Feature doc updated for the global shell and inline transcript rendering.
- 2026-05-24 Synced after implementation.
- States touched: empty, partial
- Code touched: src/components/layout/app-shell.tsx, src/components/operator/operator-panel.tsx, docs/uiux/features/brand-gpt-consistent-chat-shell.md
