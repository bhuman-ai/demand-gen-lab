# Feature: tapin-preview-real-policy-fallback

## Request
Campaign preview must show the highest-ranked real safe YouTube video even when it falls outside live freshness, subscriber, relevance, or momentum thresholds. Live campaign execution must continue enforcing those rules. A hypothetical preview is allowed only when YouTube returns no usable real video or search cannot run.
## Autonomy Mode
holistic_autopilot
## Target Users
TapIn Social campaign operators
## Optimization Target
Make preview selection truthful and useful by ranking real YouTube results before synthetic examples.
## Hard Constraints
- Live automation keeps the campaign's age
- subscriber
- relevance
- momentum
- and safety rules.
- Preview never chooses news or political surfaces.
- Preview ranks all safe real results from best match down before using a hypothetical target example.
- Do not increase YouTube search quota consumption.
## Scope
Optimize for Make preview selection truthful and useful by ranking real YouTube results before synthetic examples.. Start with smallest coherent slice that proves Campaign preview must show the highest-ranked real safe YouTube video even when it falls outside live freshness, subscriber, relevance, or momentum thresholds. Live campaign execution must continue enforcing those rules. A hypothetical preview is allowed only when YouTube returns no usable real video or search cannot run..
## Touched Surfaces
- TapIn Social campaign preview discovery state
## Success Moment
TapIn Social campaign operators completes Campaign preview must show the highest-ranked real safe YouTube video even when it falls outside live freshness, subscriber, relevance, or momentum thresholds. Live campaign execution must continue enforcing those rules. A hypothetical preview is allowed only when YouTube returns no usable real video or search cannot run. and sees explicit confirmation of successful outcome.
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
- Scope: Optimize for Make preview selection truthful and useful by ranking real YouTube results before synthetic examples.. Start with smallest coherent slice that proves Campaign preview must show the highest-ranked real safe YouTube video even when it falls outside live freshness, subscriber, relevance, or momentum thresholds. Live campaign execution must continue enforcing those rules. A hypothetical preview is allowed only when YouTube returns no usable real video or search cannot run.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
- Success Moment: TapIn Social campaign operators completes Campaign preview must show the highest-ranked real safe YouTube video even when it falls outside live freshness, subscriber, relevance, or momentum thresholds. Live campaign execution must continue enforcing those rules. A hypothetical preview is allowed only when YouTube returns no usable real video or search cannot run. and sees explicit confirmation of successful outcome. (source: agent_assumption; why: Autopilot inferred default for success_moment from request, audience, optimization target, and mode.)
- Failure Policy: Retry inline when safe, preserve context, and escalate to support or fallback path if repeated failure continues. (source: agent_assumption; why: Autopilot inferred default for failure_policy from request, audience, optimization target, and mode.)
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-08-10 Implementation summary: TapIn preview discovery now performs one broad relevance-ordered YouTube search per campaign topic and creates a safe real candidate pool before policy pruning. Videos inside the campaign's age, subscriber, relevance, and momentum thresholds remain policy matches; older or smaller-channel safe videos can be selected only as best-available preview examples. Live discovery behavior and news/political exclusions remain unchanged, and synthetic target examples remain the final fallback.
- Files: src/lib/social-discovery.ts, src/lib/social-discovery-youtube-search.ts, src/lib/tapinsocial-preview-discovery.ts, tests/unit/tapinsocial-preview-discovery.test.ts
- Components: YouTube discovery scoring, TapIn preview candidate ranking
- Assumptions used: Preview may use a real video outside live campaign thresholds as an example, while live execution must still enforce every configured policy., One broad preview search preserves current YouTube quota consumption.
## Doc Sync
- 2026-08-10 Synced after implementation.
- States touched: partial
- Code touched: src/lib/social-discovery.ts, src/lib/social-discovery-youtube-search.ts, src/lib/tapinsocial-preview-discovery.ts, tests/unit/tapinsocial-preview-discovery.test.ts
