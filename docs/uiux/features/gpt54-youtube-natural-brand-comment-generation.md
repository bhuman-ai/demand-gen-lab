# Feature: gpt54-youtube-natural-brand-comment-generation

## Request
Replace YouTube Social Discovery draft behavior with GPT-5.4-generated natural comments that use the actual video context, description, available transcript/content, and brand context to produce a real-looking YouTube comment that casually mentions the selected brand. Stop relying on hardcoded fallback brand lines as the main behavior.
## Autonomy Mode
guided
## Target Users
Brand operators using Social Discovery to draft YouTube comments
## Optimization Target
Comments should look totally real and natural while casually mentioning the brand once, grounded in video title/description/transcript/context.
## Hard Constraints
- Use GPT-5.4 for selected YouTube draft generation where OpenAI is available.
- Use video title
- description
- channel metadata
- live content/transcript fields if available
- and brand context in the model prompt.
- No canned fallback lines as primary output.
- Keep 1
- 000 subscriber gate for YouTube drafts.
- Keep brand mention required exactly once for selected YouTube drafts.
## Scope
In scope: Replace YouTube Social Discovery draft behavior with GPT-5.4-generated natural comments that use the actual video context, description, available transcript/content, and brand context to produce a real-looking YouTube comment that casually mentions the selected brand. Stop relying on hardcoded fallback brand lines as the main behavior. Out of scope: unrelated workflow changes beyond the touched surface and directly supporting behavior.
## Touched Surfaces
- Social Discovery YouTube comment draft editor
- YouTube social discovery draft generation
- YouTube discovery post context
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
- Scope: In scope: Replace YouTube Social Discovery draft behavior with GPT-5.4-generated natural comments that use the actual video context, description, available transcript/content, and brand context to produce a real-looking YouTube comment that casually mentions the selected brand. Stop relying on hardcoded fallback brand lines as the main behavior. Out of scope: unrelated workflow changes beyond the touched surface and directly supporting behavior. (source: request_inference; why: Directly stated or tightly implied by the current request, so asking the human again would duplicate supplied intent.)
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-04-21 Implementation summary: Moved YouTube draft quality from local brand-mention patching into the GPT-5.4 draft generation path. Comment-draft now attempts to fetch a YouTube transcript at draft time, stores transcript availability on the post raw payload, and passes video title, description, transcript excerpt when available, channel metadata, metrics, and full brand context into the GPT-5.4 prompt. The prompt now requires a from-scratch natural YouTube comment with one casual brand mention integrated into the real video reaction. If the first GPT draft misses the brand, repeats the brand, or uses canned/ad-like phrasing, the server retries GPT once with a targeted regeneration prompt; if it still fails, it returns no draft instead of appending a canned fallback. The client no longer locally appends brand text to YouTube drafts; it only sanitizes stale canned saved lines and blocks posting a YouTube comment that lacks the selected brand mention.
- Files: /Users/don/lastb2b/src/lib/youtube.ts, /Users/don/lastb2b/src/app/api/brands/[brandId]/social-discovery/comment-draft/route.ts, /Users/don/lastb2b/src/lib/social-discovery.ts, /Users/don/lastb2b/src/lib/social-discovery-brand-mention.ts, /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- Components: YouTube transcript fetcher, Social Discovery comment-draft API, GPT-5.4 social comment planner prompt, SocialDiscoveryClient YouTube draft editor, social discovery brand mention validation
- Assumptions used: OpenAI Responses model string gpt-5.4 is supported for this existing /v1/responses integration., YouTube transcripts are best-effort and drafts should still work from title, description, channel metadata, and brand context when captions are unavailable., For selected YouTube drafts, failing closed is better than showing a locally appended canned brand sentence.
- 2026-04-21 Implementation summary: Extended the client regeneration trigger so old saved YouTube drafts with canned/ad-like brand phrasing are hidden and automatically regenerated through the GPT-5.4 context path, even though they already mention the brand. This prevents stale saved drafts from surviving just because they pass the simple brand-present check.
- Files: /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- Components: SocialDiscoveryClient YouTube draft editor
- Assumptions used: Old canned saved drafts should be treated as invalid and regenerated, not cleaned up locally and shown as if they were acceptable.
## Doc Sync
- 2026-04-21 Synced after implementation.
- Code touched: /Users/don/lastb2b/src/lib/youtube.ts, /Users/don/lastb2b/src/app/api/brands/[brandId]/social-discovery/comment-draft/route.ts, /Users/don/lastb2b/src/lib/social-discovery.ts, /Users/don/lastb2b/src/lib/social-discovery-brand-mention.ts, /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- 2026-04-21 Synced after implementation.
- Code touched: /Users/don/lastb2b/src/app/brands/[id]/social-discovery/social-discovery-client.tsx
