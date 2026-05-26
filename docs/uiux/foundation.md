# UI/UX Foundation

## Object Definition
Brand-scoped AI growth operator workspace.

The primary object is not a campaign, experiment, sender, or social queue. The primary object is the AI operator assigned to a brand. Campaigns, tests, leads, sender health, inbox replies, social actions, and delivery checks are supporting evidence/tool surfaces that the operator can use or expose when needed.
## Magic Moment
The founder opens a brand and immediately understands that Brand GPT is alive: what it is doing now, what it just did, what it needs, and whether growth is blocked. The user can simply type a request or answer the one surfaced blocker instead of navigating through campaigns, experiments, sender settings, and logs.
## Technical Constraints
- Preserve existing routes and runtime behavior while changing product grammar incrementally.
- Brand GPT remains the default per-brand workspace and primary action surface.
- Legacy concepts such as missions, experiments, campaigns, delivery, social discovery, and diagnostics remain available as drilldowns.
- The app must support async agent runs, live tool evidence, attention requests, inbox replies, lead sourcing, sender/domain provisioning, and deliverability monitoring.
- Default UI must not expose all internal machinery at equal weight.
- Founder-facing surfaces prioritize current state, next action, top blocker, and evidence receipts.
- Dense operational detail belongs in explicit drilldowns, Details panels, or diagnostic/admin surfaces.
## Volume & Density
Progressive density.

The home workspace should feel calm and chat-first: one main agent conversation, one current status, one top risk, and one obvious next action. Drilldowns can be dense when the job is operational, especially Inbox, Audience, Delivery, and Diagnostics. The product should not default to stacked dashboards or repeated cards.
