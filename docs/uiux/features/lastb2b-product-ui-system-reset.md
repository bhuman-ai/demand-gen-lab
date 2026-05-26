# Feature: LastB2B Product UI System Reset

## Request
Make LastB2B feel like one coherent AI growth operator workspace instead of a set of patched-together admin pages. The first slice should reset the canonical UI docs, navigation vocabulary, shared primitives, and highest-leverage Brand GPT surfaces while preserving current routes and functionality.

## Autonomy Mode
Holistic autopilot.

## Target Users
- Founder/operator who wants AI to run B2B growth without babysitting tools.
- Growth operator who needs to inspect evidence, fix blockers, and review replies.
- Admin/technical user who connects providers, senders, credentials, and diagnostics.

## Optimization Target
Simple, coherent, branded, chat-first AI operator workspace.

## Hard Constraints
- Do not direct-edit the dirty protected main worktree.
- Preserve existing routes and app behavior.
- Prefer shared primitives and canonical docs over one-off page styling.
- Keep the default UI focused on one primary action, one primary risk, and progressive disclosure.

## Scope
This is a redesign-mode first slice, not a full app rewrite. It establishes the product grammar and migrates the most visible shell/home labels first. Deeper page-by-page redesign can happen after the app has one shared vocabulary.

## Touched Surfaces
- Authenticated app shell.
- Brand GPT home.
- Brand workspace navigation.
- Brand directory and onboarding copy.
- Goals, outbound, and tests labels.
- UI/UX canonical docs.
- Shared operator workspace primitives.

## Success Moment
A founder opens a brand and understands within a few seconds: Brand GPT is the main workspace, what it is doing now, what is blocked, and where to inspect supporting evidence if needed.

## Failure Policy
If the reset causes confusion or regression, keep the underlying routes intact and revert only the vocabulary/shared primitive layer. Diagnostics and legacy drilldowns remain accessible, so the app does not lose operational coverage.

## Primary Action
Talk to Brand GPT, approve or provide context only when needed, and open drilldowns only when the user wants evidence or manual intervention.

## Primary Risk
The UI exposes internal machinery as equal-weight pages, making the product feel like a collection of tools instead of one autonomous AI operator.

## Information Budget
Default surfaces show one current agent state, one next action, one top risk, and one recent rationale. Details, evidence, logs, and setup controls live behind Details, Activity, or drilldown pages.

## View Model Contract
- Primary user: founder/operator.
- Primary object: brand-scoped AI growth operator.
- Current decision: let the agent continue, answer its request, or inspect a specific drilldown.
- Why now: the app must feel coherent enough that users trust the autonomy.
- Next action: talk to Brand GPT or resolve the single surfaced blocker.
- Top risk: hidden or fragmented state makes the user think the agent is fake, stuck, or hardcoded.

## Concept Options
- Option A: Agent home with drilldowns. Brand GPT is the default workspace. Inbox, Audience, Delivery, Outbound, Tests, and Social support the agent.
- Option B: Ops dashboard command center. Dense metrics and operational panels dominate. Strong for internal teams, but it keeps the product feeling like an admin console.
- Option C: Setup wizard first. Great for onboarding, but weak for the long-term promise that the AI keeps working after setup.
- Option D: Toolbelt workspace. Flexible, but it exposes implementation tools instead of a coherent operator.

## Concept Winner
Option A wins. It matches the product promise: a Codex-like AI operator for each brand with context, tools, activity, evidence, and autonomy. The first implementation keeps routes stable but reframes navigation and page language around the operator.

## Design Notes
- Product archetype: AI operator workspace with drilldowns, borrowing structure from ChatGPT-style conversation and Linear/Raycast-style command clarity without copying visual branding.
- Primary nav: Brand GPT, Inbox, Audience, Delivery.
- Secondary nav: Goals, Outbound, Tests, Social.
- System nav: Settings, Diagnostics, Logic.
- Assistant text should read as unboxed prose. User prompts use a single muted rounded bubble.
- Status and evidence use plain English labels and disclosure rows.

## Implementation Notes
- Added shared `operator-workspace` primitives for status strips and drilldown links.
- Updated `AppShell` sidebar labels, grouping, and breadcrumbs.
- Updated Brand GPT home drilldown links and status display to use shared primitives.
- Renamed visible product vocabulary on the highest-leverage surfaces: missions to Goals, campaigns to Outbound, experiments to Tests, leads to Audience, network to Delivery, doctor to Diagnostics.
- Updated brand directory and onboarding copy so new users learn the Brand GPT-first model.
- 2026-05-26 Implementation summary: Established a coherent Brand GPT-first product grammar for LastB2B. Updated the authenticated app shell navigation and breadcrumbs to Brand GPT, Inbox, Audience, Delivery, Goals, Outbound, Tests, Social, Settings, Diagnostics, and Logic. Added shared operator-workspace primitives for status strips and drilldown links. Migrated Brand GPT home, brand directory, onboarding, Goals, Outbound, Tests, Inbox, Audience, command palette, and legacy route cards to the new vocabulary while keeping existing routes and behavior stable. Cleaned canonical UI docs so the source of truth matches an AI operator workspace with drilldowns.
- Files: docs/uiux/adoption.md, docs/uiux/design-system.md, docs/uiux/foundation.md, docs/uiux/ia-flows.md, docs/uiux/jtbd-personas.md, docs/uiux/features/lastb2b-product-ui-system-reset.md, src/app/page.tsx, src/app/logic/page.tsx, src/app/brands/page.tsx, src/app/brands/new/page.tsx, src/app/brands/[id]/brand-home-client.tsx, src/app/brands/[id]/campaigns/campaigns-client.tsx, src/app/brands/[id]/campaigns/[campaignId]/build/page.tsx, src/app/brands/[id]/campaigns/[campaignId]/build/build-client.tsx, src/app/brands/[id]/campaigns/[campaignId]/evolution/evolution-client.tsx, src/app/brands/[id]/campaigns/[campaignId]/experiments/page.tsx, src/app/brands/[id]/campaigns/[campaignId]/experiments/experiments-client.tsx, src/app/brands/[id]/campaigns/[campaignId]/hypotheses/page.tsx, src/app/brands/[id]/campaigns/[campaignId]/hypotheses/hypotheses-client.tsx, src/app/brands/[id]/campaigns/[campaignId]/objective/page.tsx, src/app/brands/[id]/campaigns/[campaignId]/objective/objective-client.tsx, src/app/brands/[id]/campaigns/[campaignId]/run/page.tsx, src/app/brands/[id]/campaigns/[campaignId]/run/inbox/page.tsx, src/app/brands/[id]/campaigns/[campaignId]/run/leads/page.tsx, src/app/brands/[id]/campaigns/[campaignId]/run/overview/page.tsx, src/app/brands/[id]/campaigns/[campaignId]/run/variants/page.tsx, src/app/brands/[id]/experiments/experiments-client.tsx, src/app/brands/[id]/inbox/evals/evals-client.tsx, src/app/brands/[id]/inbox/inbox-client.tsx, src/app/brands/[id]/leads/leads-client.tsx, src/app/brands/[id]/missions/[missionId]/mission-detail-client.tsx, src/app/brands/[id]/missions/missions-client.tsx, src/components/auth/auth-screen.tsx, src/components/home/workspace-overview.tsx, src/components/layout/app-shell.tsx, src/components/layout/global-command-palette.tsx, src/components/layout/route-replaced-card.tsx, src/components/ui/operator-workspace.tsx, src/lib/operator-activity.ts
- Components: AppShell, BrandSwitcher, GlobalCommandPalette, BrandHomeClient, OperatorStatusStrip, OperatorDrilldownLink, WorkspaceOverview, MissionsClient, CampaignsClient, ExperimentsClient, InboxClient, LeadsClient
- Assumptions used: Existing route paths remain stable for this slice; user-facing vocabulary changes first., Brand GPT is the default workspace and existing operational pages become drilldowns., The next slice should migrate deeper page layouts after the shell and vocabulary are coherent.
## Doc Sync
Updated canonical UI/UX docs: foundation, JTBD/personas, IA/flows, design system, adoption, and this feature doc.
- 2026-05-26 Synced after implementation.
- States touched: empty, loading, error
- Code touched: docs/uiux/adoption.md, docs/uiux/design-system.md, docs/uiux/foundation.md, docs/uiux/ia-flows.md, docs/uiux/jtbd-personas.md, docs/uiux/features/lastb2b-product-ui-system-reset.md, src/app/page.tsx, src/app/logic/page.tsx, src/app/brands/page.tsx, src/app/brands/new/page.tsx, src/app/brands/[id]/brand-home-client.tsx, src/app/brands/[id]/campaigns/campaigns-client.tsx, src/app/brands/[id]/campaigns/[campaignId]/build/page.tsx, src/app/brands/[id]/campaigns/[campaignId]/build/build-client.tsx, src/app/brands/[id]/campaigns/[campaignId]/evolution/evolution-client.tsx, src/app/brands/[id]/campaigns/[campaignId]/experiments/page.tsx, src/app/brands/[id]/campaigns/[campaignId]/experiments/experiments-client.tsx, src/app/brands/[id]/campaigns/[campaignId]/hypotheses/page.tsx, src/app/brands/[id]/campaigns/[campaignId]/hypotheses/hypotheses-client.tsx, src/app/brands/[id]/campaigns/[campaignId]/objective/page.tsx, src/app/brands/[id]/campaigns/[campaignId]/objective/objective-client.tsx, src/app/brands/[id]/campaigns/[campaignId]/run/page.tsx, src/app/brands/[id]/campaigns/[campaignId]/run/inbox/page.tsx, src/app/brands/[id]/campaigns/[campaignId]/run/leads/page.tsx, src/app/brands/[id]/campaigns/[campaignId]/run/overview/page.tsx, src/app/brands/[id]/campaigns/[campaignId]/run/variants/page.tsx, src/app/brands/[id]/experiments/experiments-client.tsx, src/app/brands/[id]/inbox/evals/evals-client.tsx, src/app/brands/[id]/inbox/inbox-client.tsx, src/app/brands/[id]/leads/leads-client.tsx, src/app/brands/[id]/missions/[missionId]/mission-detail-client.tsx, src/app/brands/[id]/missions/missions-client.tsx, src/components/auth/auth-screen.tsx, src/components/home/workspace-overview.tsx, src/components/layout/app-shell.tsx, src/components/layout/global-command-palette.tsx, src/components/layout/route-replaced-card.tsx, src/components/ui/operator-workspace.tsx, src/lib/operator-activity.ts
## Open Questions
- Whether route paths should eventually match the new vocabulary or stay stable behind the current URLs.
- How much of the older dashboard/card page structure should be replaced in the next migration slice.
