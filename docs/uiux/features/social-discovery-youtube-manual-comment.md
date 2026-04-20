# Feature: social-discovery-youtube-manual-comment

## Request
Fix regression where YouTube OAuth returns 'Google sign-in finished, but we could not save the YouTube account. Please try again.' after connecting an account in the social discovery / social account pool flow.
## Autonomy Mode
holistic_autopilot
## Target Users
operator/founder under time pressure
## Optimization Target
Restore working YouTube account connect flow with minimal UI/API changes
## Hard Constraints
- Preserve existing comment composer behavior
- Keep YouTube path beginner-simple with one primary next action
- Use existing repo components and tokens
- Hide advanced options until explicitly needed
## Scope
Optimize for decision speed with one primary action. Start with smallest coherent slice that proves Emergency override UI implementation for social discovery. Add the simplest YouTube manual-comment path for a core unit video lead workflow: search a niche, see videos with subscriber counts, pick one video, and use the existing comment composer/manual comment button. Scope is search + review + manual comment button only. Reduce visible controls and hide promotional clutter on the YouTube path..
## Touched Surfaces
- social-discovery
- outreach-account-connect
## Success Moment
operator/founder under time pressure completes Emergency override UI implementation for social discovery. Add the simplest YouTube manual-comment path for a core unit video lead workflow: search a niche, see videos with subscriber counts, pick one video, and use the existing comment composer/manual comment button. Scope is search + review + manual comment button only. Reduce visible controls and hide promotional clutter on the YouTube path. and sees explicit confirmation of successful outcome.
## Failure Policy
[TODO] Describe recovery path on failure.

## Decisions
- Scope: Optimize for decision speed with one primary action. Start with smallest coherent slice that proves Emergency override UI implementation for social discovery. Add the simplest YouTube manual-comment path for a core unit video lead workflow: search a niche, see videos with subscriber counts, pick one video, and use the existing comment composer/manual comment button. Scope is search + review + manual comment button only. Reduce visible controls and hide promotional clutter on the YouTube path.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
- Success Moment: operator/founder under time pressure completes Emergency override UI implementation for social discovery. Add the simplest YouTube manual-comment path for a core unit video lead workflow: search a niche, see videos with subscriber counts, pick one video, and use the existing comment composer/manual comment button. Scope is search + review + manual comment button only. Reduce visible controls and hide promotional clutter on the YouTube path. and sees explicit confirmation of successful outcome. (source: agent_assumption; why: Autopilot inferred default for success_moment from request, audience, optimization target, and mode.)
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-04-20 Implementation summary: Implemented a beginner-simple YouTube manual comment path inside social discovery. Added a YouTube discovery API that searches recent videos, enriches them with channel/video metrics, prepares normal social discovery posts, saves them, and reuses existing account routing. Updated the social discovery client to prioritize one primary flow: search YouTube, review a selected result with subscriber/view/comment counts, optionally watch the channel, and send a manual comment through the existing composer. Moved legacy Instagram scan, comment prompt settings, watched-channel management, and account linking into collapsed advanced setup so the default screen stays focused on the main action. Fixed the scoring export in social-discovery helpers so the new path compiles cleanly.
- Files: src/app/api/brands/[brandId]/social-discovery/youtube-discovery/route.ts, src/app/brands/[id]/social-discovery/social-discovery-client.tsx, src/lib/social-discovery.ts, src/lib/youtube.ts, .env.example
- Components: SocialDiscoveryClient, SocialAccountPoolPanel
- 2026-04-20 Implementation summary: Simplified the YouTube manual-comment UI into a clearer 3-step flow in one main column: find videos, choose a video, then post a comment. Removed the dashboard-style split layout, renamed sections into plain step labels, made the selected account and draft the defaults, moved account switching and detailed metrics behind disclosure, and hid post-send export/debug details behind a 'Show details' summary. Kept advanced setup and older Instagram tools available, but collapsed under a single 'Setup and older tools' section.
- Files: src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- Components: SocialDiscoveryClient
- 2026-04-20 Implementation summary: Fixed a YouTube connect regression by restoring `config.social` merging inside the shared outreach account config merge helper. The Google OAuth callback was successfully fetching tokens and channel data, but the account save path was silently dropping social fields like `externalAccountId`, causing callback verification to fail with the 'could not save the YouTube account' message. The patch keeps the existing simple connect flow and fixes all account update paths that save social identity data.
- Files: /Users/don/lastb2b/src/lib/outreach-customerio-billing.ts
- Components: SocialAccountPoolPanel, YouTube OAuth callback, outreach account config merge helper
- 2026-04-20 Implementation summary: Made the two YouTube modes explicit in the social discovery UI. Added a simple top-level 'Choose mode' section, renamed the manual path to 'Mode 1. Search today's videos', renamed the action steps to 'Pick one video' and 'Review and post comment', pulled watched-channel subscriptions out of the old setup disclosure into a first-class 'Mode 2. Watch channels' section, and reduced the setup disclosure to prompt/config/account plumbing only.
- Files: /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- Components: SocialDiscoveryClient
## Doc Sync
- 2026-04-20 Synced after implementation.
- States touched: empty, loading, error
- Code touched: src/app/api/brands/[brandId]/social-discovery/youtube-discovery/route.ts, src/app/brands/[id]/social-discovery/social-discovery-client.tsx, src/lib/social-discovery.ts, src/lib/youtube.ts, .env.example
- 2026-04-20 Synced after implementation.
- States touched: empty
- Code touched: src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- 2026-04-20 Synced after implementation.
- Code touched: /Users/don/lastb2b/src/lib/outreach-customerio-billing.ts
- 2026-04-20 Synced after implementation.
- Code touched: /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-discovery-client.tsx
