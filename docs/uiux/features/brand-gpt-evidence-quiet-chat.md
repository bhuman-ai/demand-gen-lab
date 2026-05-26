# Feature: brand-gpt-evidence-quiet-chat

## Request
[TODO] Paste or summarize request.
## Autonomy Mode
guided
## Target Users
Primary end user affected by this request
## Optimization Target
Fastest clear MVP with lowest avoidable complexity
## Hard Constraints
[TODO] List hard constraints, non-negotiables, or compliance needs.

## Scope
Quiet the Brand GPT evidence UI in the chat transcript. Replace the large full-width green Evidence bars with a subtle compact disclosure under assistant messages. Do not remove evidence data, tool traces, or verification behavior.
## Touched Surfaces
- brand-gpt-evidence-quiet-chat
- currently referenced UI surface
## Success Moment
A user reads a Brand GPT answer without the evidence UI stealing attention; evidence is still available as a small secondary control when they want to inspect proof.
## Failure Policy
If evidence data is missing or malformed, hide the evidence disclosure rather than rendering broken chrome; the assistant answer remains readable.
## Primary Action
[TODO] Define the one action or decision that must feel obvious first.

## Primary Risk
[TODO] Define the main confusion, trust, or failure risk.

## Information Budget
[TODO] Define what earns the first screen and what stays hidden until asked.

## View Model Contract
[TODO] Record primary user, current decision, why now, next action, and top risk.

## Concept Options
[TODO] Capture at least three structural concepts or ASCII wireframe directions.

## Concept Winner
[TODO] Record the chosen concept and why it beats the alternatives.

## Decisions
- Scope: Quiet the Brand GPT evidence UI in the chat transcript. Replace the large full-width green Evidence bars with a subtle compact disclosure under assistant messages. Do not remove evidence data, tool traces, or verification behavior. (source: agent_assumption; why: The screenshot shows the evidence chrome visually overpowering the answer and composer, which conflicts with the chat-first product grammar.)
- Success Moment: A user reads a Brand GPT answer without the evidence UI stealing attention; evidence is still available as a small secondary control when they want to inspect proof. (source: agent_assumption; why: The primary job is conversation first, audit detail second.)
- Failure Policy: If evidence data is missing or malformed, hide the evidence disclosure rather than rendering broken chrome; the assistant answer remains readable. (source: agent_assumption; why: Evidence is supporting detail and should never break or dominate the main chat.)
- Raw agent context (2026-05-26): User objected to the Brand GPT chat screenshot where full-width green Evidence rows dominate the transcript. Treat this as a focused UI cleanup: evidence should remain available but hidden/quiet by default so the chat reads like a normal conversation.
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-05-26 Implementation summary: Quieted Brand GPT evidence rendering so proof is a small secondary disclosure instead of a full-width colored banner. Kept evidence data and trace details accessible behind the disclosure. Tightened Brand GPT final-answer instructions so it avoids dead status-report language and chooses an available safe action when it discovers nothing is moving.
- Files: src/components/operator/operator-panel.tsx, src/lib/brand-agent-runtime.ts, docs/uiux/features/brand-gpt-evidence-quiet-chat.md
- Components: OperatorPanel, EvidenceTrace, Brand GPT runtime prompt
- Assumptions used: The screenshot objection was caused by evidence chrome visually overpowering the chat transcript., Evidence should remain inspectable for trust but should not be a primary visual object in normal conversation., When Brand GPT finds zero movement, it should either move the account forward with tools or name the exact blocker instead of ending on a dead report.
## Doc Sync
- 2026-05-26 Synced after implementation.
- Code touched: src/components/operator/operator-panel.tsx, src/lib/brand-agent-runtime.ts, docs/uiux/features/brand-gpt-evidence-quiet-chat.md
