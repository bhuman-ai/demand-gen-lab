# Feature: brand-gpt-async-agent-runs

## Request
Make Brand GPT chat create real asynchronous agent runs with full tool/progress/evidence visibility instead of thin fallback chatbot answers. The UI should show current task/progress, evidence/action output, and planner degraded state clearly.
## Autonomy Mode
holistic_autopilot
## Target Users
Founder/operator managing autonomous B2B campaign agents
## Optimization Target
decision speed and trustworthy Codex-like agent behavior
## Hard Constraints
- Do not add hardcoded marketing heuristics
- Use existing Brand GPT/operator tool loop and mission runner patterns
- Avoid pretending success when planner is unavailable
- Keep dangerous actions approval-gated
## Scope
Optimize for decision speed and trustworthy Codex-like agent behavior. Start with smallest coherent slice that proves Brand GPT chat create real asynchronous agent runs with full tool/progress/evidence visibility instead of thin fallback chatbot answers. The UI should show current task/progress, evidence/action output, and planner degraded state clearly..
## Touched Surfaces
- Brand GPT chat drawer
- Operator/Brand GPT agent API routes
- mission/agent run state
## Success Moment
[TODO] Define exact user outcome that proves this feature works.

## Failure Policy
[TODO] Describe recovery path on failure.

## Primary Action
Founder/operator managing autonomous B2B campaign agents should be able to Brand GPT chat create real asynchronous agent runs with full tool/progress/evidence visibility instead of thin fallback chatbot answers. The UI should show current task/progress, evidence/action output, and planner degraded state clearly. with one obvious first move.
## Primary Risk
Founder/operator managing autonomous B2B campaign agents should not have to guess what matters first or what can go wrong.
## Information Budget
First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown.
## View Model Contract
Primary user: Founder/operator managing autonomous B2B campaign agents
Current decision: Brand GPT chat create real asynchronous agent runs with full tool/progress/evidence visibility instead of thin fallback chatbot answers. The UI should show current task/progress, evidence/action output, and planner degraded state clearly.
Why now: Founder/operator managing autonomous B2B campaign agents needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: Founder/operator managing autonomous B2B campaign agents should not have to guess what matters first or what can go wrong.
## Concept Options
1. Inline async run card: keep the existing Brand GPT chat as the main surface, but every user request creates a tracked agent run. The current task card shows run status, model, last evidence status, and next action. Assistant answers remain in the conversation with expandable evidence traces. This is closest to Codex: one visible run, one transcript, tool evidence attached to the answer.
2. Separate mission console: route each chat request to a mission-like detail page with a full timeline, decisions, and approvals. Powerful, but too heavy for quick brand questions and adds navigation before trust is restored.
3. Background-only runner feed: chat only enqueues work and a separate activity feed shows results later. This avoids blocking the UI, but it makes the product feel less like a direct intelligent agent and more like a job queue.
## Concept Winner
Inline async run card wins. It reuses the existing OperatorPanel/Brand GPT drawer and evidence trace pattern, but changes the interaction contract from synchronous chatbot answer to tracked agent run. The visible default becomes: current task, run status, model/evidence health, assistant result, and explicit requested action if a write needs approval. This beats the console/page option because the user should not leave the brand context to ask GPT, and it beats the background feed because the user needs Codex-like immediacy and trust.
## Decisions
- Scope: Optimize for decision speed and trustworthy Codex-like agent behavior. Start with smallest coherent slice that proves Brand GPT chat create real asynchronous agent runs with full tool/progress/evidence visibility instead of thin fallback chatbot answers. The UI should show current task/progress, evidence/action output, and planner degraded state clearly.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
- Primary Action: Founder/operator managing autonomous B2B campaign agents should be able to Brand GPT chat create real asynchronous agent runs with full tool/progress/evidence visibility instead of thin fallback chatbot answers. The UI should show current task/progress, evidence/action output, and planner degraded state clearly. with one obvious first move. (source: agent_assumption; why: Autopilot inferred default for primary_action from request, audience, optimization target, and mode.)
- Primary Risk: Founder/operator managing autonomous B2B campaign agents should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for primary_risk from request, audience, optimization target, and mode.)
- Information Budget: First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown. (source: agent_assumption; why: Autopilot inferred default for information_budget from request, audience, optimization target, and mode.)
- View Model Contract: Primary user: Founder/operator managing autonomous B2B campaign agents
Current decision: Brand GPT chat create real asynchronous agent runs with full tool/progress/evidence visibility instead of thin fallback chatbot answers. The UI should show current task/progress, evidence/action output, and planner degraded state clearly.
Why now: Founder/operator managing autonomous B2B campaign agents needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: Founder/operator managing autonomous B2B campaign agents should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for view_model_contract from request, audience, optimization target, and mode.)
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-05-23 Implementation summary: Brand GPT chat now supports a persisted async run flow. User chat can start an Operator run immediately with status running and a queued model, the UI shows that run in the current task card and conversation while a separate process endpoint executes the existing Brand GPT/Operator tool loop against the same run, and completed assistant messages include run metadata plus existing evidence traces. Thread detail now includes operator runs. Planner unavailable now marks the run/execution as failed instead of a fake completed answer.
- Files: src/lib/operator-types.ts, src/lib/operator-data.ts, src/lib/operator-runtime.ts, src/lib/client-api.ts, src/app/api/operator/chat/route.ts, src/app/api/operator/runs/[runId]/process/route.ts, src/components/operator/operator-panel.tsx, docs/uiux/features/brand-gpt-async-agent-runs.md
- Components: OperatorPanel, Brand GPT chat drawer, Operator chat runtime, Operator chat API
- Assumptions used: Inline async run card is the smallest coherent Codex-like visibility improvement without creating a separate console., Dangerous writes remain behind existing Operator approval gates., Planner-unavailable should be represented as degraded/failed run state so users do not mistake fallback text for intelligence.
## Doc Sync
- 2026-05-23 Synced after implementation.
- States touched: loading, error, partial
- Code touched: src/lib/operator-types.ts, src/lib/operator-data.ts, src/lib/operator-runtime.ts, src/lib/client-api.ts, src/app/api/operator/chat/route.ts, src/app/api/operator/runs/[runId]/process/route.ts, src/components/operator/operator-panel.tsx, docs/uiux/features/brand-gpt-async-agent-runs.md
