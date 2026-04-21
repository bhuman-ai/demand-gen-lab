# Feature: vary-youtube-social-discovery-brand-mention-fallback

## Request
Fix YouTube social discovery comment drafts so required brand mentions are varied and contextual off-the-cuff mentions, not the same hardcoded line like 'We see the same at BHuman too.' Remove deterministic canned fallback and prompt example that causes repeated ad-like comments.
## Autonomy Mode
guided
## Target Users
Brand operators drafting YouTube comments from Social Discovery
## Optimization Target
Natural off-the-cuff brand mentions without canned ad phrasing
## Hard Constraints
- Keep selected YouTube drafts requiring the selected brand name once.
- Avoid polished positioning
- product explanations
- and repeated canned template lines.
- Do not change unrelated social discovery behavior.
## Scope
In scope: Fix YouTube social discovery comment drafts so required brand mentions are varied and contextual off-the-cuff mentions, not the same hardcoded line like 'We see the same at BHuman too.' Remove deterministic canned fallback and prompt example that causes repeated ad-like comments. Out of scope: unrelated workflow changes beyond the touched surface and directly supporting behavior.
## Touched Surfaces
- Social Discovery YouTube comment draft editor
- YouTube social discovery draft generation
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
- Scope: In scope: Fix YouTube social discovery comment drafts so required brand mentions are varied and contextual off-the-cuff mentions, not the same hardcoded line like 'We see the same at BHuman too.' Remove deterministic canned fallback and prompt example that causes repeated ad-like comments. Out of scope: unrelated workflow changes beyond the touched surface and directly supporting behavior. (source: request_inference; why: Directly stated or tightly implied by the current request, so asking the human again would duplicate supplied intent.)
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-04-21 Implementation summary: Removed the deterministic hardcoded YouTube brand fallback phrase and the prompt example that encouraged it. Added seeded, context-aware casual brand aside variants so missing-brand safeguards still mention the selected brand once, but the line varies by post and reads like an offhand comment instead of a reusable ad template. Passed the selected post id/url as seed from both server draft generation and client textarea/send guards.
- Files: /Users/don/lastb2b/src/lib/social-discovery-brand-mention.ts, /Users/don/lastb2b/src/lib/social-discovery-comment-prompt.ts, /Users/don/lastb2b/src/lib/social-discovery.ts, /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- Components: SocialDiscoveryClient, YouTube social discovery comment draft generation, social discovery brand mention fallback
- Assumptions used: Selected YouTube drafts should continue to require one selected-brand mention., Fallback brand insertion should be stable per post but varied across posts., The rejected phrase should not remain as a source prompt example or first fallback candidate.
- 2026-04-21 Implementation summary: Extended the same fix to stale saved drafts that already contained the previous canned line. The brand mention sanitizer now rewrites old fallback templates before the client decides the draft already mentions the brand, so existing saved textarea content is also upgraded to a varied offhand mention.
- Files: /Users/don/lastb2b/src/lib/social-discovery-brand-mention.ts, /Users/don/lastb2b/src/lib/social-discovery-comment-prompt.ts, /Users/don/lastb2b/src/lib/social-discovery.ts, /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- Components: SocialDiscoveryClient, YouTube social discovery comment draft generation, social discovery brand mention fallback
- Assumptions used: Existing saved drafts with the old canned line should be rewritten locally instead of left alone just because they already mention the brand.
## Doc Sync
- 2026-04-21 Synced after implementation.
- Code touched: /Users/don/lastb2b/src/lib/social-discovery-brand-mention.ts, /Users/don/lastb2b/src/lib/social-discovery-comment-prompt.ts, /Users/don/lastb2b/src/lib/social-discovery.ts, /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- 2026-04-21 Synced after implementation.
- Code touched: /Users/don/lastb2b/src/lib/social-discovery-brand-mention.ts, /Users/don/lastb2b/src/lib/social-discovery-comment-prompt.ts, /Users/don/lastb2b/src/lib/social-discovery.ts, /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-discovery-client.tsx
