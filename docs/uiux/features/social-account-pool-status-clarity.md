# Feature: social-account-pool-status-clarity

## Request
Fix YouTube OAuth return UI getting stuck on 'Refreshing connected YouTube account...' / 'Opening...' even after the account shows connected with a YouTube channel id.
## Scope
In scope: fix the YouTube connect bug so the same account row that completes Google OAuth reliably shows a connected state, and clarify the status/action copy around that flow so users can tell whether the account is connected, still syncing, or needs sign-in. Out of scope: redesigning the whole social account pool, changing unrelated Instagram flows, or adding new platform types.
## Touched Surfaces
- Social Discovery social account pool
## Success Moment
Primary end user affected by this request completes Fix YouTube OAuth return UI getting stuck on 'Refreshing connected YouTube account...' / 'Opening...' even after the account shows connected with a YouTube channel id. and sees explicit confirmation of successful outcome.
## Failure Policy
[TODO] Describe recovery path on failure.

## Decisions
[TODO] Capture durable decisions and assumptions here.
- Scope: In scope: fix the YouTube connect bug so the same account row that completes Google OAuth reliably shows a connected state, and clarify the status/action copy around that flow so users can tell whether the account is connected, still syncing, or needs sign-in. Out of scope: redesigning the whole social account pool, changing unrelated Instagram flows, or adding new platform types. (source: human)
- Raw human context (2026-04-19): so bug is even tho I connect it clearly I go thru the auth flow, it doresnt say its connected
- Success Moment: Primary end user affected by this request completes Fix YouTube OAuth return UI getting stuck on 'Refreshing connected YouTube account...' / 'Opening...' even after the account shows connected with a YouTube channel id. and sees explicit confirmation of successful outcome. (source: agent_assumption; why: Autopilot inferred default for success_moment from request, audience, optimization target, and mode.)
- Error States: Explain failure clearly, preserve entered work where possible, and offer retry plus fallback path. (source: agent_assumption; why: Autopilot inferred default for error_state from request, audience, optimization target, and mode.)
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-04-19 Implementation summary: Clarified social account pool status language and hardened the YouTube OAuth return path. The panel now retries account refresh after YouTube OAuth success instead of refreshing only once, shows a temporary pending state on the affected row while post-auth data is syncing, and replaces vague 'Choose a platform' language with clearer copy.
- Files: /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-account-pool-panel.tsx
- Components: SocialAccountPoolPanel
- Assumptions used: YouTube callback persistence can arrive slightly after the first list refresh, so the UI should retry briefly before declaring the row still unsigned., Clarifying pending and unselected states is sufficient for this bug fix without redesigning the full social account pool.
- 2026-04-20 Implementation summary: Fixed YouTube OAuth return UI cleanup so a saved YouTube externalAccountId immediately clears pending/opening/syncing state, updates the selected draft, and shows the connected state instead of stale 'Refreshing connected YouTube account...' or 'Opening...' copy.
- Files: src/app/brands/[id]/social-discovery/social-account-pool-panel.tsx
- Components: SocialAccountPoolPanel
## Doc Sync
- 2026-04-19 Synced after implementation.
- States touched: loading, partial
- Code touched: /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-account-pool-panel.tsx
- 2026-04-20 Synced after implementation.
- States touched: loading, partial
- Code touched: src/app/brands/[id]/social-discovery/social-account-pool-panel.tsx
## Autonomy Mode
holistic_autopilot
## Target Users
Primary end user affected by this request
## Optimization Target
Fastest clear MVP with lowest avoidable complexity
