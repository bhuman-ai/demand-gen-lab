# Feature: ai-mission-autopilot-go

## Request
Make LastB2B work as a site + target customers + Go autopilot. User should not have to manually review a generated plan or configure experiments/targeting/deliverability. Implement production-safe first version: one primary Go action, hidden advanced review/editing, autopilot mission creation/start backend, deliverability/start guardrails, no silent local fallback in production.
## Autonomy Mode
holistic_autopilot
## Target Users
Founder/operator who wants AI to run outbound campaigns safely with minimal setup.
## Optimization Target
One obvious Go action with safe autonomous progress through plan, deliverability, launch, monitoring, and learning.
## Hard Constraints
- Do not trigger real sending during implementation verification.
- Keep user-facing UI simple: website, target customers, Go.
- Keep advanced review/editing hidden from the default path.
- Do not silently persist mission data to local JSON in production.
- Use existing design tokens/components.
- Respect deliverability gates before any sending.
## Scope
Smallest coherent slice: one-step mission setup, autopilot mission creation/start backend, deliverability/start guardrails, mission tick resume, and production-safe persistence behavior.
## Touched Surfaces
- brand missions page
- mission detail page
- mission creation API
- mission start/orchestrator
- mission tick/learning loop
- mission persistence
## Success Moment
The founder enters a website and target customer description, clicks Go once, and lands on a mission page that shows the AI is either preparing deliverability, sourcing/launching the first safe batch, or blocked on one clear operational issue. No experiment, targeting, sender, or deliverability setup is required in the default path.
## Failure Policy
If AI planning fails, keep the website and target input in place and show a retryable error. If Supabase persistence is missing in production, fail loudly instead of writing local JSON. If deliverability, sender readiness, warmup, or inbox placement is not ready, the mission remains visible and stops before sending with one blocker and the next autonomous preparation step. Verification must not trigger real sending.
## Primary Action
Go. One click should generate the mission plan, approve the first safe batch under default guardrails, check deliverability, and move the mission into the next runnable or blocked state.
## Primary Risk
The product could appear autonomous while still silently stopping at plan review, or worse, it could send before sender/domain health is ready. The first version must remove the manual review stop but keep deliverability as a hard launch gate.
## Information Budget
Default setup screen shows only website, target customers, one short safety line, and Go. The generated plan, deliverability details, learning rules, experiment IDs, sender setup, and audit receipts stay behind explicit details or the mission page.
## View Model Contract
Primary user: founder/operator.
Current decision: provide the minimum input needed for AI to run outbound safely.
Why now: they want LastB2B to do the work rather than expose experiments, targeting, and sender setup.
Next action: click Go.
Top risk: autonomous launch must still stop before weak deliverability or unsafe targeting.
## Concept Options
### Option 1: One-Step Autopilot
- Website + target customers + Go.
- Backend generates the plan and immediately calls mission start with generated guardrails.
- If deliverability is not ready, the mission page shows the blocker and the operator continues preparing on ticks.
- Best match for the user's stated product direction.

### Option 2: Two-Step Review With Auto-Start Toggle
- Keep Generate plan and Start campaign, but add an Autostart checkbox.
- Safer migration, but still teaches the user that setup is their job.

### Option 3: Operator Console
- Expose strategy, deliverability, sourcing, inbox, and learning agents as separate cards.
- Useful internally, but too much visible machinery for the default founder/operator job.
## Concept Winner
One-Step Autopilot wins. It is the only option that makes the default product behavior match the promise: enter the site, describe the customers, press Go, and let the system progress. Safety moves from visible manual review into backend guardrails: first-batch limits, approval policy defaults, deliverability inspection, sender readiness checks, and a blocked state before any sending if readiness is weak. Advanced review/editing remains available behind details, but it is no longer the default path.
## Decisions
- Go is the default primary action.
- The generated GPT plan becomes the approved first-batch plan under conservative default guardrails.
- Deliverability readiness is a hard launch gate; every non-ready stage blocks sending.
- The internal experiment/outreach runtime remains the execution engine.
- Mission ticks must be able to resume blocked autopilot missions after sender readiness changes.
- Deployed mission persistence must fail loudly when Supabase storage is unavailable.
## Open Questions
Whether a later version should expose a hidden "review before launch" preference for accounts that need stricter compliance approval.

## Design Notes
- Default setup uses one panel, two fields, and one button.
- Recent missions remain visible as recovery/context, not as competing setup choices.
- Mission detail remains the place for rationale, risk, deliverability, metrics, and receipts.

## Implementation Notes
- 2026-05-16 Implementation summary: Implemented One-Step Autopilot for AI missions. The missions screen now exposes website, target customers, and a single Go action. The mission creation API accepts autopilot=true, generates the GPT plan, auto-approves the first guarded batch, invokes startMission, and returns the active/blocked mission. Mission start now treats every non-ready deliverability stage as blocking, compiles/reuses the internal runtime, and a mission autopilot tick can resume deliverability-blocked missions once readiness becomes ready. Production mission persistence now reads Supabase env dynamically and fails loudly instead of falling back to local JSON when deployed storage is missing.
- Files: /tmp/lastb2b-mission-operator-live/src/lib/supabase-admin.ts, /tmp/lastb2b-mission-operator-live/src/lib/mission-data.ts, /tmp/lastb2b-mission-operator-live/src/app/api/brands/[brandId]/missions/route.ts, /tmp/lastb2b-mission-operator-live/src/lib/mission-orchestrator.ts, /tmp/lastb2b-mission-operator-live/src/app/api/internal/missions/tick/route.ts, /tmp/lastb2b-mission-operator-live/src/app/api/internal/outreach/tick/route.ts, /tmp/lastb2b-mission-operator-live/src/lib/client-api.ts, /tmp/lastb2b-mission-operator-live/src/app/brands/[id]/missions/missions-client.tsx, /tmp/lastb2b-mission-operator-live/src/app/brands/[id]/missions/[missionId]/mission-detail-client.tsx, /tmp/lastb2b-mission-operator-live/docs/uiux/features/ai-mission-autopilot-go.md
- Components: Mission setup page, Mission detail page, Mission creation API, Mission orchestrator, Mission tick, Mission persistence
- Assumptions used: Autopilot should be the default UI path, with review/editing no longer required before the first guarded batch., Deliverability is a hard launch gate: any non-ready stage blocks sending., Verification should not click Go or trigger real sending.
## Doc Sync
- 2026-05-16 Synced after implementation.
- States touched: loading, error, partial
- Code touched: /tmp/lastb2b-mission-operator-live/src/lib/supabase-admin.ts, /tmp/lastb2b-mission-operator-live/src/lib/mission-data.ts, /tmp/lastb2b-mission-operator-live/src/app/api/brands/[brandId]/missions/route.ts, /tmp/lastb2b-mission-operator-live/src/lib/mission-orchestrator.ts, /tmp/lastb2b-mission-operator-live/src/app/api/internal/missions/tick/route.ts, /tmp/lastb2b-mission-operator-live/src/app/api/internal/outreach/tick/route.ts, /tmp/lastb2b-mission-operator-live/src/lib/client-api.ts, /tmp/lastb2b-mission-operator-live/src/app/brands/[id]/missions/missions-client.tsx, /tmp/lastb2b-mission-operator-live/src/app/brands/[id]/missions/[missionId]/mission-detail-client.tsx, /tmp/lastb2b-mission-operator-live/docs/uiux/features/ai-mission-autopilot-go.md
