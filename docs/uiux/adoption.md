# Existing Repo Adoption

## Bootstrap Summary
Current repo reality: LastB2B has already moved toward a chat-first Brand GPT home, but canonical docs and many pages still reflect older dashboard/social-discovery/product-admin assumptions. The reset adopts Agent home with drilldowns as the product grammar and migrates incrementally from existing routes/components rather than rewriting the app.
## Surface Inventory
- `/brands/:id`: Brand GPT / Agent home, primary workspace.
- `/brands/:id/inbox`: reply and draft drilldown.
- `/brands/:id/leads`: Audience drilldown for leads/prospects.
- `/brands/:id/network`: Delivery drilldown for senders/domains/routing.
- `/brands/:id/campaigns`: Outbound drilldown for production campaigns.
- `/brands/:id/experiments`: Tests drilldown for experiments/variants.
- `/brands/:id/social-discovery`: Social drilldown.
- `/settings/outreach`, `/logic`, `/doctor`: system/diagnostic surfaces.
- `/brands/new`: setup/intake surface that should feed Brand GPT context.
## Shared UI Inventory
- `src/components/layout/app-shell.tsx`: authenticated app shell and global brand nav.
- `src/components/layout/brand-switcher.tsx`: brand selector.
- `src/components/operator/operator-panel.tsx`: Brand GPT chat/drawer/inline thread UI.
- `src/components/ui/page-layout.tsx`: legacy page intro/panel/table/empty primitives.
- `src/components/ui/button.tsx`, `badge.tsx`, `input.tsx`, `textarea.tsx`, `select.tsx`: base controls.
- `src/app/globals.css`: semantic tokens, fonts, motion, brand wordmark styles.
- `src/components/ui/operator-workspace.tsx`: new shared primitives for the operator workspace grammar.
## Confidence Map
- High confidence: Brand GPT should be the default workspace, with drilldowns supporting the agent instead of competing with it.
- High confidence: Current route paths should stay stable during this reset to reduce product and QA risk.
- Medium confidence: Goals, Outbound, Tests, Audience, and Delivery are the right user-facing labels for the current route set.
- Lower confidence: Older page internals still use mixed dashboard and card structures; they need follow-up page-level migration.
- Stale: Social-discovery-first product assumptions from older docs should no longer drive default navigation or copy.

## Known Drift & Conflicts
- Canonical docs previously centered Social Discovery, conflicting with the actual Brand GPT product direction.
- Some route labels expose implementation nouns: missions, experiments, campaigns, doctor, logic.
- Existing pages mix chat-first surfaces with dashboard/card-heavy surfaces.
- Multiple local card/radius/panel treatments exist across settings, campaigns, missions, and social discovery.
- Navigation currently preserves old routes for compatibility, so vocabulary normalization should happen before deep route restructuring.
## Adoption Status
- Adopted: Brand GPT home, shared AppShell sidebar, OperatorPanel inline/drawer, activity/evidence disclosures.
- Migrating: brand navigation vocabulary, shared operator-workspace primitives, setup/intake pages.
- Baseline-only: campaigns, experiments, missions, social discovery, settings, delivery, inbox, leads pages still use mixed legacy page structures.
- Internal/advanced: Logic and Doctor should remain visually secondary unless explicitly opened.
