# Feature: fix-social-discovery-youtube-drafts-not-mentioning-the-selected-

## Request
Fix social discovery YouTube drafts not mentioning the selected brand in the visible textarea and diagnose whether deployment/build is serving old code.
## Autonomy Mode
guided
## Target Users
Primary end user affected by this request
## Optimization Target
Fastest clear MVP with lowest avoidable complexity
## Hard Constraints
[TODO] List hard constraints, non-negotiables, or compliance needs.

## Scope
In scope: Fix social discovery YouTube drafts not mentioning the selected brand in the visible textarea and diagnose whether deployment/build is serving old code. Out of scope: unrelated workflow changes beyond the touched surface and directly supporting behavior.
## Touched Surfaces
- src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- src/app/api/brands/[brandId]/social-discovery/comment-draft/route.ts
- src/app/api/brands/[brandId]/social-discovery/youtube-discovery/route.ts
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
- Scope: In scope: Fix social discovery YouTube drafts not mentioning the selected brand in the visible textarea and diagnose whether deployment/build is serving old code. Out of scope: unrelated workflow changes beyond the touched surface and directly supporting behavior. (source: request_inference; why: Directly stated or tightly implied by the current request, so asking the human again would duplicate supplied intent.)
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-04-21 Implementation summary: Fixed YouTube comment draft brand mention race by passing the server-loaded brand name into SocialDiscoveryClient on first render, so the visible textarea brand guard has the selected brand before social-discovery or YouTube search API responses resolve. Also expanded /api/build-id to return deploymentId and commitSha for deployment verification.
- Files: src/app/brands/[id]/social-discovery/page.tsx, src/app/brands/[id]/social-discovery/social-discovery-client.tsx, src/app/api/build-id/route.ts
- Components: SocialDiscoveryPage, SocialDiscoveryClient, BuildId API
- Assumptions used: Selected brand name from getBrandById is the authoritative brand mention source for this page., Existing ensureBrandMentionInDraft behavior should remain the final visible textarea guard.
## Doc Sync
- 2026-04-21 Synced after implementation.
- Code touched: src/app/brands/[id]/social-discovery/page.tsx, src/app/brands/[id]/social-discovery/social-discovery-client.tsx, src/app/api/build-id/route.ts
