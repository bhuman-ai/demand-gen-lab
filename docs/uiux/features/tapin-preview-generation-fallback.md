# Feature: tapin-preview-generation-fallback

## Request
When TapIn Social understands the campaign goal but live comment generation fails, return a safe best-effort preview from the best available video or target example so campaign setup never dead-ends.
## Autonomy Mode
holistic_autopilot
## Target Users
TapIn Social campaign operators
## Optimization Target
Keep campaign activation available without weakening comment safety or authenticity checks.
## Hard Constraints
- Never post during preview.
- Do not return an empty or unsafe comment.
- Preserve exact brand disclosure requirements for thread replies.
- Prefer a valid model-generated preview
- but never block setup solely because generation failed.
## Scope
Optimize for Keep campaign activation available without weakening comment safety or authenticity checks.. Start with smallest coherent slice that proves When TapIn Social understands the campaign goal but live comment generation fails, return a safe best-effort preview from the best available video or target example so campaign setup never dead-ends..
## Touched Surfaces
- TapIn Social campaign preview API state
## Success Moment
TapIn Social campaign operators completes When TapIn Social understands the campaign goal but live comment generation fails, return a safe best-effort preview from the best available video or target example so campaign setup never dead-ends. and sees explicit confirmation of successful outcome.
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
- Scope: Optimize for Keep campaign activation available without weakening comment safety or authenticity checks.. Start with smallest coherent slice that proves When TapIn Social understands the campaign goal but live comment generation fails, return a safe best-effort preview from the best available video or target example so campaign setup never dead-ends.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
- Success Moment: TapIn Social campaign operators completes When TapIn Social understands the campaign goal but live comment generation fails, return a safe best-effort preview from the best available video or target example so campaign setup never dead-ends. and sees explicit confirmation of successful outcome. (source: agent_assumption; why: Autopilot inferred default for success_moment from request, audience, optimization target, and mode.)
- Failure Policy: Retry inline when safe, preserve context, and escalate to support or fallback path if repeated failure continues. (source: agent_assumption; why: Autopilot inferred default for failure_policy from request, audience, optimization target, and mode.)
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-08-10 Implementation summary: TapIn now retries normal OpenRouter preview generation and, if provider execution, JSON parsing, or strict YouTube style validation still fails, returns a deterministic context-based preview instead of a 502. Comment campaigns receive a standalone comment; thread campaigns receive a native opening plus a topic-first reply with exact brand name and first-person affiliation. Unexpected request failures now log the owning reason.
- Files: src/lib/tapinsocial-preview.ts, src/app/api/webhooks/liftline/preview/route.ts, tests/unit/tapinsocial-preview-openrouter.test.ts
- Components: TapIn preview generator, Liftline preview webhook
- Assumptions used: A safe deterministic example is preferable to blocking campaign activation when only model generation fails., Live posting remains separate from preview generation and is not triggered by this path.
## Doc Sync
- 2026-08-10 Synced after implementation.
- States touched: partial
- Code touched: src/lib/tapinsocial-preview.ts, src/app/api/webhooks/liftline/preview/route.ts, tests/unit/tapinsocial-preview-openrouter.test.ts
