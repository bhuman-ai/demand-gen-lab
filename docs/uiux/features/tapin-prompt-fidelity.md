# Feature: tapin-prompt-fidelity

## Request
Tighten the shipped TapIn prompt-fidelity fix after production verification: preserve every requested factual capability up to two (both AI persona QA and human tester recordings/fixes in the observed prompt), and reject/repair fabricated personal or customer experience such as 'same problem here' while retaining disclosed affiliation and fresh-eyes intent.
## Autonomy Mode
holistic_autopilot
## Target Users
TapIn Social campaign operators
## Optimization Target
Complete safe prompt fidelity
## Hard Constraints
- Include every explicitly requested factual capability up to two
- Do not invent personal or customer experience
- Keep disclosed brand affiliation and direct reply intent
## Scope
Optimize for Faithful, safe campaign prompt execution with no silent generic fallback. Start with smallest coherent slice that proves Fix TapIn Social campaign preview generation so opening and reply prompts are actually followed. Prompt-following drafts must not be rejected by conflicting generic style constraints and replaced with unrelated fallback copy. Preserve safety checks for false claims, but keep the requested topic, opening question/problem, reply intent, brand mention, and requested factual capability details..
## Touched Surfaces
- TapIn Social campaign setup preview
- TapIn Social live comment/thread generation
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
- 2026-08-10 Implementation summary: Production verification follow-up: TapIn now rejects and repairs replies that fabricate personal/customer experience, and deterministically checks requested capability coverage for fresh-eyes language, AI customer-persona QA, human testing, recordings, fixes, and Codex/Claude handoff. Prompt instructions now require every explicitly requested capability up to two rather than allowing the model to omit one.
- Files: src/lib/youtube-comment-style.ts, src/lib/tapinsocial-preview.ts, src/lib/social-discovery.ts, tests/unit/youtube-comment-style.test.ts, tests/unit/tapinsocial-preview-openrouter.test.ts, tests/unit/social-discovery-openrouter.test.ts
- Components: YouTube comment style validator, TapIn preview repair loop, TapIn live social comment planner
- Assumptions used: Capability coverage checks are activated only for explicit terms present in the campaign instructions, Personal-experience rejection is TapIn-specific and does not change default non-TapIn validation
## Doc Sync
- 2026-08-10 Synced after implementation.
- Code touched: src/lib/tapinsocial-preview.ts, src/lib/youtube-comment-style.ts, src/lib/social-discovery.ts, tests/unit/tapinsocial-preview-openrouter.test.ts, tests/unit/youtube-comment-style.test.ts, tests/unit/social-discovery-openrouter.test.ts
- 2026-08-10 Synced after implementation.
- Code touched: src/lib/youtube-comment-style.ts, src/lib/tapinsocial-preview.ts, src/lib/social-discovery.ts, tests/unit/youtube-comment-style.test.ts, tests/unit/tapinsocial-preview-openrouter.test.ts, tests/unit/social-discovery-openrouter.test.ts
