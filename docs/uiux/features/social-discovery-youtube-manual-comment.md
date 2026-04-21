# Feature: social-discovery-youtube-manual-comment

## Request
Ensure the visible YouTube comment draft always includes the selected short brand name, such as BHuman, before the user posts. Add a client-side guarantee so stale or noncompliant server drafts are rewritten locally in the textarea.
## Autonomy Mode
guided
## Target Users
founder/operator
## Optimization Target
decision speed
## Hard Constraints
- Keep single-comment mode unchanged
- Keep teammate reply mode simple and low-clutter
- Use existing background job or scheduler patterns if available
- Do not imply immediate second reply in UI
## Scope
Optimize for decision speed with one primary action. Start with smallest coherent slice that proves Emergency override UI implementation for social discovery. Add the simplest YouTube manual-comment path for a core unit video lead workflow: search a niche, see videos with subscriber counts, pick one video, and use the existing comment composer/manual comment button. Scope is search + review + manual comment button only. Reduce visible controls and hide promotional clutter on the YouTube path..
## Touched Surfaces
- social-discovery-youtube-manual-comment
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
- 2026-04-20 Implementation summary: Added a simple optional two-level YouTube thread flow. The main comment still auto-generates on video selection. Operators can now reveal one teammate-reply block, choose a second YouTube account, use an auto-generated reply draft, and post the top comment plus one reply in sequence. Backend now supports YouTube replies via comments.insert and stores nested reply delivery under the primary comment delivery while preserving the main comment as the primary record. If the main comment succeeds but the reply fails, the UI shows a warning instead of implying the whole action failed.
- Files: src/lib/social-discovery-types.ts, src/lib/social-discovery-data.ts, src/lib/youtube.ts, src/lib/social-discovery.ts, src/lib/social-discovery-comment-delivery.ts, src/app/api/brands/[brandId]/social-discovery/comment/route.ts, src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- Components: SocialDiscoveryClient
- 2026-04-20 Implementation summary: Changed GPT draft generation for YouTube to explicit modes. Default mode is solo: only one standalone top-level comment is generated. When teammate reply mode is enabled, the client requests a thread-mode regeneration so GPT rewrites both messages together as a coordinated two-comment flow where the first comment sets up the second reply naturally. Turning teammate reply mode off regenerates the solo draft again. UI keeps teammate reply hidden until enabled.
- Files: src/lib/social-discovery.ts, src/app/api/brands/[brandId]/social-discovery/comment-draft/route.ts, src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- Components: SocialDiscoveryClient
- 2026-04-20 Implementation summary: Changed two-comment YouTube thread mode so the second account reply is queued, not posted immediately. When thread mode is used, the first comment posts now and the second reply is scheduled for a random delay between 1 and 6 hours later. The post stores a pending teammate reply payload with scheduled time and account, an internal YouTube maintenance tick drains due replies, and the maintenance cron was tightened to hourly so delayed replies run close to schedule. UI now says the teammate reply posts later and shows scheduled or failed state instead of implying immediate posting.
- Files: src/lib/social-discovery-types.ts, src/lib/social-discovery-data.ts, src/lib/social-discovery-comment-delivery.ts, src/app/api/internal/social-discovery/youtube-subscriptions/route.ts, src/app/brands/[id]/social-discovery/social-discovery-client.tsx, vercel.json
- Components: SocialDiscoveryClient
- 2026-04-20 Implementation summary: Changed two-comment YouTube thread mode so the second account reply is queued, not posted immediately. When thread mode is used, the first comment posts now and the second reply is scheduled for a random delay between 1 and 6 hours later. The post stores a pending teammate reply payload with scheduled time and account, an internal YouTube maintenance tick drains due replies, and the maintenance cron now runs every 15 minutes so delayed replies execute close to schedule. UI now says the teammate reply posts later and shows scheduled or failed state instead of implying immediate posting.
- Files: src/lib/social-discovery-types.ts, src/lib/social-discovery-data.ts, src/lib/social-discovery-comment-delivery.ts, src/app/api/internal/social-discovery/youtube-subscriptions/route.ts, src/app/brands/[id]/social-discovery/social-discovery-client.tsx, vercel.json
- Components: SocialDiscoveryClient
- 2026-04-20 Implementation summary: Manual YouTube search now hides off-topic or watch-only results before they reach the pick list. Search summary tells the user how many results were hidden, and if a selected video still cannot produce a draft the composer now says it is off-topic for the brand instead of showing a vague no-clean-draft dead end.
- Files: /Users/don/lastb2b/src/app/api/brands/[brandId]/social-discovery/youtube-discovery/route.ts, /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- Components: SocialDiscoveryClient
- 2026-04-21 Implementation summary: Mode 1 manual YouTube search no longer exposes a watch-only state. Search results are filtered to draft-ready comment targets only, non-draftable or off-topic videos stay hidden, and the picker/composer language now uses plain draft-ready or off-topic wording instead of watch-only.
- Files: /Users/don/lastb2b/src/app/api/brands/[brandId]/social-discovery/youtube-discovery/route.ts, /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- Components: SocialDiscoveryClient
- 2026-04-21 Implementation summary: Manual YouTube Mode 1 now treats selection as an instruction to write a comment for that exact video. The GPT prompt requires a non-empty commentDraft and shouldComment=true, the forced refresh ignores no-comment answers, and the UI no longer exposes no-draft/off-topic/watch-only states. Search says pick one to draft, selected videos show Writing draft while GPT works, and only a technical retry message appears if the AI response is malformed.
- Files: /Users/don/lastb2b/src/lib/social-discovery.ts, /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- Components: SocialDiscoveryClient
- 2026-04-21 Implementation summary: Manual YouTube search now bypasses social-discovery brand-fit filtering. The YouTube discovery API saves and returns every fetched YouTube result as a selectable draft target, with a default target interaction plan. GPT drafting remains selected-video driven after the user clicks a result.
- Files: /Users/don/lastb2b/src/app/api/brands/[brandId]/social-discovery/youtube-discovery/route.ts
- Components: SocialDiscoveryClient
- 2026-04-21 Implementation summary: Selected-video YouTube comment drafting now requires a subtle selected-brand mention. Force-mode GPT prompt tells the planner to mention the brand exactly once in the natural place, overriding heuristic no-mention policy. A post-processing guard adds a short soft bridge with the brand name if GPT returns a draft without the selected brand.
- Files: /Users/don/lastb2b/src/lib/social-discovery.ts
- Components: SocialDiscoveryCommentPlanner
- 2026-04-21 Implementation summary: Manual YouTube search and drafting now require channels to have more than 1,000 subscribers. The YouTube search route filters fetched results before saving/showing them, the client also filters stale cached YouTube posts below the threshold, and the comment-draft API refuses to generate drafts for stale low-subscriber YouTube posts.
- Files: /Users/don/lastb2b/src/app/api/brands/[brandId]/social-discovery/youtube-discovery/route.ts, /Users/don/lastb2b/src/app/api/brands/[brandId]/social-discovery/comment-draft/route.ts, /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- Components: SocialDiscoveryClient
- 2026-04-21 Implementation summary: Selected-video YouTube drafts now use the short selected brand name, such as BHuman from a full breadcrumb-style brand name. The YouTube discovery route returns brand name metadata, and the client auto-regenerates a selected YouTube draft once if the saved draft does not mention the selected brand, fixing stale pre-prompt drafts that lacked a brand mention.
- Files: /Users/don/lastb2b/src/lib/social-discovery.ts, /Users/don/lastb2b/src/app/api/brands/[brandId]/social-discovery/youtube-discovery/route.ts, /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- Components: SocialDiscoveryClient, SocialDiscoveryCommentPlanner
- 2026-04-21 Implementation summary: The visible YouTube comment textarea now uses a client-side brand-guaranteed draft. Auto-filled drafts are rewritten locally to include the selected short brand name before display or restore, so stale server drafts without the selected brand no longer remain visible in the textarea.
- Files: /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- Components: SocialDiscoveryClient
- 2026-04-21 Implementation summary: The visible YouTube comment field is now bound to a brand-enforced draft value. If the current comment text lacks the selected short brand name, the client immediately rewrites the live comment state and the displayed textarea value, and sendComment posts the brand-fixed version as the final payload.
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
- 2026-04-20 Synced after implementation.
- Code touched: /Users/don/lastb2b/src/lib/social-discovery-comment-prompt.ts, /Users/don/lastb2b/src/lib/social-discovery.ts, /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- 2026-04-20 Synced after implementation.
- States touched: loading, partial
- Code touched: src/lib/social-discovery.ts, src/app/api/brands/[brandId]/social-discovery/comment-draft/route.ts, src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- 2026-04-20 Synced after implementation.
- States touched: partial
- Code touched: src/lib/social-discovery-types.ts, src/lib/social-discovery-data.ts, src/lib/youtube.ts, src/lib/social-discovery.ts, src/lib/social-discovery-comment-delivery.ts, src/app/api/brands/[brandId]/social-discovery/comment/route.ts, src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- 2026-04-20 Synced after implementation.
- States touched: partial
- Code touched: src/lib/social-discovery.ts, src/app/api/brands/[brandId]/social-discovery/comment-draft/route.ts, src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- 2026-04-20 Synced after implementation.
- States touched: partial
- Code touched: src/lib/social-discovery-types.ts, src/lib/social-discovery-data.ts, src/lib/social-discovery-comment-delivery.ts, src/app/api/internal/social-discovery/youtube-subscriptions/route.ts, src/app/brands/[id]/social-discovery/social-discovery-client.tsx, vercel.json
- 2026-04-20 Synced after implementation.
- States touched: partial
- Code touched: src/lib/social-discovery-types.ts, src/lib/social-discovery-data.ts, src/lib/social-discovery-comment-delivery.ts, src/app/api/internal/social-discovery/youtube-subscriptions/route.ts, src/app/brands/[id]/social-discovery/social-discovery-client.tsx, vercel.json
- 2026-04-20 Synced after implementation.
- States touched: empty, partial
- Code touched: /Users/don/lastb2b/src/app/api/brands/[brandId]/social-discovery/youtube-discovery/route.ts, /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- 2026-04-21 Synced after implementation.
- States touched: empty, partial
- Code touched: /Users/don/lastb2b/src/app/api/brands/[brandId]/social-discovery/youtube-discovery/route.ts, /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- 2026-04-21 Synced after implementation.
- States touched: loading, error
- Code touched: /Users/don/lastb2b/src/lib/social-discovery.ts, /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- 2026-04-21 Synced after implementation.
- States touched: empty
- Code touched: /Users/don/lastb2b/src/app/api/brands/[brandId]/social-discovery/youtube-discovery/route.ts
- 2026-04-21 Synced after implementation.
- Code touched: /Users/don/lastb2b/src/lib/social-discovery.ts
- 2026-04-21 Synced after implementation.
- States touched: empty, error
- Code touched: /Users/don/lastb2b/src/app/api/brands/[brandId]/social-discovery/youtube-discovery/route.ts, /Users/don/lastb2b/src/app/api/brands/[brandId]/social-discovery/comment-draft/route.ts, /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- 2026-04-21 Synced after implementation.
- States touched: loading
- Code touched: /Users/don/lastb2b/src/lib/social-discovery.ts, /Users/don/lastb2b/src/app/api/brands/[brandId]/social-discovery/youtube-discovery/route.ts, /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- 2026-04-21 Synced after implementation.
- Code touched: /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- 2026-04-21 Synced after implementation.
- Code touched: /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-discovery-client.tsx
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
