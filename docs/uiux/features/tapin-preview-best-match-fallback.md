# Feature: tapin-preview-best-match-fallback

## Request
For TapIn Social campaign setup, never block setup merely because no post clears soft match thresholds. Confirm the campaign target and goal, rank upcoming YouTube candidates from best match down, use the strongest otherwise eligible candidate for the preview, and reserve refusal for genuine hard failures or safety/ineligibility.
## Autonomy Mode
holistic_autopilot
## Target Users
TapIn Social campaign creator
## Optimization Target
Campaign setup always advances with the best safe eligible preview candidate
## Hard Constraints
- Preserve authentication and YouTube API failure errors
- Preserve video age and subscriber eligibility rules
- Preserve context mismatch and sensitive-content safety rejection
- Do not weaken live automation policy; limit fallback to campaign preview setup
## Scope
Optimize for Campaign setup always advances with the best safe eligible preview candidate. Start with smallest coherent slice that proves For TapIn Social campaign setup, never block setup merely because no post clears soft match thresholds. Confirm the campaign target and goal, rank upcoming YouTube candidates from best match down, use the strongest otherwise eligible candidate for the preview, and reserve refusal for genuine hard failures or safety/ineligibility..
## Touched Surfaces
- TapIn Social campaign preview webhook and its no-match/error state
## Success Moment
TapIn Social campaign creator completes For TapIn Social campaign setup, never block setup merely because no post clears soft match thresholds. Confirm the campaign target and goal, rank upcoming YouTube candidates from best match down, use the strongest otherwise eligible candidate for the preview, and reserve refusal for genuine hard failures or safety/ineligibility. and sees explicit confirmation of successful outcome.
## Failure Policy
Retry inline when safe, preserve context, and escalate to support or fallback path if repeated failure continues.
## Primary Action
Continue campaign setup with the strongest available preview.

## Primary Risk
Showing a weak or hypothetical preview as though it were an exact live match.

## Information Budget
Show the generated preview and whether its source is a policy match, best available real video, or hypothetical future target. Keep scores and search diagnostics out of the default setup flow.

## View Model Contract
The campaign creator has already stated the target and goal. TapIn decides which preview source best represents that intent, makes the preview available now, and keeps real posting governed by the campaign's safety and eligibility rules.

## Concept Options
- Block setup until an exact current match appears.
- Use the first current match returned by search.
- Rank all current candidates, then use a labeled hypothetical future target only when no safe real candidate exists.

## Concept Winner
Rank all current candidates, then use a labeled hypothetical future target. It preserves forward progress without pretending a weak or unsafe video is an exact match.

## Decisions
- Scope: Optimize for Campaign setup always advances with the best safe eligible preview candidate. Start with smallest coherent slice that proves For TapIn Social campaign setup, never block setup merely because no post clears soft match thresholds. Confirm the campaign target and goal, rank upcoming YouTube candidates from best match down, use the strongest otherwise eligible candidate for the preview, and reserve refusal for genuine hard failures or safety/ineligibility.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
- Success Moment: TapIn Social campaign creator completes For TapIn Social campaign setup, never block setup merely because no post clears soft match thresholds. Confirm the campaign target and goal, rank upcoming YouTube candidates from best match down, use the strongest otherwise eligible candidate for the preview, and reserve refusal for genuine hard failures or safety/ineligibility. and sees explicit confirmation of successful outcome. (source: agent_assumption; why: Autopilot inferred default for success_moment from request, audience, optimization target, and mode.)
- Failure Policy: Retry inline when safe, preserve context, and escalate to support or fallback path if repeated failure continues. (source: agent_assumption; why: Autopilot inferred default for failure_policy from request, audience, optimization target, and mode.)
## Open Questions
None.

## Design Notes
Preview source precedence is policy match, best available safe real video, then hypothetical future target. Only a total YouTube search failure blocks preview generation.

## Implementation Notes
- 2026-08-10 Implementation summary: TapIn campaign preview discovery now evaluates up to three campaign topics and ranks all returned videos by relevance, momentum, engagement, and provider rank. It uses the strongest policy match, falls back to the strongest safe built candidate when only soft thresholds fail, and uses a clearly labeled hypothetical future-target example when no safe current candidate exists so campaign setup can still continue. Live automation thresholds are unchanged. Authentication/search failures remain hard errors; recent-video, subscriber, context-mismatch, and news/political rules still govern which real videos can be selected.
- Files: src/lib/social-discovery-types.ts, src/lib/social-discovery.ts, src/lib/social-discovery-youtube-search.ts, src/lib/tapinsocial-preview-discovery.ts, src/app/api/webhooks/liftline/preview/route.ts, tests/unit/tapinsocial-preview-discovery.test.ts
- Components: TapIn preview discovery, YouTube discovery result contract, Liftline preview webhook
- Assumptions used: Campaign preview may relax relevance and momentum thresholds but must not weaken live automation policy., If no safe real candidate exists, a clearly hypothetical target example is preferable to blocking campaign setup.
## Doc Sync
- 2026-08-10 Synced after implementation.
- States touched: empty, partial
- Code touched: src/lib/social-discovery-types.ts, src/lib/social-discovery.ts, src/lib/social-discovery-youtube-search.ts, src/lib/tapinsocial-preview-discovery.ts, src/app/api/webhooks/liftline/preview/route.ts, tests/unit/tapinsocial-preview-discovery.test.ts
