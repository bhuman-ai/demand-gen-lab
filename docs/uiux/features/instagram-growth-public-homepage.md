# Feature: instagram-growth-public-homepage

## Request
Design and implement a public standalone SaaS homepage for the Instagram growth/comment approval app, including better product naming and brand direction. It should not use LastB2B branding and should market the product to Instagram creators/brands as a safe manual growth workflow.
## Autonomy Mode
guided
## Target Users
Instagram creators, small brands, creator-led founders, and marketers evaluating a standalone SaaS tool for finding timely posts and manually approving useful comments.
## Optimization Target
Create a buyer-ready homepage with a stronger product name, clear safe-growth positioning, app preview, and CTA into the existing standalone app route.
## Hard Constraints
- Do not replace the existing LastB2B root homepage.
- Do not use LastB2B branding on the standalone homepage.
- Avoid spammy growth promises
- engagement-buying language
- or deceptive automation claims.
- Use visual assets or an image-led/immersive hero per website guidance.
- Keep the working app route/backend unchanged unless needed for naming consistency.
## Scope
In scope: Design and implement a public standalone SaaS homepage for the Instagram growth/comment approval app, including better product naming and brand direction. It should not use LastB2B branding and should market the product to Instagram creators/brands as a safe manual growth workflow. Out of scope: unrelated workflow changes beyond the touched surface and directly supporting behavior.
## Touched Surfaces
- new public homepage route for standalone social-growth app
- AppShell chromeless route handling
## Success Moment
[TODO] Define exact user outcome that proves this feature works.

## Failure Policy
[TODO] Describe recovery path on failure.

## Primary Action
Visitor understands the product and clicks into the live Instagram growth desk/demo.
## Primary Risk
The homepage could sound like spam automation or engagement manipulation. Copy must position the product as a manual approval workflow that finds relevant moments, helps write useful comments, and protects account health.
## Information Budget
First viewport: product name Liftline, concise value proposition, safe manual approval promise, CTA to open the app, and a real product-preview visual. Below the fold: how it works, why it is safer than blind automation, product states, and alternative names. Hide backend/provider details and do not discuss token/account implementation.
## View Model Contract
[TODO] Record primary user, current decision, why now, next action, and top risk.

## Concept Options
1. Image-led Product Homepage: full-bleed first viewport with generated product/creator workspace imagery, product name as H1, direct CTA, and a product preview below. Best for marketing and brand separation.
2. Dense SaaS Feature Page: top nav, feature grid, testimonials, pricing-like blocks. Rejected because it feels generic before the product identity is set.
3. App-First Demo Landing: route opens directly into a demo console with marketing copy in a side rail. Rejected because it blurs marketing page and working app screen.
## Concept Winner
Choose Concept 1, Image-led Product Homepage. It creates a standalone SaaS identity quickly, satisfies website visual-asset requirements, keeps the H1 as the product name, and leaves the working app as a clear second step.
## Decisions
- Scope: In scope: Design and implement a public standalone SaaS homepage for the Instagram growth/comment approval app, including better product naming and brand direction. It should not use LastB2B branding and should market the product to Instagram creators/brands as a safe manual growth workflow. Out of scope: unrelated workflow changes beyond the touched surface and directly supporting behavior. (source: request_inference; why: Directly stated or tightly implied by the current request, so asking the human again would duplicate supplied intent.)
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
Implemented brand direction should use product name Liftline. Alternatives considered: Reachline, Momentdesk, Replywell, Signalpost, Postline, Audience Desk. Liftline wins because it is short, growth-oriented, queue-compatible, and less spammy than comment-focused names. Visual language: image-led first viewport, warm off-white/ink/forest/clay palette, 8px radii, sharp borders, no LastB2B chrome, no purple-blue gradient SaaS styling, no engagement-buying claims.
## Implementation Notes
- 2026-06-07 Implementation summary: Added a standalone public Liftline homepage at /liftline with a generated image-led hero, safe-growth positioning, workflow section, product preview, naming shortlist, and CTA into the existing Instagram growth desk. Added /liftline to AppShell chromeless routes and renamed the existing Instagram growth desk brand/title from Reachloop to Liftline for consistency.
- Files: src/app/liftline/page.tsx, src/app/liftline/liftline.module.css, public/liftline/hero-workspace.png, src/components/layout/app-shell.tsx, src/app/brands/[id]/instagram-growth/page.tsx, src/app/brands/[id]/instagram-growth/instagram-growth-client.tsx
- Components: LiftlineHomePage, Liftline homepage CSS module, AppShell chromeless route handling, InstagramGrowthPage metadata, InstagramGrowthClient brand lockup
- Assumptions used: The standalone public homepage should live at /liftline instead of replacing the existing LastB2B root homepage., Liftline is the best current product name for the standalone Instagram growth desk; alternatives remain documented but not implemented., The homepage CTA can link to the existing /brands/demo/instagram-growth preview route while real brand-specific routing remains unchanged., The generated hero image is a project-bound visual asset and should be stored under public/liftline rather than left only in the Codex generated-images directory.
## Doc Sync
- 2026-06-07 Synced after implementation.
- States touched: empty, partial
- Code touched: src/app/liftline/page.tsx, src/app/liftline/liftline.module.css, public/liftline/hero-workspace.png, src/components/layout/app-shell.tsx, src/app/brands/[id]/instagram-growth/page.tsx, src/app/brands/[id]/instagram-growth/instagram-growth-client.tsx
