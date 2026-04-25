# Feature: social-discovery-youtube-comment-reply-drafts

## Request
Enable YouTube Social Discovery draft style where a top-level comment and delayed reply are generated as a natural pair, with BHuman mentioned exactly once across the pair.
## Autonomy Mode
holistic_autopilot
## Target Users
founder/operator managing social discovery outreach
## Optimization Target
natural YouTube comment thread quality with minimal extra controls
## Hard Constraints
[TODO] List hard constraints, non-negotiables, or compliance needs.

## Scope
Optimize for natural YouTube comment thread quality with minimal extra controls. Start with smallest coherent slice that proves Enable YouTube Social Discovery draft style where a top-level comment and delayed reply are generated as a natural pair, with BHuman mentioned exactly once across the pair..
## Touched Surfaces
- Social Discovery comment composer
- YouTube comment draft generation
## Success Moment
founder/operator managing social discovery outreach completes Enable YouTube Social Discovery draft style where a top-level comment and delayed reply are generated as a natural pair, with BHuman mentioned exactly once across the pair. and sees explicit confirmation of successful outcome.
## Failure Policy
Retry inline when safe, preserve context, and escalate to support or fallback path if repeated failure continues.
## Primary Action
founder/operator managing social discovery outreach should be able to Enable YouTube Social Discovery draft style where a top-level comment and delayed reply are generated as a natural pair, with BHuman mentioned exactly once across the pair. with one obvious first move.
## Primary Risk
founder/operator managing social discovery outreach should not have to guess what matters first or what can go wrong.
## Information Budget
First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown.
## View Model Contract
Primary user: founder/operator managing social discovery outreach
Current decision: Enable YouTube Social Discovery draft style where a top-level comment and delayed reply are generated as a natural pair, with BHuman mentioned exactly once across the pair.
Why now: founder/operator managing social discovery outreach needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: founder/operator managing social discovery outreach should not have to guess what matters first or what can go wrong.
## Concept Options
A. Auto-use comment+reply drafts for YouTube when a second account exists, then show Use single comment as fallback., B. Keep manual Add reply button only., C. Add persistent single/double mode toggle above composer.
## Concept Winner
A. Auto-use comment+reply drafts for YouTube when a second account exists, with Use single comment fallback.
## Decisions
- Scope: Optimize for natural YouTube comment thread quality with minimal extra controls. Start with smallest coherent slice that proves Enable YouTube Social Discovery draft style where a top-level comment and delayed reply are generated as a natural pair, with BHuman mentioned exactly once across the pair.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
- Success Moment: founder/operator managing social discovery outreach completes Enable YouTube Social Discovery draft style where a top-level comment and delayed reply are generated as a natural pair, with BHuman mentioned exactly once across the pair. and sees explicit confirmation of successful outcome. (source: agent_assumption; why: Autopilot inferred default for success_moment from request, audience, optimization target, and mode.)
- Primary Action: founder/operator managing social discovery outreach should be able to Enable YouTube Social Discovery draft style where a top-level comment and delayed reply are generated as a natural pair, with BHuman mentioned exactly once across the pair. with one obvious first move. (source: agent_assumption; why: Autopilot inferred default for primary_action from request, audience, optimization target, and mode.)
- Primary Risk: founder/operator managing social discovery outreach should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for primary_risk from request, audience, optimization target, and mode.)
- Information Budget: First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown. (source: agent_assumption; why: Autopilot inferred default for information_budget from request, audience, optimization target, and mode.)
- View Model Contract: Primary user: founder/operator managing social discovery outreach
Current decision: Enable YouTube Social Discovery draft style where a top-level comment and delayed reply are generated as a natural pair, with BHuman mentioned exactly once across the pair.
Why now: founder/operator managing social discovery outreach needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: founder/operator managing social discovery outreach should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for view_model_contract from request, audience, optimization target, and mode.)
- Failure Policy: Retry inline when safe, preserve context, and escalate to support or fallback path if repeated failure continues. (source: agent_assumption; why: Autopilot inferred default for failure_policy from request, audience, optimization target, and mode.)
- Concept Options: A. Auto-use comment+reply drafts for YouTube when a second account exists, then show Use single comment as fallback., B. Keep manual Add reply button only., C. Add persistent single/double mode toggle above composer. (source: agent_assumption; why: Need concept coverage before code. Options compare automation, minimal UI, and explicit control.)
- Concept Winner: A. Auto-use comment+reply drafts for YouTube when a second account exists, with Use single comment fallback. (source: agent_assumption; why: Best fit for user request. It adds double-comment style without making operator choose another mode every time.)
- Raw agent context (2026-04-25): Concept packet: Options considered: A) auto-use comment+reply drafts for YouTube when second account exists, with Use single comment fallback; B) keep manual Add reply only; C) add a persistent mode toggle. Winner: A. Reason: matches user request with minimal extra controls and keeps one primary action while preserving escape hatch.
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-04-25 Implementation summary: YouTube Social Discovery drafts can now use a comment + delayed reply pair when a second YouTube account exists. The prompt asks GPT to design the pair naturally with exactly one BHuman mention across both comments. The composer auto-enables the reply draft when generated, preserves a Use single comment escape hatch, and validates the brand mention across the combined comment/reply text before posting.
- Files: src/app/brands/[id]/social-discovery/social-discovery-client.tsx, src/lib/social-discovery.ts
- Components: SocialDiscoveryClient, buildSocialCommentPlanningPrompt
- Assumptions used: Default YouTube selected-video drafts should prefer comment+reply when a second account exists., BHuman mention must appear exactly once across the pair, not necessarily in top-level comment.
## Doc Sync
- 2026-04-25 Synced after implementation.
- States touched: partial
- Code touched: src/app/brands/[id]/social-discovery/social-discovery-client.tsx, src/lib/social-discovery.ts
