# Feature: sender-setup-happy-paths

## Request
Simplify the LastB2B Outreach Settings sender setup UI. The current settings screen is overwhelming. Design around only the happy paths for adding/using email senders and hide everything else.
## Autonomy Mode
holistic_autopilot
## Target Users
founder/operator setting up autonomous outbound for one brand
## Optimization Target
one obvious sender setup path with only happy-path choices visible
## Hard Constraints
- Default UI must show only happy paths
- no provider wall
- no duplicate menus
- no dense checkbox list.
- Preserve existing sender add/assignment capability behind progressive disclosure.
- Use existing LastB2B design system and shared components.
## Scope
Optimize for one obvious sender setup path with only happy-path choices visible. Start with smallest coherent slice that proves Simplify the LastB2B Outreach Settings sender setup UI. The current settings is overwhelming. Design around only the happy paths for adding/using email senders and hide everything else..
## Touched Surfaces
- /settings/outreach sender setup
- brand network add sender modal
## Success Moment
[TODO] Define exact user outcome that proves this feature works.

## Failure Policy
[TODO] Describe recovery path on failure.

## Primary Action
founder/operator setting up autonomous outbound for one brand should be able to Simplify the LastB2B Outreach Settings sender setup UI. The current settings is overwhelming. Design around only the happy paths for adding/using email senders and hide everything else. with one obvious first move.
## Primary Risk
founder/operator setting up autonomous outbound for one brand should not have to guess what matters first or what can go wrong.
## Information Budget
First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown.
## View Model Contract
Primary user: founder/operator setting up autonomous outbound for one brand
Current decision: Simplify the LastB2B Outreach Settings sender setup UI. The current settings is overwhelming. Design around only the happy paths for adding/using email senders and hide everything else.
Why now: founder/operator setting up autonomous outbound for one brand needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: founder/operator setting up autonomous outbound for one brand should not have to guess what matters first or what can go wrong.
## Concept Options
1. **Settings dashboard cleanup.** Keep the existing tabs, setup-order banner, sender setup card, domain setup card, and selected-sender table, but tighten copy. Rejected because the default screen still asks the user to understand internal setup order, provider wiring, sender assignment, reply inbox assignment, and existing account inventory at once.
2. **Agent-only setup.** Remove the settings UI and make users tell the brand agent what email to use. Rejected because credentials, verification failures, and sender inventory need a visible review surface; chat alone makes setup state hard to trust.
3. **Happy-path chooser.** Replace the default sender setup body with one current-state panel and three user-intent actions: use an email I already have, create a new sender for me, or use a sender already in LastB2B. Hide provider setup, bulk sender tables, raw reply inbox lists, and Customer.io/Mailpool/Namecheap details behind advanced management. Chosen because it maps to how the user thinks, keeps the agent free to test routes, and preserves all existing capabilities without making every knob visible.
4. **Recommended sender only.** Show one best sender and a single confirm button, with no add-new path. Rejected because first-time setup and broken sender recovery still need an obvious way to add or replace the sender.

ASCII winner direction:

```text
Sender setup
Current setup
  zeynep@getbhumanvideos.com        Needs testing
  Reply inbox: same inbox
  [Ask agent to test this sender]

What do you want to do?
  [Use an email I already have]
  [Create a new email for me]
  [Use a sender already in LastB2B]

Advanced
  Manage all senders, providers, inboxes, DNS, Customer.io, Mailpool
```

Default screen removes: setup-order banner, duplicate sender summary card, provider-first cards, dense checkbox table, side-by-side default/reply selectors, and raw status/debug counts.
## Concept Winner
Concept 3 wins: **Happy-path chooser**.

The default sender setup should answer one question: **how should this brand get a usable sender?** The only visible happy paths are:

1. **Use an email I already have.** User enters email + app password; server settings stay hidden unless needed. The agent then tests mailbox/SMTP/Customer.io route candidates and seed placement before prospect sends.
2. **Create a new email for me.** User gives the minimum domain/mailbox preference; LastB2B provisions the domain/mailbox and the agent tests/w warms it before prospect sends.
3. **Use a sender already in LastB2B.** User picks from a compact list of ready or recently used senders, not a giant checkbox table. Default/reply routing is chosen automatically unless the user opens advanced management.

Everything else moves out of the default path: provider credentials, raw Customer.io/Mailpool/Namecheap setup, DNS details, all-sender multi-select, all reply inboxes, debug checks, and operational metrics. Those remain available behind **Advanced sender management** for support/debug work.

Why this beats the alternatives: it matches user intent instead of infrastructure, reduces the visible decision count from many to three, keeps one primary action, and still lets the agent operate in the open-world route model after credentials exist.
## Decisions
- Scope: Optimize for one obvious sender setup path with only happy-path choices visible. Start with smallest coherent slice that proves Simplify the LastB2B Outreach Settings sender setup UI. The current settings is overwhelming. Design around only the happy paths for adding/using email senders and hide everything else.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
- Primary Action: founder/operator setting up autonomous outbound for one brand should be able to Simplify the LastB2B Outreach Settings sender setup UI. The current settings is overwhelming. Design around only the happy paths for adding/using email senders and hide everything else. with one obvious first move. (source: agent_assumption; why: Autopilot inferred default for primary_action from request, audience, optimization target, and mode.)
- Primary Risk: founder/operator setting up autonomous outbound for one brand should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for primary_risk from request, audience, optimization target, and mode.)
- Information Budget: First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown. (source: agent_assumption; why: Autopilot inferred default for information_budget from request, audience, optimization target, and mode.)
- View Model Contract: Primary user: founder/operator setting up autonomous outbound for one brand
Current decision: Simplify the LastB2B Outreach Settings sender setup UI. The current settings is overwhelming. Design around only the happy paths for adding/using email senders and hide everything else.
Why now: founder/operator setting up autonomous outbound for one brand needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: founder/operator setting up autonomous outbound for one brand should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for view_model_contract from request, audience, optimization target, and mode.)
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-05-31 Implementation summary: Simplified the outreach sender setup default view around happy paths only: current setup, saved-sender picker, use existing email, create new email, and advanced sender management collapsed by default. Removed the setup-order banner, duplicate sender summary, visible dense sender checkbox table, provider-first cards, and default/reply selectors from the default path.
- Files: /Users/don/lastb2b/src/app/settings/outreach/outreach-settings-client.tsx, /Users/don/lastb2b/src/app/settings/outreach/sender-provision-card.tsx, /Users/don/lastb2b/docs/uiux/features/sender-setup-happy-paths.md
- Components: OutreachSettingsClient, SenderProvisionCard
- Assumptions used: Happy path means use an existing saved sender, add an email the user owns, or create a new email through LastB2B., Provider credentials and multi-sender overrides should remain available only behind advanced management., Existing design tokens and Card/Button/Input/Select primitives remain the source of truth.
## Doc Sync
- 2026-05-31 Synced after implementation.
- States touched: partial
- Code touched: /Users/don/lastb2b/src/app/settings/outreach/outreach-settings-client.tsx, /Users/don/lastb2b/src/app/settings/outreach/sender-provision-card.tsx, /Users/don/lastb2b/docs/uiux/features/sender-setup-happy-paths.md
