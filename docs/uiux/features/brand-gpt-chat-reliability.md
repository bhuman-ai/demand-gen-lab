# Feature: brand-gpt-chat-reliability

## Request
Fix Brand GPT chat still showing useless planner failure and polluted old conversation; make talking with Brand GPT actually work for live account questions and actions such as connecting LinkedIn.
## Autonomy Mode
holistic_autopilot
## Target Users
Founder/operator managing brand growth
## Optimization Target
trustworthy live agent behavior with clear recovery from stale failed threads
## Hard Constraints
[TODO] List hard constraints, non-negotiables, or compliance needs.

## Scope
Optimize for trustworthy live agent behavior with clear recovery from stale failed threads. Start with smallest coherent slice that proves Fix Brand GPT chat still showing useless planner failure and polluted old conversation; make talking with Brand GPT actually work for live account questions and actions such as connecting LinkedIn..
## Touched Surfaces
- Brand GPT side panel
- /api/operator/chat
- operator thread loading
## Success Moment
Founder/operator managing brand growth completes Fix Brand GPT chat still showing useless planner failure and polluted old conversation; make talking with Brand GPT actually work for live account questions and actions such as connecting LinkedIn. and sees explicit confirmation of successful outcome.
## Failure Policy
[TODO] Describe recovery path on failure.

## Primary Action
Founder/operator managing brand growth should be able to Fix Brand GPT chat still showing useless planner failure and polluted old conversation; make talking with Brand GPT actually work for live account questions and actions such as connecting LinkedIn. with one obvious first move.
## Primary Risk
User loses trust if the surface hides status, recovery, or progress.
## Information Budget
First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown.
## View Model Contract
Primary user: Founder/operator managing brand growth
Current decision: Fix Brand GPT chat still showing useless planner failure and polluted old conversation; make talking with Brand GPT actually work for live account questions and actions such as connecting LinkedIn.
Why now: Founder/operator managing brand growth needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: User loses trust if the surface hides status, recovery, or progress.
## Concept Options
Option A: lifecycle integrity fix. Never send into archived or wrong-brand threads; backend creates a fresh active thread when a stale archived thread ID is supplied; UI only reuses active current-brand threads and clears stale panel state. Option B: hide old planner-failure messages in the UI. Option C: add a manual new-chat control and leave backend behavior alone.
## Concept Winner
Option A: lifecycle integrity fix across UI send path and backend thread resolution.
## Decisions
- Primary Action: Founder/operator managing brand growth should be able to Fix Brand GPT chat still showing useless planner failure and polluted old conversation; make talking with Brand GPT actually work for live account questions and actions such as connecting LinkedIn. with one obvious first move. (source: agent_assumption; why: Autopilot inferred default for primary_action from request, audience, optimization target, and mode.)
- Primary Risk: User loses trust if the surface hides status, recovery, or progress. (source: agent_assumption; why: Autopilot inferred default for primary_risk from request, audience, optimization target, and mode.)
- Information Budget: First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown. (source: agent_assumption; why: Autopilot inferred default for information_budget from request, audience, optimization target, and mode.)
- View Model Contract: Primary user: Founder/operator managing brand growth
Current decision: Fix Brand GPT chat still showing useless planner failure and polluted old conversation; make talking with Brand GPT actually work for live account questions and actions such as connecting LinkedIn.
Why now: Founder/operator managing brand growth needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: User loses trust if the surface hides status, recovery, or progress. (source: agent_assumption; why: Autopilot inferred default for view_model_contract from request, audience, optimization target, and mode.)
- Scope: Optimize for trustworthy live agent behavior with clear recovery from stale failed threads. Start with smallest coherent slice that proves Fix Brand GPT chat still showing useless planner failure and polluted old conversation; make talking with Brand GPT actually work for live account questions and actions such as connecting LinkedIn.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
- Success Moment: Founder/operator managing brand growth completes Fix Brand GPT chat still showing useless planner failure and polluted old conversation; make talking with Brand GPT actually work for live account questions and actions such as connecting LinkedIn. and sees explicit confirmation of successful outcome. (source: agent_assumption; why: Autopilot inferred default for success_moment from request, audience, optimization target, and mode.)
- Concept Options: Option A: lifecycle integrity fix. Never send into archived or wrong-brand threads; backend creates a fresh active thread when a stale archived thread ID is supplied; UI only reuses active current-brand threads and clears stale panel state. Option B: hide old planner-failure messages in the UI. Option C: add a manual new-chat control and leave backend behavior alone. (source: agent_assumption; why: The observed failure is stale archived thread reuse. Hiding messages would mask the cause, and a manual button leaves the trap in place.)
- Concept Winner: Option A: lifecycle integrity fix across UI send path and backend thread resolution. (source: agent_assumption; why: Smallest robust fix: archived threads become read-only history, new requests attach to a valid active brand thread or start fresh. This prevents polluted archived threads from continuing and makes future sends recover automatically.)
- Raw agent context (2026-05-23): Emergency Brand GPT chat reliability fix after screenshot showed archived polluted thread still being used for new messages.
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-05-23 Implementation summary: Fixed Brand GPT stale-thread behavior by treating archived or wrong-brand threads as read-only. The backend now creates a fresh active thread when a stale threadId is supplied, and the side panel clears stale detail while loading and only sends into active current-brand threads.
- Files: /Users/don/lastb2b/src/lib/operator-runtime.ts, /Users/don/lastb2b/src/components/operator/operator-panel.tsx
- Components: Brand GPT operator panel, operator chat runtime
- Assumptions used: Archived Brand GPT threads should be read-only history., If a panel has stale archived state, the next send should recover by creating a new active thread instead of failing or appending to archived history.
## Doc Sync
- 2026-05-23 Synced after implementation.
- States touched: loading, partial
- Code touched: /Users/don/lastb2b/src/lib/operator-runtime.ts, /Users/don/lastb2b/src/components/operator/operator-panel.tsx
