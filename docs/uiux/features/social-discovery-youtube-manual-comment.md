# Feature: social-discovery-youtube-manual-comment

## Request
Make clicking a YouTube search result generate or refresh the comment draft immediately so the comment box does not stay blank after selection.
## Autonomy Mode
holistic_autopilot
## Target Users
founder/operator
## Optimization Target
decision speed and obvious next action
## Hard Constraints
- Preserve existing comment composer behavior
- Keep YouTube path beginner-simple with one primary next action
- Use existing repo components and tokens
- Hide advanced options until explicitly needed
## Scope
Optimize for decision speed with one primary action. Start with smallest coherent slice that proves Emergency override UI implementation for social discovery. Add the simplest YouTube manual-comment path for a core unit video lead workflow: search a niche, see videos with subscriber counts, pick one video, and use the existing comment composer/manual comment button. Scope is search + review + manual comment button only. Reduce visible controls and hide promotional clutter on the YouTube path..
## Touched Surfaces
- social-discovery
## Success Moment
operator/founder under time pressure completes Emergency override UI implementation for social discovery. Add the simplest YouTube manual-comment path for a core unit video lead workflow: search a niche, see videos with subscriber counts, pick one video, and use the existing comment composer/manual comment button. Scope is search + review + manual comment button only. Reduce visible controls and hide promotional clutter on the YouTube path. and sees explicit confirmation of successful outcome.
## Failure Policy
Retry inline when safe, preserve context, and escalate to support or fallback path if repeated failure continues.
## Decisions
- Scope: Optimize for decision speed with one primary action. Start with smallest coherent slice that proves Emergency override UI implementation for social discovery. Add the simplest YouTube manual-comment path for a core unit video lead workflow: search a niche, see videos with subscriber counts, pick one video, and use the existing comment composer/manual comment button. Scope is search + review + manual comment button only. Reduce visible controls and hide promotional clutter on the YouTube path.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
- Success Moment: operator/founder under time pressure completes Emergency override UI implementation for social discovery. Add the simplest YouTube manual-comment path for a core unit video lead workflow: search a niche, see videos with subscriber counts, pick one video, and use the existing comment composer/manual comment button. Scope is search + review + manual comment button only. Reduce visible controls and hide promotional clutter on the YouTube path. and sees explicit confirmation of successful outcome. (source: agent_assumption; why: Autopilot inferred default for success_moment from request, audience, optimization target, and mode.)
- Typography Scale: Use existing repo typography rhythm first. If none exists, keep a tight hierarchy with distinct title, section, and body sizes. (source: agent_assumption; why: Autopilot inferred default for typography_scale from request, audience, optimization target, and mode.)
- Primary Action: operator/founder under time pressure should be able to Auto-generate the YouTube comment draft with GPT-5.4 so the user does not have to write it manually, using the selected brand and its context in the social discovery manual comment . with one obvious first move. (source: agent_assumption; why: Autopilot inferred default for primary_action from request, audience, optimization target, and mode.)
- Primary Risk: operator/founder under time pressure should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for primary_risk from request, audience, optimization target, and mode.)
- Information Budget: First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown. (source: agent_assumption; why: Autopilot inferred default for information_budget from request, audience, optimization target, and mode.)
- View Model Contract: Primary user: operator/founder under time pressure
Current decision: Auto-generate the YouTube comment draft with GPT-5.4 so the user does not have to write it manually, using the selected brand and its context in the social discovery manual comment .
Why now: operator/founder under time pressure needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: operator/founder under time pressure should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for view_model_contract from request, audience, optimization target, and mode.)
- Failure Policy: Retry inline when safe, preserve context, and escalate to support or fallback path if repeated failure continues. (source: agent_assumption; why: Autopilot inferred default for failure_policy from request, audience, optimization target, and mode.)
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
- 2026-04-20 Implementation summary: Made YouTube manual-comment drafts default to a stronger GPT-5.4-backed path without adding UI weight. The social comment planner now defaults to GPT-5.4 for `social_comment_planning`, uses platform-aware prompt framing for YouTube vs Instagram, includes richer brand context fields in the prompt, and increases the default LLM planning limit so all 12 visible YouTube search results can get generated drafts. On the client, the flow now auto-selects the best result with a ready draft first and prefills any available draft from the interaction plan, so the user no longer starts from a blank comment box.
- Files: /Users/don/lastb2b/src/lib/social-discovery-comment-prompt.ts, /Users/don/lastb2b/src/lib/social-discovery.ts, /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- Components: SocialDiscoveryClient, social comment planner, social discovery comment prompt
- 2026-04-20 Implementation summary: Selecting a YouTube search result now auto-requests a fresh comment draft for that video instead of only switching the selected panel. Added a dedicated comment-draft API route, forced single-post GPT draft refresh on selection, and surfaced a simple watch-only/no-draft message plus retry action so the comment box no longer stays silently blank.
- Files: src/lib/social-discovery.ts, src/app/api/brands/[brandId]/social-discovery/comment-draft/route.ts, src/app/brands/[id]/social-discovery/social-discovery-client.tsx
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
- 2026-04-20 Synced after implementation.
- Code touched: /Users/don/lastb2b/src/lib/social-discovery-comment-prompt.ts, /Users/don/lastb2b/src/lib/social-discovery.ts, /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- 2026-04-20 Synced after implementation.
- States touched: loading, partial
- Code touched: src/lib/social-discovery.ts, src/app/api/brands/[brandId]/social-discovery/comment-draft/route.ts, src/app/brands/[id]/social-discovery/social-discovery-client.tsx
## Primary Action
operator/founder under time pressure should be able to Auto-generate the YouTube comment draft with GPT-5.4 so the user does not have to write it manually, using the selected brand and its context in the social discovery manual comment . with one obvious first move.

## Primary Risk
operator/founder under time pressure should not have to guess what matters first or what can go wrong.

## Information Budget
First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown.

## View Model Contract
Primary user: operator/founder under time pressure
Current decision: Auto-generate the YouTube comment draft with GPT-5.4 so the user does not have to write it manually, using the selected brand and its context in the social discovery manual comment .
Why now: operator/founder under time pressure needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: operator/founder under time pressure should not have to guess what matters first or what can go wrong.

## Concept Options
- 2026-04-20 Option A: Auto-generate comment draft immediately when a YouTube result is selected. Keep the existing comment box, prefill it with the generated draft, and let the user edit before posting.
- 2026-04-20 Option B: Add a separate `Generate draft` button inside the comment section. User manually triggers generation, then edits and posts.
- 2026-04-20 Option C: Add a side-by-side AI draft panel with multiple variants and rationale.
- 2026-04-20 Preferred: Option A. Fastest path, lowest UI weight, matches the beginner-simple requirement, and removes the blank-state burden without adding a second decision.

## Concept Winner
- 2026-04-20 Winner: Option A.
- Structure: Selecting a YouTube result automatically requests one GPT-5.4 comment draft using the selected brand context, video context, and existing social discovery comment prompt. The draft appears directly in the existing `Review and post comment` textarea.
- Loading state: Replace the blank-draft state with `Writing draft...` inline in the current comment area.
- Error state: Show a short inline error above the textarea and keep manual editing available.
- Simplicity rule: No extra button, no alternate draft list, no new review pane. One generated draft, one editable textarea, one post action.
