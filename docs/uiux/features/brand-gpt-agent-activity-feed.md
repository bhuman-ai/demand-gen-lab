# Feature: brand-gpt-agent-activity-feed

## Request
Add an Agent Activity / Autonomy Feed so a user can open a brand and immediately see whether Brand GPT is running, what it last tried, what tools/actions ran, what changed, what is blocked, and whether it needs user attention.

## Autonomy Mode
holistic_autopilot

## Target Users
Founder/operator using LastB2B.

## Optimization Target
Make autonomous Brand GPT visibly alive and auditable without adding another dense dashboard.

## Hard Constraints
- Use existing Operator threads, runs, actions, messages, and attention requests.
- Keep the main UI chat-first and simple.
- Treat activity as a small feed, not a dashboard.
- Do not hardcode specific agent strategies or blocker categories.

## Touched Surfaces
- Brand GPT agent page
- Operator activity API/runtime data
- Brand home chat shell

## Concept Options
### Option A: Inline Latest-Activity Strip
Show one compact status row above the Brand GPT transcript with a collapsed recent feed. Lowest cognitive load and keeps chat primary.

### Option B: Separate Activity Tab
Create a dedicated Activity page or tab under Agent. More room, but users must leave the chat and it starts feeling like another dashboard.

### Option C: Right-Side Activity Rail
Add a desktop side rail for activity. Useful on large screens, but it reintroduces split-pane clutter and is weak on mobile.

### Option D: Notification Center
Create a global notification surface. Scales later, but too much product surface before proving signal quality.

## Concept Winner
Choose Option A: inline latest-activity strip plus collapsed recent feed inside Brand GPT.

Why:
- It preserves the current ChatGPT-like product shape.
- It keeps one primary action: talk to Brand GPT.
- It uses existing Operator data instead of a new database table.
- It works on mobile without another navigation layer.

## View Model Contract
- Primary action: read the latest activity status, then keep chatting.
- Primary risk: users cannot tell whether the autonomous loop is alive or stuck.
- Information budget: one state, one explanation, one timestamp; tool/action/message details stay collapsed.
- Empty state: no activity yet, ask Brand GPT or start a mission.
- Error state: activity unavailable, chat still works.

## Implementation Notes
- 2026-05-26: Added `getOperatorActivitySummary`, a read-only aggregator over Operator threads, runs, actions, messages, and attention requests.
- Added `/api/operator/activity` and `fetchOperatorActivity`.
- Added a compact `AgentActivityFeed` above the inline Brand GPT chat.
- The feed polls every minute and refreshes when Operator chat emits `lastb2b:operator-updated`.

## Doc Sync
- 2026-05-26: Synced feature and states docs after implementation.
