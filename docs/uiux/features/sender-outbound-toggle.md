# Feature: sender-outbound-toggle

## Request
Add a per-sender switch to turn real outbound sending on/off, default all senders outbound-off now, and then audit whether any warmup-only problems remain.
## Autonomy Mode
holistic_autopilot
## Target Users
Founder/operator managing sender safety
## Optimization Target
Operator can stop real outbound per sender while warmup continues; default all outbound off for safety.
## Hard Constraints
- Do not disable warmup when outbound is off.
- Outbound-off must block real outbound dispatch/preflight
- not just hide UI.
- Use existing sender/account patterns and minimal UI complexity.
## Scope
Optimize for Operator can stop real outbound per sender while warmup continues; default all outbound off for safety.. Start with smallest coherent slice that proves Add a per-sender switch to turn real outbound sending on/off, default all senders outbound-off now, and then audit whether any warmup-only problems remain..
## Touched Surfaces
- settings/outreach sender management
- brand network senders
- outreach dispatch runtime
## Success Moment
[TODO] Define exact user outcome that proves this feature works.

## Failure Policy
[TODO] Describe recovery path on failure.

## Primary Action
Founder/operator managing sender safety should be able to Add a per-sender switch to turn real outbound sending on/off, default all senders outbound-off now, and then audit whether any warmup-only problems remain. with one obvious first move.
## Primary Risk
Founder/operator managing sender safety should not have to guess what matters first or what can go wrong.
## Information Budget
First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown.
## View Model Contract
Primary user: Founder/operator managing sender safety
Current decision: Add a per-sender switch to turn real outbound sending on/off, default all senders outbound-off now, and then audit whether any warmup-only problems remain.
Why now: Founder/operator managing sender safety needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: Founder/operator managing sender safety should not have to guess what matters first or what can go wrong.
## Concept Options
1. Sender-row switch: add one outbound on/off control directly on each sender row. Warmup state remains visible and unaffected. Lowest operator load and clearest safety control.
2. Global outbound pause: add one page-level pause all control only. Fast to operate, but does not satisfy per-sender control and hides which sender is safe.
3. Campaign-level outbound pause: pause outbound in campaign/run settings. Useful later, but too far from sender health and does not protect all dispatch entry points.

Chosen direction should keep the control at sender/account level and enforce it in dispatch/preflight, not only in UI.
## Concept Winner
Use the sender-row switch.

Primary action: operator can switch outbound on/off for a single sender from the sender list.
Primary risk: real outbound must not send from a paused sender through any backend path.
Information budget: row shows the switch plus short status copy only; warmup health stays separate.
View model contract: outboundEnabled=false means this sender is eligible for warmup but ineligible for outbound campaign dispatch/preflight. Missing value defaults false for safety until explicitly enabled.
## Decisions
- Scope: Optimize for Operator can stop real outbound per sender while warmup continues; default all outbound off for safety.. Start with smallest coherent slice that proves Add a per-sender switch to turn real outbound sending on/off, default all senders outbound-off now, and then audit whether any warmup-only problems remain.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
- Primary Action: Founder/operator managing sender safety should be able to Add a per-sender switch to turn real outbound sending on/off, default all senders outbound-off now, and then audit whether any warmup-only problems remain. with one obvious first move. (source: agent_assumption; why: Autopilot inferred default for primary_action from request, audience, optimization target, and mode.)
- Primary Risk: Founder/operator managing sender safety should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for primary_risk from request, audience, optimization target, and mode.)
- Information Budget: First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown. (source: agent_assumption; why: Autopilot inferred default for information_budget from request, audience, optimization target, and mode.)
- View Model Contract: Primary user: Founder/operator managing sender safety
Current decision: Add a per-sender switch to turn real outbound sending on/off, default all senders outbound-off now, and then audit whether any warmup-only problems remain.
Why now: Founder/operator managing sender safety needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: Founder/operator managing sender safety should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for view_model_contract from request, audience, optimization target, and mode.)
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-04-29 Implementation summary: Added per-sender outbound on/off control in Settings > Outreach account inventory and Brand Network sender cards. Stored outbound state in outreach account config with missing values defaulting to off. Runtime now excludes outbound-off senders from real outbound launch/schedule/dispatch while allowing warmup lanes to continue. Live worker was patched and all delivery/hybrid sender accounts were set outbound off.
- Files: src/lib/factory-types.ts, src/lib/outreach-customerio-billing.ts, src/lib/outreach-data.ts, src/lib/outreach-account-helpers.ts, src/lib/outreach-runtime.ts, src/app/settings/outreach/outreach-settings-client.tsx, src/app/brands/[id]/network/network-client.tsx
- Components: AccountInventoryCard, NetworkClient sender cards, outreach runtime sender routing
- Assumptions used: Outbound-off should block real outbound only; warmup is still allowed for technically ready senders., Missing outbound config defaults to false for safety.
## Doc Sync
- 2026-04-29 Synced after implementation.
- States touched: partial
- Code touched: src/lib/factory-types.ts, src/lib/outreach-customerio-billing.ts, src/lib/outreach-data.ts, src/lib/outreach-account-helpers.ts, src/lib/outreach-runtime.ts, src/app/settings/outreach/outreach-settings-client.tsx, src/app/brands/[id]/network/network-client.tsx
