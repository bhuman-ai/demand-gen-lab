# Feature: brand-gpt-proactive-user-attention

## Request
Add a generic proactive user-attention capability so Brand GPT can message or ask the user whenever it decides user attention is useful. This is not a hardcoded blocker workflow; the model chooses the reason.

## Autonomy Mode
holistic_autopilot

## Target Users
Founder/operator using LastB2B.

## Optimization Target
Make autonomous Brand GPT feel alive and able to ask for attention without adding rigid workflows or a notification center.

## Hard Constraints
- Do not hardcode specific proactive reasons.
- Use existing Operator threads/messages where possible.
- Keep the default notification surface in-app only.

## Touched Surfaces
- Brand GPT agent runtime
- Operator tool registry
- Mission runner
- AppShell sidebar/Brand GPT entry
- Operator chat panel

## Concept Options
### Option A: Thread-Only Proactive Messages
Brand GPT writes proactive asks/updates into the existing autonomous Operator thread. This is lowest cost, but users only notice after opening Brand GPT.

### Option B: Sidebar Attention Badge Plus Chat Entry
Brand GPT gets a generic `request_user_attention` tool. The tool creates a structured assistant message in the brand's Operator thread. The shared sidebar/Agent row shows a lightweight badge/count when unresolved attention requests exist. Clicking Agent opens the existing Brand GPT chat with the ask, options, and evidence in context.

### Option C: Separate Notification Center
Create a new notification model, API, route, and UI. This is more scalable later, but too much surface area before proving signal quality.

### Option D: External Push/Email Now
Let Brand GPT send email or external notifications immediately. This feels alive fastest, but risks noise before notification preferences exist.

## Concept Winner
Choose Option B.

Why:
- It gives Brand GPT a generic proactive voice without hardcoding reasons.
- It avoids a new notification product before agent judgment quality is proven.
- It keeps follow-up in the existing Brand GPT chat where context and evidence already live.
- It creates a later path to email/Slack/user preferences by treating attention requests as structured records.

## View Model Contract
- Primary action: open Brand GPT when it needs attention.
- Primary risk: noisy or vague attention requests that train users to ignore the agent.
- Information budget: sidebar shows only a small badge/count; chat carries the ask/update, reason, urgency, options, and evidence.
- Agent freedom: Brand GPT may use `request_user_attention` for any reason it chooses: blocker, approval, setup request, strategic question, achievement, risk warning, or status update.
- Safety: external notifications are deferred until explicit notification preferences exist.

## Implementation Notes
- 2026-05-26: Added a generic Brand GPT `request_user_attention` tool. The model can choose it for any reason it decides needs user attention, and the runtime stores the resulting structured attention request on the assistant message.
- Added `/api/operator/attention` and a client helper to count unresolved attention requests. A later user message in the same thread resolves the request.
- The shared sidebar Agent row and Brand GPT header button show a small count badge.
- OperatorPanel renders attention messages with suggested reply actions while keeping AI text unboxed.

## Doc Sync
- 2026-05-26: Synced feature and states docs after implementation.
