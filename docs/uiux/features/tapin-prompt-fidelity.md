# Feature: tapin-prompt-fidelity

## Request
Remove the remaining one-capability-clause contradiction and add a deterministic safe reply repair that preserves every explicitly recognized requested capability after three model attempts, using disclosed affiliation and no recommendation, fake experience, guarantee, or superiority claim.
## Autonomy Mode
holistic_autopilot
## Target Users
TapIn Social campaign operators
## Optimization Target
Guaranteed prompt capability coverage without generic fallback
## Hard Constraints
- Every explicitly recognized requested capability is retained
- Reply remains disclosed and non-promotional
- Model omission cannot trigger generic fallback
## Scope
Optimize for Faithful, safe campaign prompt execution with no silent generic fallback. Start with smallest coherent slice that proves Fix TapIn Social campaign preview generation so opening and reply prompts are actually followed. Prompt-following drafts must not be rejected by conflicting generic style constraints and replaced with unrelated fallback copy. Preserve safety checks for false claims, but keep the requested topic, opening question/problem, reply intent, brand mention, and requested factual capability details..
## Touched Surfaces
- TapIn Social campaign preview generation
## Success Moment
TapIn Social campaign operators completes Fix the production-discovered grounding contradiction: TapIn opening validation must accept support from the video title or description, validate reply safety and requested capability coverage before treating grounding as soft, and return the last complete safe prompt-faithful draft rather than unrelated deterministic fallback when only soft grounding remains. and sees explicit confirmation of successful outcome.
## Failure Policy
Retry inline when safe, preserve context, and escalate to support or fallback path if repeated failure continues.
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
- Success Moment: TapIn Social campaign operators completes Fix the production-discovered grounding contradiction: TapIn opening validation must accept support from the video title or description, validate reply safety and requested capability coverage before treating grounding as soft, and return the last complete safe prompt-faithful draft rather than unrelated deterministic fallback when only soft grounding remains. and sees explicit confirmation of successful outcome. (source: agent_assumption; why: Autopilot inferred default for success_moment from request, audience, optimization target, and mode.)
- Failure Policy: Retry inline when safe, preserve context, and escalate to support or fallback path if repeated failure continues. (source: agent_assumption; why: Autopilot inferred default for failure_policy from request, audience, optimization target, and mode.)
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-08-10 Implementation summary: TapIn campaign preview and live YouTube generation now preserve every safe opening/reply instruction, allow concise requested factual capability context with disclosed affiliation, and use TapIn-specific 40/48-word envelopes instead of rejecting prompt-following drafts into generic fallback or watch-only behavior. Direct recommendations, invented experience, result guarantees, unsupported claims, and superiority claims remain blocked. Preview repair attempts now retain the rejected draft and repair only the stated validation problem.
- Files: src/lib/tapinsocial-preview.ts, src/lib/youtube-comment-style.ts, src/lib/social-discovery.ts, tests/unit/tapinsocial-preview-openrouter.test.ts, tests/unit/youtube-comment-style.test.ts, tests/unit/social-discovery-openrouter.test.ts
- Components: TapIn preview prompt builder, TapIn preview validator and repair loop, YouTube comment style validator, TapIn live social comment planner
- Assumptions used: Requested factual capabilities are permitted only as concise disclosed context, never as recommendation or unverifiable outcome, Non-TapIn YouTube generation retains the existing default 32/30-word limits
- 2026-08-10 Implementation summary: Production verification follow-up: TapIn now rejects and repairs replies that fabricate personal/customer experience, and deterministically checks requested capability coverage for fresh-eyes language, AI customer-persona QA, human testing, recordings, fixes, and Codex/Claude handoff. Prompt instructions now require every explicitly requested capability up to two rather than allowing the model to omit one.
- Files: src/lib/youtube-comment-style.ts, src/lib/tapinsocial-preview.ts, src/lib/social-discovery.ts, tests/unit/youtube-comment-style.test.ts, tests/unit/tapinsocial-preview-openrouter.test.ts, tests/unit/social-discovery-openrouter.test.ts
- Components: YouTube comment style validator, TapIn preview repair loop, TapIn live social comment planner
- Assumptions used: Capability coverage checks are activated only for explicit terms present in the campaign instructions, Personal-experience rejection is TapIn-specific and does not change default non-TapIn validation
- 2026-08-10 Implementation summary: Production grounding follow-up: preview grounding now accepts any concrete token from the video title or description, matching the stated contract. All hard gates (style, complete thread, requested capability coverage, exact brand, affiliation, and incidental placement) run before grounding. If repeated drafts pass every hard gate but miss only soft lexical grounding, TapIn returns the last safe prompt-faithful draft rather than unrelated deterministic fallback.
- Files: src/lib/tapinsocial-preview.ts, tests/unit/tapinsocial-preview-openrouter.test.ts
- Components: TapIn preview grounding validator, TapIn preview validation and fallback selection
- Assumptions used: Lexical grounding is a soft quality signal after prompt fidelity and safety pass, Provider unavailability with no safe generated candidate still uses the deterministic video-grounded fallback
- 2026-08-10 Implementation summary: Final production follow-up: preview generation now preserves explicitly requested product capability details deterministically when repeated model repair attempts omit them. It keeps a prompt-faithful opening, discloses the brand affiliation, avoids fabricated personal experience, and includes requested AI customer-persona QA plus human-testing deliverables.
- Files: src/lib/tapinsocial-preview.ts, src/lib/youtube-comment-style.ts, tests/unit/tapinsocial-preview-openrouter.test.ts
- Components: TapIn preview capability repair, YouTube comment style rules
- Assumptions used: Explicit capability details in the user's reply prompt should survive model omissions., A deterministic, disclosed brand reply is preferable to a generic fallback when it passes hard safety validation.
## Doc Sync
- 2026-08-10 Synced after implementation.
- Code touched: src/lib/tapinsocial-preview.ts, src/lib/youtube-comment-style.ts, src/lib/social-discovery.ts, tests/unit/tapinsocial-preview-openrouter.test.ts, tests/unit/youtube-comment-style.test.ts, tests/unit/social-discovery-openrouter.test.ts
- 2026-08-10 Synced after implementation.
- Code touched: src/lib/youtube-comment-style.ts, src/lib/tapinsocial-preview.ts, src/lib/social-discovery.ts, tests/unit/youtube-comment-style.test.ts, tests/unit/tapinsocial-preview-openrouter.test.ts, tests/unit/social-discovery-openrouter.test.ts
- 2026-08-10 Synced after implementation.
- Code touched: src/lib/tapinsocial-preview.ts, tests/unit/tapinsocial-preview-openrouter.test.ts
- 2026-08-10 Synced after implementation.
- Code touched: src/lib/tapinsocial-preview.ts, src/lib/youtube-comment-style.ts, tests/unit/tapinsocial-preview-openrouter.test.ts
