# Feature: tapin-preview-generation-fallback

## Request
Polish the deterministic TapIn preview fallback so synthetic target-example title scaffolding never leaks into the visible YouTube comment.
## Autonomy Mode
holistic_autopilot
## Target Users
TapIn Social campaign operators
## Optimization Target
Make the always-available fallback sound like a natural comment about the campaign topic.
## Hard Constraints
- Keep the fallback deterministic and safe.
- Preserve the successful non-blocking preview behavior.
- Do not weaken YouTube comment style validation.
## Scope
Optimize for Keep campaign activation available without weakening comment safety or authenticity checks.. Start with smallest coherent slice that proves When TapIn Social understands the campaign goal but live comment generation fails, return a safe best-effort preview from the best available video or target example so campaign setup never dead-ends..
## Touched Surfaces
- TapIn Social generated comment preview
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
- 2026-08-10 Implementation summary: Polished the deterministic preview fallback by removing synthetic 'Upcoming YouTube video about' title scaffolding before composing the comment. The fallback now speaks directly about the matched campaign topic while retaining the non-blocking, style-safe behavior.
- Files: src/lib/tapinsocial-preview.ts, tests/unit/tapinsocial-preview-openrouter.test.ts
- Components: TapIn preview fallback composer
- Assumptions used: Synthetic target-example titles are internal context and should not appear verbatim in the comment.
## Doc Sync
- 2026-08-10 Synced after implementation.
- States touched: partial
- Code touched: src/lib/tapinsocial-preview.ts, src/app/api/webhooks/liftline/preview/route.ts, tests/unit/tapinsocial-preview-openrouter.test.ts
- 2026-08-10 Synced after implementation.
- Code touched: src/lib/tapinsocial-preview.ts, tests/unit/tapinsocial-preview-openrouter.test.ts
