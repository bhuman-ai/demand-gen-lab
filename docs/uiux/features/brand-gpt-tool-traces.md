# Feature: brand-gpt-tool-traces

## Request
Show Brand GPT tool traces in the chat UI, add evidence self-check behavior before final answers, and strengthen Gmail tool descriptions so the agent treats broad search as discovery and exact sent verification as proof without hardcoded canned flows.
## Autonomy Mode
holistic_autopilot
## Target Users
Founder/operator using LastB2B to supervise autonomous B2B outreach
## Optimization Target
Make Brand GPT feel Codex-like by exposing tool calls and evidence while preserving a general agentic tool loop.
## Hard Constraints
- Do not expose credentials, raw API secrets, or full sensitive payloads in the default chat UI.
- Preserve the general agent tool loop; do not script a fixed canned reply flow for specific questions.
- Keep write actions behind existing approval and permission gates.

## Scope
Optimize for Make Brand GPT feel Codex-like by exposing tool calls and evidence while preserving a general agentic tool loop.. Start with smallest coherent slice that proves Show Brand GPT tool traces in the chat UI, add evidence self-check behavior before final answers, and strengthen Gmail tool descriptions so the agent treats broad search as discovery and exact sent verification as proof without hardcoded canned flows..
## Touched Surfaces
- Brand GPT chat panel
- Operator chat runtime
## Success Moment
After asking a live-evidence question, the operator can see which tools Brand GPT called, what each observed, and whether the final answer's evidence is verified, inconclusive, or insufficient.
## Failure Policy
If the agent lacks exact proof, it must say what was checked, what it proves, and what remains unproven rather than stretching broad evidence into a claim.
## Primary Action
Founder/operator using LastB2B to supervise autonomous B2B outreach should be able to Show Brand GPT tool traces in the chat UI, add evidence self-check behavior before final answers, and strengthen Gmail tool descriptions so the agent treats broad search as discovery and exact sent verification as proof without hardcoded canned flows. with one obvious first move.
## Primary Risk
Founder/operator using LastB2B to supervise autonomous B2B outreach should not have to guess what matters first or what can go wrong.
## Information Budget
First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown.
## View Model Contract
Primary user: Founder/operator using LastB2B to supervise autonomous B2B outreach
Current decision: Show Brand GPT tool traces in the chat UI, add evidence self-check behavior before final answers, and strengthen Gmail tool descriptions so the agent treats broad search as discovery and exact sent verification as proof without hardcoded canned flows.
Why now: Founder/operator using LastB2B to supervise autonomous B2B outreach needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: Founder/operator using LastB2B to supervise autonomous B2B outreach should not have to guess what matters first or what can go wrong.
## Concept Options
Inline evidence trace under each assistant answer: compact summary is visible, detailed tool rows expand only when needed., Persistent side audit rail: separate panel lists every tool call in the thread with raw payload snippets., Task-card trace only: current task card shows latest tool call and evidence status while older evidence stays in message history.
## Concept Winner
Inline evidence trace under each assistant answer. Show a compact Evidence line with tool count and self-check status, then expandable rows for each tool call: tool name, rationale, input summary, result summary, and error. Keep raw payloads out of the default view to avoid clutter and secrets.
## Decisions
- Scope: Optimize for Make Brand GPT feel Codex-like by exposing tool calls and evidence while preserving a general agentic tool loop.. Start with smallest coherent slice that proves Show Brand GPT tool traces in the chat UI, add evidence self-check behavior before final answers, and strengthen Gmail tool descriptions so the agent treats broad search as discovery and exact sent verification as proof without hardcoded canned flows.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
- Primary Action: Founder/operator using LastB2B to supervise autonomous B2B outreach should be able to Show Brand GPT tool traces in the chat UI, add evidence self-check behavior before final answers, and strengthen Gmail tool descriptions so the agent treats broad search as discovery and exact sent verification as proof without hardcoded canned flows. with one obvious first move. (source: agent_assumption; why: Autopilot inferred default for primary_action from request, audience, optimization target, and mode.)
- Primary Risk: Founder/operator using LastB2B to supervise autonomous B2B outreach should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for primary_risk from request, audience, optimization target, and mode.)
- Information Budget: First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown. (source: agent_assumption; why: Autopilot inferred default for information_budget from request, audience, optimization target, and mode.)
- View Model Contract: Primary user: Founder/operator using LastB2B to supervise autonomous B2B outreach
Current decision: Show Brand GPT tool traces in the chat UI, add evidence self-check behavior before final answers, and strengthen Gmail tool descriptions so the agent treats broad search as discovery and exact sent verification as proof without hardcoded canned flows.
Why now: Founder/operator using LastB2B to supervise autonomous B2B outreach needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: Founder/operator using LastB2B to supervise autonomous B2B outreach should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for view_model_contract from request, audience, optimization target, and mode.)
- Concept Options: Inline evidence trace under each assistant answer: compact summary is visible, detailed tool rows expand only when needed., Persistent side audit rail: separate panel lists every tool call in the thread with raw payload snippets., Task-card trace only: current task card shows latest tool call and evidence status while older evidence stays in message history. (source: agent_assumption; why: The user wants Codex-like visibility without turning Brand GPT into another dashboard. Inline trace keeps evidence attached to the answer it supports.)
- Concept Winner: Inline evidence trace under each assistant answer. Show a compact Evidence line with tool count and self-check status, then expandable rows for each tool call: tool name, rationale, input summary, result summary, and error. Keep raw payloads out of the default view to avoid clutter and secrets. (source: agent_assumption; why: Best balance of decision speed and trust. It mirrors Codex's visible tool loop while preserving the existing chat-first Brand GPT surface.)
- Success Moment: After asking a live-evidence question, the operator can see which tools Brand GPT called, what each observed, and whether the final answer's evidence is verified, inconclusive, or insufficient. (source: agent_assumption; why: This directly answers the user's complaint that the agent feels hardcoded and opaque.)
- Failure Policy: If the agent lacks exact proof, it must say what was checked, what it proves, and what remains unproven rather than stretching broad evidence into a claim. (source: agent_assumption; why: Prevents the broad Sent Mail search problem without scripting a fixed Gmail flow.)
- Raw agent context (2026-05-23): Concept packet for Brand GPT tool traces before implementation.
## Open Questions
None for this slice.

## Design Notes
- Evidence is attached inline to the assistant answer it supports.
- The collapsed summary shows evidence status and tool count; detailed rows stay behind the disclosure.
- Tool inputs and results are summarized for operator trust without dumping raw internal payloads.

## Implementation Notes
- 2026-05-23 Implementation summary: Brand GPT assistant messages now persist a compact evidence trace and evidence self-check from the agent loop. The chat panel renders an inline expandable Evidence section under each assistant answer with status, tool count, rationale, input summary, result summary, and errors. The Brand GPT prompt now requires evidenceStatus/evidenceSummary/evidenceGaps on final answers and distinguishes broad Gmail search as discovery from exact Sent Mail verification as proof. Gmail UI tool descriptions in both the operator tool registry and growth tool registry were tightened accordingly.
- Files: src/lib/brand-agent-runtime.ts, src/lib/operator-runtime.ts, src/lib/operator-types.ts, src/lib/operator-tools.ts, src/lib/growth-tool-registry.ts, src/components/operator/operator-panel.tsx, docs/uiux/features/brand-gpt-tool-traces.md
- Components: Brand GPT chat panel, Operator chat runtime, Brand agent planner prompt, Gmail UI operator tools
- Assumptions used: Inline evidence trace is the smallest coherent Codex-like visibility improvement without adding a separate audit dashboard., Raw tool payloads should stay summarized in the default UI to reduce clutter and avoid exposing secrets., Exact Gmail sent-message claims require verify-sent evidence, while mailbox search remains discovery evidence only.
## Doc Sync
- 2026-05-23 Synced after implementation.
- States touched: partial
- Code touched: src/lib/brand-agent-runtime.ts, src/lib/operator-runtime.ts, src/lib/operator-types.ts, src/lib/operator-tools.ts, src/lib/growth-tool-registry.ts, src/components/operator/operator-panel.tsx, docs/uiux/features/brand-gpt-tool-traces.md
