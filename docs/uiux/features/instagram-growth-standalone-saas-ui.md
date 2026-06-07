# Feature: instagram-growth-standalone-saas-ui

## Request
Revise the Instagram Growth UI so it does not look like LastB2B-branded internal software. Make it read as a standalone SaaS product marketers could buy to grow their Instagram/brand, while keeping safe manual approval and account-health guardrails.
## Autonomy Mode
guided
## Target Users
Instagram marketers, creators, founders, and brand operators who want a focused SaaS workflow for finding and approving Instagram growth comments.
## Optimization Target
Standalone SaaS brand feel without changing backend posting behavior or exposing internal provider/debug details.
## Hard Constraints
- Do not expose LastB2B branding or internal debug/provider concepts in the standalone UI.
- Keep manual approval
- cooldown
- and account-health guardrails.
- Reuse existing Instagram opportunity data and comment posting API.
- Avoid deceptive spam/engagement-buying product promises.
## Scope
In scope: Revise the Instagram Growth UI so it does not look like LastB2B-branded internal software. Make it read as a standalone SaaS product marketers could buy to grow their Instagram/brand, while keeping safe manual approval and account-health guardrails. Out of scope: unrelated workflow changes beyond the touched surface and directly supporting behavior.
## Touched Surfaces
- /brands/[id]/instagram-growth
- AppShell navigation entry if still relevant
## Success Moment
[TODO] Define exact user outcome that proves this feature works.

## Failure Policy
[TODO] Describe recovery path on failure.

## Primary Action
Approve and post one relevant Instagram comment from a healthy account.
## Primary Risk
The page could either feel like LastB2B internal tooling or imply unsafe growth automation. The UI must instead feel like a focused SaaS product with manual review, account health, and conservative posting limits visible.
## Information Budget
First screen earns: product identity, brand/account context, queue state counts, selected opportunity, comment draft, selected account health, and approve/post controls. Secondary: source/import link, skipped/posted states, risk notes, and original post link. Hidden: OAuth/provider names, token details, internal discovery/debug controls, and promotion-purchase mechanics.
## View Model Contract
Primary user: Instagram marketer or founder. Current decision: which opportunity should be approved now. Why now: the post is timely and already has a draft comment. Next action: edit if needed, choose a healthy account, then post the approved comment. Top risk: accidental low-quality or too-frequent engagement, so health/cooldown and risk notes must remain visible.
## Concept Options
1. Standalone Console: chromeless route with its own top product bar, segmented queue state controls, left queue, right approval composer, and account health rail.
2. Marketing Landing + Embedded Demo: first viewport explains the product, then embeds the queue below. Rejected because it delays the working product and risks generic SaaS marketing chrome.
3. Wizard Setup Flow: connect account, source posts, approve first comment. Rejected for this pass because existing users may already have opportunities and need a working review queue immediately.
## Concept Winner
Choose Concept 1, Standalone Console. It best satisfies the user's direction because it removes LastB2B chrome while preserving the operational workflow. The route gets a distinct SaaS product identity, but keeps the queue/composer/account-health contract intact.
## Decisions
- Scope: In scope: Revise the Instagram Growth UI so it does not look like LastB2B-branded internal software. Make it read as a standalone SaaS product marketers could buy to grow their Instagram/brand, while keeping safe manual approval and account-health guardrails. Out of scope: unrelated workflow changes beyond the touched surface and directly supporting behavior. (source: request_inference; why: Directly stated or tightly implied by the current request, so asking the human again would duplicate supplied intent.)
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
Standalone brand direction: working name Reachloop; calm light SaaS palette with ink, white surfaces, green primary, clay secondary accent, and explicit success/warning/danger states. Use no LastB2B wordmark, sidebar, breadcrumb, command palette, or operator controls on this route. Layout follows a focused SaaS productivity console: horizontal product bar, compact state controls, queue list, review composer, and health/risk sidebar. Cards stay at 8px radius or less, no gradients, no decorative glows, no internal-provider labels.
2026-06-07 naming update: The standalone product name changed from Reachloop to Liftline after the public homepage naming pass. Liftline is now the active brand shown in the public homepage and the Instagram growth desk.
## Implementation Notes
- 2026-06-07 Implementation summary: Converted /brands/[id]/instagram-growth into a chromeless standalone SaaS surface. Added route-specific metadata, a Reachloop-branded top bar, local light SaaS palette, state filters, empty onboarding state, queue/review layout, composer/account-health/risk sections, and guarded post/skip actions. AppShell now bypasses LastB2B sidebar/header for this route while keeping the rest of the app shell unchanged.
- Files: src/app/brands/[id]/instagram-growth/page.tsx, src/app/brands/[id]/instagram-growth/instagram-growth-client.tsx, src/app/brands/[id]/instagram-growth/instagram-growth.module.css, src/components/layout/app-shell.tsx, docs/uiux/features/instagram-growth-standalone-saas-ui.md
- Components: AppShell chromeless route handling, InstagramGrowthPage metadata, InstagramGrowthClient standalone SaaS shell, Reachloop local CSS module
- Assumptions used: The route can remain under /brands/[id]/instagram-growth while visually behaving as a standalone SaaS product., Reachloop is a temporary standalone product name for the Instagram growth desk surface., The existing social-discovery API remains the correct backend for posting approved comments., The default buyer-facing UI should hide LastB2B shell chrome and provider/debug language while preserving manual approval and account-health guardrails.
## Doc Sync
- 2026-06-07 Synced after implementation.
- States touched: empty, error, partial
- Code touched: src/app/brands/[id]/instagram-growth/page.tsx, src/app/brands/[id]/instagram-growth/instagram-growth-client.tsx, src/app/brands/[id]/instagram-growth/instagram-growth.module.css, src/components/layout/app-shell.tsx, docs/uiux/features/instagram-growth-standalone-saas-ui.md
