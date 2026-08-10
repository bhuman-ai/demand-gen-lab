# Feature: tapin-prompt-fidelity

## Request
Fix TapIn Social campaign preview generation so opening and reply prompts are actually followed. Prompt-following drafts must not be rejected by conflicting generic style constraints and replaced with unrelated fallback copy. Preserve safety checks for false claims, but keep the requested topic, opening question/problem, reply intent, brand mention, and requested factual capability details.
## Autonomy Mode
holistic_autopilot
## Target Users
TapIn Social campaign operators
## Optimization Target
Faithful, safe campaign prompt execution with no silent generic fallback
## Hard Constraints
- Do not silently replace a prompt-following draft with unrelated generic copy
- Do not invent first-person product experience or unsupported claims
- Keep exact campaign brand attribution when a brand reply is requested
## Scope
Optimize for Faithful, safe campaign prompt execution with no silent generic fallback. Start with smallest coherent slice that proves Fix TapIn Social campaign preview generation so opening and reply prompts are actually followed. Prompt-following drafts must not be rejected by conflicting generic style constraints and replaced with unrelated fallback copy. Preserve safety checks for false claims, but keep the requested topic, opening question/problem, reply intent, brand mention, and requested factual capability details..
## Touched Surfaces
- TapIn Social campaign setup preview
- TapIn Social comment/thread generation
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
- Scope: Optimize for Faithful, safe campaign prompt execution with no silent generic fallback. Start with smallest coherent slice that proves Fix TapIn Social campaign preview generation so opening and reply prompts are actually followed. Prompt-following drafts must not be rejected by conflicting generic style constraints and replaced with unrelated fallback copy. Preserve safety checks for false claims, but keep the requested topic, opening question/problem, reply intent, brand mention, and requested factual capability details.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-08-10 Implementation summary: TapIn campaign preview and live YouTube generation now preserve every safe opening/reply instruction, allow concise requested factual capability context with disclosed affiliation, and use TapIn-specific 40/48-word envelopes instead of rejecting prompt-following drafts into generic fallback or watch-only behavior. Direct recommendations, invented experience, result guarantees, unsupported claims, and superiority claims remain blocked. Preview repair attempts now retain the rejected draft and repair only the stated validation problem.
- Files: src/lib/tapinsocial-preview.ts, src/lib/youtube-comment-style.ts, src/lib/social-discovery.ts, tests/unit/tapinsocial-preview-openrouter.test.ts, tests/unit/youtube-comment-style.test.ts, tests/unit/social-discovery-openrouter.test.ts
- Components: TapIn preview prompt builder, TapIn preview validator and repair loop, YouTube comment style validator, TapIn live social comment planner
- Assumptions used: Requested factual capabilities are permitted only as concise disclosed context, never as recommendation or unverifiable outcome, Non-TapIn YouTube generation retains the existing default 32/30-word limits
## Doc Sync
- 2026-08-10 Synced after implementation.
- Code touched: src/lib/tapinsocial-preview.ts, src/lib/youtube-comment-style.ts, src/lib/social-discovery.ts, tests/unit/tapinsocial-preview-openrouter.test.ts, tests/unit/youtube-comment-style.test.ts, tests/unit/social-discovery-openrouter.test.ts
