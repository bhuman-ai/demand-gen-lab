# Feature: tapin-user-authored-prompts

## Request
Remove the internal rule that automatically inserts first-person brand affiliation language such as 'I work on'. Users must control this wording through the opening and reply prompts they write in the campaign UI.
## Autonomy Mode
holistic_autopilot
## Target Users
TapIn Social campaign creators
## Optimization Target
Make generated comments follow user-authored prompts without hidden copy injection.
## Hard Constraints
- Do not insert or require first-person affiliation unless the user prompt requests it.
- Retain safety against fabricated personal usage or customer-result claims.
- Preserve user-requested brand mentions and capability details.
## Scope
Optimize for Make generated comments follow user-authored prompts without hidden copy injection.. Start with smallest coherent slice that proves Remove the internal rule that automatically inserts first-person brand affiliation language such as 'I work on'. Users must control this wording through the opening and reply prompts they write in the campaign UI..
## Touched Surfaces
- TapIn campaign preview generation
- TapIn live YouTube comment generation
## Success Moment
[TODO] Define exact user outcome that proves this feature works.

## Failure Policy
[TODO] Describe recovery path on failure.

## Primary Action
[TODO] Define the one action or decision that must feel obvious first.

## Primary Risk
[TODO] Define the main confusion, trust, or failure risk.

## Information Budget
[TODO] Define what earns the first screen and what stays hidden until asked.

## View Model Contract
[TODO] Record primary user, current decision, why now, next action, and top risk.

## Concept Options
[TODO] Capture at least three structural concepts or ASCII wireframe directions.

## Concept Winner
[TODO] Record the chosen concept and why it beats the alternatives.

## Decisions
- Scope: Optimize for Make generated comments follow user-authored prompts without hidden copy injection.. Start with smallest coherent slice that proves Remove the internal rule that automatically inserts first-person brand affiliation language such as 'I work on'. Users must control this wording through the opening and reply prompts they write in the campaign UI.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-08-10 Implementation summary: Removed hidden first-person brand affiliation requirements from TapIn preview and live YouTube generation. Shared prompts no longer instruct the model to say 'I work on', validators no longer reject neutral brand mentions, and deterministic preview fallback uses neutral user-requested capability framing. Added a guard that rejects first-person affiliation when the campaign prompt did not request it while still allowing explicit user-authored disclosure instructions.
- Files: src/lib/tapinsocial-preview.ts, src/lib/youtube-comment-style.ts, src/lib/social-discovery.ts, tests/unit/tapinsocial-preview-openrouter.test.ts, tests/unit/youtube-comment-style.test.ts, tests/unit/social-discovery-openrouter.test.ts
- Components: TapIn preview prompt builder and repair loop, TapIn deterministic preview fallback, YouTube comment style rules and validators, TapIn live social comment planner
- Assumptions used: First-person affiliation wording is generated only when explicitly requested in the user's campaign prompt., Neutral factual brand capability wording remains allowed when requested., Fabricated personal usage, results, recommendations, guarantees, and superiority claims remain blocked.
## Doc Sync
- 2026-08-10 Synced after implementation.
- Code touched: src/lib/tapinsocial-preview.ts, src/lib/youtube-comment-style.ts, src/lib/social-discovery.ts, tests/unit/tapinsocial-preview-openrouter.test.ts, tests/unit/youtube-comment-style.test.ts, tests/unit/social-discovery-openrouter.test.ts
