# Feature: tapin-user-prompt-authority

## Request
Remove all hidden TapIn copywriting rules so user-authored opening and reply prompts in the campaign UI are the sole authority over generated wording.
## Autonomy Mode
holistic_autopilot
## Target Users
TapIn Social campaign creators
## Optimization Target
Exact user-prompt control without internal copy interference.
## Hard Constraints
- Keep only structural instructions needed to map UI prompts to output fields and produce valid JSON.
- Supply matched video title and description as context without adding copy policy.
- Do not apply hidden style
- voice
- brand
- affiliation
- capability
- grounding
- punctuation
- length
- or marketing rules to TapIn copy.
## Scope
Optimize for Exact user-prompt control without internal copy interference.. Start with smallest coherent slice that proves Remove all hidden TapIn copywriting rules so user-authored opening and reply prompts in the campaign UI are the sole authority over generated wording..
## Touched Surfaces
- TapIn campaign preview generation
- TapIn live YouTube comment generation
## Success Moment
TapIn Social campaign creators completes Remove all hidden TapIn copywriting rules so user-authored opening and reply prompts in the campaign UI are the sole authority over generated wording. and sees explicit confirmation of successful outcome.
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
- Scope: Optimize for Exact user-prompt control without internal copy interference.. Start with smallest coherent slice that proves Remove all hidden TapIn copywriting rules so user-authored opening and reply prompts in the campaign UI are the sole authority over generated wording.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
- Success Moment: TapIn Social campaign creators completes Remove all hidden TapIn copywriting rules so user-authored opening and reply prompts in the campaign UI are the sole authority over generated wording. and sees explicit confirmation of successful outcome. (source: agent_assumption; why: Autopilot inferred default for success_moment from request, audience, optimization target, and mode.)
- Failure Policy: Retry inline when safe, preserve context, and escalate to support or fallback path if repeated failure continues. (source: agent_assumption; why: Autopilot inferred default for failure_policy from request, audience, optimization target, and mode.)
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-08-10 Implementation summary: Removed TapIn's hidden copy-policy stack at campaign save, preview generation, and live YouTube generation. TapIn now sends only the user-authored opening/reply prompts, matched video context, field mapping, and JSON structure to the model. It no longer injects or enforces style, voice, punctuation, capitalization, length, brand placement, affiliation, capability, grounding, marketing, personal-experience, or fallback-copy rules. Preview and live processing preserve model output text unchanged apart from trimming surrounding whitespace and retry only structurally missing output.
- Files: src/app/api/webhooks/liftline/route.ts, src/lib/tapinsocial-preview.ts, src/lib/social-discovery.ts, tests/unit/tapinsocial-preview-openrouter.test.ts, tests/unit/social-discovery-openrouter.test.ts
- Components: TapIn campaign prompt persistence, TapIn preview generator, TapIn live social comment planner, TapIn structural output validation
- Assumptions used: The UI opening and reply prompts are the sole copy authority., Output field mapping, valid JSON, non-empty required drafts, and matched-video context are technical structure rather than copy policy., Provider failure should surface an error instead of substituting hidden fallback copy.
## Doc Sync
- 2026-08-10 Synced after implementation.
- Code touched: src/app/api/webhooks/liftline/route.ts, src/lib/tapinsocial-preview.ts, src/lib/social-discovery.ts, tests/unit/tapinsocial-preview-openrouter.test.ts, tests/unit/social-discovery-openrouter.test.ts
