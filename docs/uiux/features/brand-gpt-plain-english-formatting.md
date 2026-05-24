# Feature: brand-gpt-plain-english-formatting

## Request
Make Brand GPT answer in plainer English with better formatting. It should sound like an operator explaining the situation to a founder: short bottom line first, simple words, bullets when useful, clear next action, and details/evidence after the read. The chat should render basic formatting instead of raw-looking paragraphs.
## Autonomy Mode
holistic_autopilot
## Target Users
Founder/operator using Brand GPT to understand what is happening and what should happen next
## Optimization Target
Make Brand GPT responses quicker to understand and more useful at a glance without losing evidence or operational accuracy.
## Hard Constraints
- Plain English first
- Short bottom-line answer before details
- Use bullets/section labels for scanability
- Keep evidence/tool details available but secondary
- Do not reduce factual rigor
- Reuse existing LastB2B tokens and components
## Scope
Optimize for Make Brand GPT responses quicker to understand and more useful at a glance without losing evidence or operational accuracy.. Start with smallest coherent slice that proves Brand GPT answer in plainer English with better formatting. It should sound like an operator explaining the situation to a founder: short bottom line first, simple words, bullets when useful, clear next action, and details/evidence after the read. The chat should render basic formatting instead of raw-looking paragraphs..
## Touched Surfaces
- Brand GPT response style
- Brand GPT message rendering
## Success Moment
A user asks a normal status question and sees a short, founder-facing answer with a clear bottom line, bullets where useful, a next move, and no exposed run/model metadata in the main transcript.

## Failure Policy
If Brand GPT starts sounding like an internal ops report again, adjust the answer contract first and keep evidence in the existing disclosure instead of adding more visible dashboard chrome.

## Primary Action
Founder/operator using Brand GPT to understand what is happening and what should happen next should be able to Brand GPT answer in plainer English with better formatting. It should sound like an operator explaining the situation to a founder: short bottom line first, simple words, bullets when useful, clear next action, and details/evidence after the read. The chat should render basic formatting instead of raw-looking paragraphs. with one obvious first move.
## Primary Risk
Default view overwhelms the user with system detail instead of making the next decision obvious.
## Information Budget
First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown.
## View Model Contract
Primary user: Founder/operator using Brand GPT to understand what is happening and what should happen next
Current decision: Brand GPT answer in plainer English with better formatting. It should sound like an operator explaining the situation to a founder: short bottom line first, simple words, bullets when useful, clear next action, and details/evidence after the read. The chat should render basic formatting instead of raw-looking paragraphs.
Why now: Founder/operator using Brand GPT to understand what is happening and what should happen next needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: Default view overwhelms the user with system detail instead of making the next decision obvious.
## Concept Options
1. Response contract plus lightweight Markdown rendering: Update Brand GPT's system instructions so answers start with a plain-English bottom line, then short bullets for what matters and what happens next. Render basic Markdown in assistant messages using local React code and existing tokens. Evidence stays available in the existing disclosure. This improves both voice and scanability without adding a new UI surface.
2. UI-only formatting: Add cards/chips around the existing text. Rejected because the problem is mostly voice and answer structure, and more chrome would make the chat less ChatGPT-like.
3. Prompt-only voice change: Ask the model to use bullets, but keep rendering as plain pre-wrapped text. Rejected because formatting would still look weak and Markdown markers could show raw if the model uses them.
## Concept Winner
Response contract plus lightweight Markdown rendering wins. Brand GPT should answer like a human operator talking to a founder: lead with the bottom line, use plain words, avoid internal-status dumps, use bullets only where they help scanning, and end with the next useful move. The UI should render simple Markdown for assistant prose while preserving the existing evidence disclosure for tool details.
## Decisions
- Scope: Optimize for Make Brand GPT responses quicker to understand and more useful at a glance without losing evidence or operational accuracy.. Start with smallest coherent slice that proves Brand GPT answer in plainer English with better formatting. It should sound like an operator explaining the situation to a founder: short bottom line first, simple words, bullets when useful, clear next action, and details/evidence after the read. The chat should render basic formatting instead of raw-looking paragraphs.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
- Primary Action: Founder/operator using Brand GPT to understand what is happening and what should happen next should be able to Brand GPT answer in plainer English with better formatting. It should sound like an operator explaining the situation to a founder: short bottom line first, simple words, bullets when useful, clear next action, and details/evidence after the read. The chat should render basic formatting instead of raw-looking paragraphs. with one obvious first move. (source: agent_assumption; why: Autopilot inferred default for primary_action from request, audience, optimization target, and mode.)
- Primary Risk: Default view overwhelms the user with system detail instead of making the next decision obvious. (source: agent_assumption; why: Autopilot inferred default for primary_risk from request, audience, optimization target, and mode.)
- Information Budget: First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown. (source: agent_assumption; why: Autopilot inferred default for information_budget from request, audience, optimization target, and mode.)
- View Model Contract: Primary user: Founder/operator using Brand GPT to understand what is happening and what should happen next
Current decision: Brand GPT answer in plainer English with better formatting. It should sound like an operator explaining the situation to a founder: short bottom line first, simple words, bullets when useful, clear next action, and details/evidence after the read. The chat should render basic formatting instead of raw-looking paragraphs.
Why now: Founder/operator using Brand GPT to understand what is happening and what should happen next needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: Default view overwhelms the user with system detail instead of making the next decision obvious. (source: agent_assumption; why: Autopilot inferred default for view_model_contract from request, audience, optimization target, and mode.)
## Open Questions
None for this slice.

## Design Notes
The transcript should read like a conversation with a competent operator. Main answer first; tool detail second. Formatting is intentionally lightweight: bold labels, bullets, numbered lists, and inline code only.

## Implementation Notes
- 2026-05-24 Implementation summary: Updated Brand GPT's agent prompt so final answers lead with a plain-English bottom line, use short paragraphs/bullets, translate internal status into founder-facing meaning, and keep tool details in evidence fields. Added a lightweight local Markdown renderer for assistant messages that supports bold labels, bullets, numbered lists, and inline code using existing LastB2B tokens. Hid run/model metadata in inline chat so the transcript reads like an operator conversation instead of an internal log.
- Files: src/lib/brand-agent-runtime.ts, src/components/operator/operator-panel.tsx, docs/uiux/features/brand-gpt-plain-english-formatting.md
- Components: Brand GPT agent prompt, OperatorPanel, FormattedAssistantText
- Assumptions used: Brand GPT should use ChatGPT-style answer hierarchy without copying trade dress: plain prose, simple labels, bullets, and hidden technical metadata., Evidence remains available through the existing disclosure instead of being repeated in the main answer.
## Doc Sync
- 2026-05-24 Synced after implementation.
- States touched: partial
- Code touched: src/lib/brand-agent-runtime.ts, src/components/operator/operator-panel.tsx, docs/uiux/features/brand-gpt-plain-english-formatting.md
