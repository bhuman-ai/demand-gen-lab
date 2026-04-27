# Feature: youtube-commenting-brand-switch

## Request
Add a switcher so users can turn YouTube commenting on or off per brand. Do not auto-enable it for any brand; default must be off for all existing and future brands. Gate automated YouTube comment posting on this setting.
## Autonomy Mode
holistic_autopilot
## Target Users
Founder/operator managing social discovery automation
## Optimization Target
Make YouTube auto-commenting explicitly opt-in and visibly controllable per brand
## Hard Constraints
- Default off for all brands
- Do not auto-enable YouTube commenting for any brand
- Automated dispatch and webhook paths must both respect the switch
## Scope
Add one explicit brand-level YouTube auto-commenting control to the existing Social Discovery YouTube setup surface, persist the setting on the brand record, and gate automated YouTube posting paths behind it.
## Touched Surfaces
- /brands/[id]/social-discovery
## Success Moment
The operator sees YouTube auto-commenting off by default, can intentionally enable it for one brand, and backend automation refuses to post YouTube comments for brands where the switch remains off.

## Failure Policy
If the setting cannot save, keep the previous value visible and show an inline error. If automation runs while the setting is off, skip posting and log `brand_youtube_auto_comment_disabled`.

## Primary Action
Turn YouTube auto-commenting on or off for the current brand.
## Primary Risk
Accidental public YouTube comments from a brand that was never intentionally enabled.
## Information Budget
Show the switch, one sentence describing the current effect, and save/error state only. Keep quota, debug, and audit detail outside the default control.
## View Model Contract
Primary user: Founder/operator managing social discovery automation
Current decision: whether this brand may post YouTube comments automatically.
Why now: discovery can run broadly across brands, so posting must be explicit opt-in.
Next action: turn the switch on only after the brand is ready.
Top risk: any brand without explicit opt-in must be treated as off by backend automation.
## Concept Options

1. Brand-level safety switch near YouTube automation controls
- Add one explicit `YouTube auto-commenting` switch to the existing Social Discovery YouTube setup area.
- Default state is off. Off means automated dispatch and upload-webhook auto-commenting cannot post for this brand.
- Keep channel subscriptions and search discovery separate; users can still discover/review videos while posting remains off.

2. Per-channel switches only
- Reuse each watched channel's auto-comment setting.
- Rejected because search-based dispatch is brand-level and can post on videos unrelated to a watched channel, so per-channel switches do not cover the full risk.

3. Global environment kill switch only
- Add one internal env flag.
- Rejected because the user needs a visible per-brand control and future brands must not inherit posting accidentally.
## Concept Winner
Use option 1: a brand-level safety switch in the existing Social Discovery YouTube setup surface.

Primary Action: turn YouTube auto-commenting on or off for the current brand.

Primary Risk: accidental public YouTube comments from a brand that was never intentionally enabled.

Information Budget: show the switch, one sentence of current effect, and save/error state only. Do not add another dashboard card or expose quota/debug detail in the default control.

View Model Contract:
- Primary user: founder/operator managing social discovery automation.
- Current decision: whether this brand may post YouTube comments automatically.
- Why now: search/discovery can run broadly, so posting must be explicit opt-in.
- Next action: turn the switch on only after the brand is ready.
- Top risk: any brand without explicit opt-in must be treated as off by backend automation.

Implementation notes:
- Persist as a brand field, default false in types, normalizers, inserts, migration, and update API.
- Gate scheduled auto-comment dispatch and YouTube upload-webhook auto-comment paths.
- Keep manual comment posting untouched; this switch is for automated YouTube commenting only.
## Decisions
- Scope: Add a brand-level switch, default it off, and gate automated YouTube posting paths. (source: agent_assumption; why: Smallest coherent slice that satisfies the request.)
- Primary Action: Turn YouTube auto-commenting on or off for the current brand. (source: agent_assumption; why: The user asked for a direct switcher.)
- Primary Risk: Accidental public YouTube comments from a brand that was never intentionally enabled. (source: agent_assumption; why: The user explicitly said not to auto-enable it for any brand.)
- Information Budget: Show the switch, one sentence of effect, and save/error state only. (source: agent_assumption; why: Founder/operator control should optimize for fast safety decisions.)
- View Model Contract: Primary user: Founder/operator managing social discovery automation
Current decision: whether this brand may post YouTube comments automatically.
Why now: discovery can run broadly across brands, so posting must be explicit opt-in.
Next action: turn the switch on only after the brand is ready.
Top risk: any brand without explicit opt-in must be treated as off by backend automation. (source: agent_assumption; why: The switch governs public posting risk.)
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-04-27 Implementation summary: Added an explicit brand-level YouTube auto-commenting switch on the Social Discovery YouTube setup surface. The switch defaults off for embedded fallback brands, new brands, and all existing production brands through a Supabase migration. Scheduled dispatch and YouTube upload webhook auto-comment paths now require the brand switch to be enabled before posting; YouTube channel subscription auto-comment defaults off and cannot be enabled while the brand switch is off. Manual posting remains unchanged.
- Files: src/lib/factory-types.ts, src/lib/factory-data.ts, src/app/api/brands/[brandId]/route.ts, src/app/api/brands/[brandId]/social-discovery/route.ts, src/lib/social-discovery-youtube-subscriptions.ts, src/app/api/brands/[brandId]/social-discovery/youtube-subscriptions/route.ts, src/lib/social-discovery-comment-dispatch.ts, src/app/api/webhooks/youtube/uploads/[brandId]/route.ts, src/app/brands/[id]/social-discovery/page.tsx, src/app/brands/[id]/social-discovery/social-discovery-client.tsx, supabase/migrations/20260427161000_brand_youtube_auto_comment_switch.sql
- Components: Social Discovery YouTube setup surface, Brand PATCH API, Social Discovery brand summary API, YouTube subscription API, Scheduled social discovery comment dispatch, YouTube uploads webhook, Brand persistence model, Supabase demanddev_brands schema
- Assumptions used: The switch is brand-level, not account-level, because the user asked to enable or disable YouTube commenting per brand., Existing and future brands must default to disabled until a human explicitly enables the switch., Channel-level auto-comment settings can remain as secondary controls, but scheduled posting must still be blocked unless the brand-level switch is enabled.
## Doc Sync
- 2026-04-27 Synced after implementation.
- States touched: loading, error
- Code touched: src/lib/factory-types.ts, src/lib/factory-data.ts, src/app/api/brands/[brandId]/route.ts, src/app/api/brands/[brandId]/social-discovery/route.ts, src/lib/social-discovery-youtube-subscriptions.ts, src/app/api/brands/[brandId]/social-discovery/youtube-subscriptions/route.ts, src/lib/social-discovery-comment-dispatch.ts, src/app/api/webhooks/youtube/uploads/[brandId]/route.ts, src/app/brands/[id]/social-discovery/page.tsx, src/app/brands/[id]/social-discovery/social-discovery-client.tsx, supabase/migrations/20260427161000_brand_youtube_auto_comment_switch.sql
