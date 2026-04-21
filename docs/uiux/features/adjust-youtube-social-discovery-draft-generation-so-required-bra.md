# Feature: adjust-youtube-social-discovery-draft-generation-so-required-bra

## Request
Adjust YouTube social discovery draft generation so required brand mentions read like off-the-cuff casual mentions instead of ads or polished positioning lines.
## Autonomy Mode
guided
## Target Users
Primary end user affected by this request
## Optimization Target
Fastest clear MVP with lowest avoidable complexity
## Hard Constraints
[TODO] List hard constraints, non-negotiables, or compliance needs.

## Scope
In scope: Adjust YouTube social discovery draft generation so required brand mentions read like off-the-cuff casual mentions instead of ads or polished positioning lines. Out of scope: unrelated workflow changes beyond the touched surface and directly supporting behavior.
## Touched Surfaces
- src/lib/social-discovery.ts
- src/app/brands/[id]/social-discovery/social-discovery-client.tsx
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
- Scope: In scope: Adjust YouTube social discovery draft generation so required brand mentions read like off-the-cuff casual mentions instead of ads or polished positioning lines. Out of scope: unrelated workflow changes beyond the touched surface and directly supporting behavior. (source: request_inference; why: Directly stated or tightly implied by the current request, so asking the human again would duplicate supplied intent.)
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-04-21 Implementation summary: Changed YouTube social discovery brand mention behavior from polished brand-bridge copy to casual off-the-cuff side-note mentions. Added a shared brand mention helper used by both server draft generation and client textarea fallback so missing-brand fixes now append casual lines like 'We see the same at BRAND too.' Tightened the default social discovery comment prompt and the selected-video planning prompt to explicitly ban polished positioning, feature stacks, and ad-style bridge sentences.
- Files: src/lib/social-discovery-brand-mention.ts, src/lib/social-discovery-comment-prompt.ts, src/lib/social-discovery.ts, src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- Components: Social discovery comment prompt, SocialDiscoveryClient, YouTube draft planning
- Assumptions used: Required brand mentions should stay enforced for selected YouTube drafts., A first-person aside from the brand account is more natural than a third-person product sentence.
## Doc Sync
- 2026-04-21 Synced after implementation.
- Code touched: src/lib/social-discovery-brand-mention.ts, src/lib/social-discovery-comment-prompt.ts, src/lib/social-discovery.ts, src/app/brands/[id]/social-discovery/social-discovery-client.tsx
