# Feature: ai-mission-operator

## Request
Add a simple mission-based LastB2B flow where the user enters their website and target customers, GPT-5.5 generates an editable campaign plan, and the system starts/monitors an internal outreach mission that handles deliverability, warmup, inbox/domain provisioning, tests over time, and learning without exposing experiments or targeting setup.

## Autonomy Mode
holistic_autopilot

## Target Users
Founder or growth operator who wants outbound handled without managing experiments, targeting, or deliverability.

## Optimization Target
One primary action, minimal setup, autonomous operator with visible risk and receipts.

## Hard Constraints
- Use existing brand/design docs and UI primitives.
- Hide experiments, sender setup, deliverability diagnostics, and campaign internals by default.
- Deliverability and warmup must be first-class mission state.
- No sends without an approved mission plan.
- Keep advanced controls behind details.

## Scope
Smallest coherent slice: website plus target-customer input, AI-generated editable mission plan, Start campaign approval, mission control status, deliverability state, and internal compilation to the existing experiment/outreach runtime.

## Touched Surfaces
- Brand mission setup
- Mission status/control surface
- Internal mission operator API
- Brand home primary action
- Main work navigation

## Success Moment
The founder/growth operator enters a site and target customers, edits what the AI inferred, clicks Start campaign, and sees the mission either running the first batch or clearly waiting on deliverability preparation.

## Failure Policy
Retry inline when safe, preserve the generated plan, and show the single blocker if launch cannot proceed. Sender/domain/warmup issues stay summarized in mission control instead of sending the user into a setup dashboard by default.

## Primary Action
Start campaign.

## Primary Risk
The system may send from weak inboxes/domains or broaden targeting before trust is earned.

## Information Budget
Default UI shows one primary action, one primary risk, one current rationale, and one concise deliverability status. Detailed experiments, sender/domain setup, warmup checks, inbox placement tests, sourcing chains, and learning logs live behind explicit details.

## View Model Contract
Primary user: founder or growth operator.

Current decision: approve/edit what AI inferred from the site and target-customer text.

Why now: user wants outbound running without building experiments or managing deliverability.

Next action: Generate plan, then Start campaign.

Top risk: autonomy without visible guardrails.

## Concept Options
### Option 1: Mission Autopilot
- User enters website and target customers, reviews an AI-generated plan, then clicks Start campaign.
- First screen has one primary action and treats deliverability, warmup, tests, sender provisioning, and learning as managed mission responsibilities.
- Experiments, targeting rules, sender setup, and inbox/domain diagnostics are hidden behind details.

### Option 2: Agent Team Console
- User sees separate AI operators for strategy, sourcing, messaging, deliverability, inbox, and learning.
- More transparent, but it risks making the product feel like another ops dashboard the user has to manage.

### Option 3: Power Campaign Builder
- Keep experiments, campaigns, sender setup, and deliverability controls visible while adding AI recommendations.
- Strong for internal operators, but it violates the requested no-setup product direction.

## Concept Winner
Mission Autopilot wins.

Implementation direction:
- Add a mission layer above existing brands, experiments, campaigns, outreach runs, sender readiness, and operator memory.
- GPT-5.5 mission operator can plan and choose internal tools, but code owns approval gates, first-batch limits, safety checks, sender readiness, warmup/provisioning policy, and audit logs.
- Deliverability is not a separate setup page in the default flow; it is a managed mission state with plain statuses like Preparing inboxes, Warming domains, Testing inbox placement, Ready to send, or Needs attention.

## Decisions
- Mission Autopilot is the chosen concept winner.
- Start campaign is the approval gate for the first small batch.
- Domain purchase, new audience expansion, and new claim expansion remain gated by approval policy.
- Existing outreach runtime remains the execution engine; missions are the user-facing layer.

## Open Questions
- Whether a later version should auto-purchase/register domains when provisioning settings and a billing/approval policy are present.
- Whether supervised autopilot should allow automatic scaling after the first successful learning cycle.

## Design Notes
- Use one setup panel and one mission-control page.
- Keep deliverability and learning behind details on the setup screen, but show deliverability status directly on mission control.
- Reuse existing `PageIntro`, `SectionPanel`, `StatLedger`, `Button`, `Input`, `Textarea`, and `Label`.
- Archetype: simple operator onboarding/control surface, not a dashboard.

## Implementation Notes
- 2026-05-15: Added mission tables, mission data layer, GPT mission plan generation, mission start/orchestration, runtime summary refresh, mission API routes, mission setup/status pages, and the internal mission tick route.
- 2026-05-15: Updated `Missions` to be the primary work nav item and changed brand home’s primary action to `Start AI campaign`.
- 2026-05-15: First batch compiles to the existing internal experiment/outreach runtime. If sender readiness blocks launch, mission status becomes `deliverability_blocked` with a plain blocker summary.

## Doc Sync
- 2026-05-15: Synced after implementation.
