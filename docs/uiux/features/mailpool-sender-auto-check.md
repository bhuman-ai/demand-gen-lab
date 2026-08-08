# Feature: mailpool-sender-auto-check

## Request
Fix Delivery/Network sender verification so Mailpool/app-password senders do not ask the user to open Google sign-in. The user should not have to know about Mailpool, app passwords, or Gmail UI verification unless a real human Google challenge is required. Surface backend-owned automatic checks and simple plain-English status instead.
## Autonomy Mode
holistic_autopilot
## Target Users
Founder/operator using LastB2B to run outbound autonomously
## Optimization Target
Reduce confusing manual setup leakage; make sender repair feel automatic and backend-owned
## Hard Constraints
- Do not show Google sign-in as the normal path for Mailpool/app-password senders
- Preserve ability to handle real human Google challenges when backend credentials are unavailable or blocked
- Reuse existing sender cards and action handler patterns
## Scope
Patch the Delivery/Network sender card decision logic and Mailpool refresh path. Do not redesign the page. Do not add new controls beyond clearer labels and existing retry behavior.
## Touched Surfaces
- Brand Delivery / Network sender cards
## Success Moment
A founder/operator opens Delivery and sees Mailpool sender checks described as automatic backend work. If they inspect a problem sender, the main action is "Run check now" unless a real human Google login is the only remaining option.
## Failure Policy
If Mailpool refresh cannot produce a usable SMTP route and the sender is configured for Gmail UI, show the exceptional "Finish Google login" path with plain copy. Otherwise keep the repair framed as backend-owned automatic checking.
## Primary Action
Let LastB2B check and repair the sender automatically. The visible action, when shown, is an optional immediate retry: "Run check now."
## Primary Risk
The UI must not imply the founder/operator is responsible for internal sender plumbing. Only show a human task when Google is explicitly asking for an interactive login and no backend SMTP route is available.
## Information Budget
First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown.
## View Model Contract
Primary user: Founder/operator using LastB2B to run outbound autonomously.
Current decision: The user wants to know whether the sender is usable, not how Google/Mailpool plumbing works.
Why now: A manual Google sign-in prompt appeared even though backend credentials should handle the check.
Next action: Let LastB2B run the sender check automatically, with "Run check now" as an optional immediate retry.
Top risk: Exposing internal provider mechanics makes the product feel non-autonomous.
## Concept Options
1. Keep current manual verify flow, but rewrite copy to say Mailpool check. Rejected because it still makes the user feel responsible for internal sender plumbing.
2. Hide all repair affordances and only show passive status. Rejected because operators still need a visible way to run the same backend check immediately when they are inspecting the issue.
3. Backend-owned automatic check with optional manual retry. Chosen direction: Mailpool/app-password senders show plain status like "Automatic check" and an optional "Run check now" action. Google sign-in appears only when the account is explicitly configured for Gmail UI delivery and the login state is not ready.
## Concept Winner
Use concept 3: backend-owned automatic check with optional manual retry. It matches the product promise that LastB2B handles sender infrastructure automatically, preserves a fast operator override, and avoids exposing Google sign-in unless the selected delivery route truly depends on an interactive Gmail UI session.
## Decisions
- Use existing sender cards and action handling rather than adding a new repair panel.
- Treat Mailpool/app-password sender repair as backend-owned automatic work.
- Use "Run check now" for optional immediate retry, not "Verify sender."
- Only use "Finish Google login" for the exceptional Gmail UI path where no backend SMTP route is available.
- Keep provider details out of the default user-facing copy unless they explain a real blocker.
## Open Questions
None for this patch.
## Design Notes
Keep the sender card simple: status explains whether the sender needs attention; the next step is either automatic checking, no action, or a rare human Google login. Provider mechanics stay out of the default copy.
## Implementation Notes
- 2026-05-27 Implementation summary: Patched the Delivery/Network sender card so Mailpool/app-password senders use backend-owned automatic checks instead of normal Google sign-in prompts. Mailpool refresh now switches Gmail UI senders to SMTP automatically when Mailpool returns SMTP/app-password credentials, and sync ticks prioritize blocked Gmail UI senders for this repair path. The remaining Google login modal is reserved for exceptional Gmail UI-only cases.
- Files: src/app/brands/[id]/network/network-client.tsx, src/lib/mailpool-account-refresh.ts, docs/uiux/features/mailpool-sender-auto-check.md
- Components: Brand Delivery / Network sender cards, Mailpool account refresh
- Assumptions used: Mailpool/app-password sender repair should be backend-owned and not user-facing., A visible retry action may remain as an operator override, but it should not be presented as required setup.
## Doc Sync
- 2026-05-27 Synced after implementation.
- States touched: partial
- Code touched: src/app/brands/[id]/network/network-client.tsx, src/lib/mailpool-account-refresh.ts, docs/uiux/features/mailpool-sender-auto-check.md
