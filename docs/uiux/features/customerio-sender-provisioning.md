# Feature: customerio-sender-provisioning

## Request
Expose Customer.io sender domains as an agent-usable sending/provisioning option and update small settings copy so the UI no longer says Customer.io requires Namecheap.
## Autonomy Mode
holistic_autopilot
## Target Users
Founder/operator managing autonomous B2B outreach sender infrastructure
## Optimization Target
Make Customer.io selectable by the agent without making the UI more complex.
## Hard Constraints
[TODO] List hard constraints, non-negotiables, or compliance needs.

## Scope
Optimize for Make Customer.io selectable by the agent without making the UI more complex.. Start with smallest coherent slice that proves Expose Customer.io sender domains as an agent-usable sending/provisioning option and update small settings copy so the UI no longer says Customer.io requires Namecheap..
## Touched Surfaces
- Outreach settings sender provisioning
- Brand GPT/operator tool surface
## Success Moment
Founder/operator managing autonomous B2B outreach sender infrastructure completes Expose Customer.io sender domains as an agent-usable sending/provisioning option and update small settings copy so the UI no longer says Customer.io requires Namecheap. and sees explicit confirmation of successful outcome.
## Failure Policy
[TODO] Describe recovery path on failure.

## Primary Action
Founder/operator managing autonomous B2B outreach sender infrastructure should be able to Expose Customer.io sender domains as an agent-usable sending/provisioning option and update small settings copy so the UI no longer says Customer.io requires Namecheap. with one obvious first move.
## Primary Risk
Founder/operator managing autonomous B2B outreach sender infrastructure should not have to guess what matters first or what can go wrong.
## Information Budget
First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown.
## View Model Contract
Primary user: Founder/operator managing autonomous B2B outreach sender infrastructure
Current decision: Expose Customer.io sender domains as an agent-usable sending/provisioning option and update small settings copy so the UI no longer says Customer.io requires Namecheap.
Why now: Founder/operator managing autonomous B2B outreach sender infrastructure needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: Founder/operator managing autonomous B2B outreach sender infrastructure should not have to guess what matters first or what can go wrong.
## Concept Options
Option A - Rename-only patch: keep the existing sender provisioning surface unchanged and only remove Namecheap-specific wording. This minimizes UI churn but leaves Customer.io provisioning dependent on backend behavior.

Option B - Transport-as-tool patch: keep the existing UI structure, add Customer.io as an autonomous agent/growth tool, and update small settings copy from provider-specific Namecheap language to neutral registrar language. This preserves the current flow while making the agent capable of provisioning Customer.io senders through Vercel DNS.

Option C - New Customer.io setup wizard: create a dedicated Customer.io sender-domain wizard. This is clearer for manual setup but adds new UI surface area and is more than needed for the current goal.
## Concept Winner
Winner: Option B - Transport-as-tool patch.

Rationale: the user wants GPT/Brand GPT to operate Customer.io as another growth tool, not a new manual setup product surface. The UI should stay simple and only stop implying Customer.io requires Namecheap. Backend capability does the real work: Customer.io sender provisioning, registrar/DNS automation, exact-copy deliverability testing, and transport selection.
## Decisions
- Primary Action: Founder/operator managing autonomous B2B outreach sender infrastructure should be able to Expose Customer.io sender domains as an agent-usable sending/provisioning option and update small settings copy so the UI no longer says Customer.io requires Namecheap. with one obvious first move. (source: agent_assumption; why: Autopilot inferred default for primary_action from request, audience, optimization target, and mode.)
- Primary Risk: Founder/operator managing autonomous B2B outreach sender infrastructure should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for primary_risk from request, audience, optimization target, and mode.)
- Information Budget: First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown. (source: agent_assumption; why: Autopilot inferred default for information_budget from request, audience, optimization target, and mode.)
- View Model Contract: Primary user: Founder/operator managing autonomous B2B outreach sender infrastructure
Current decision: Expose Customer.io sender domains as an agent-usable sending/provisioning option and update small settings copy so the UI no longer says Customer.io requires Namecheap.
Why now: Founder/operator managing autonomous B2B outreach sender infrastructure needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: Founder/operator managing autonomous B2B outreach sender infrastructure should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for view_model_contract from request, audience, optimization target, and mode.)
- Scope: Optimize for Make Customer.io selectable by the agent without making the UI more complex.. Start with smallest coherent slice that proves Expose Customer.io sender domains as an agent-usable sending/provisioning option and update small settings copy so the UI no longer says Customer.io requires Namecheap.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
- Success Moment: Founder/operator managing autonomous B2B outreach sender infrastructure completes Expose Customer.io sender domains as an agent-usable sending/provisioning option and update small settings copy so the UI no longer says Customer.io requires Namecheap. and sees explicit confirmation of successful outcome. (source: agent_assumption; why: Autopilot inferred default for success_moment from request, audience, optimization target, and mode.)
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-05-25 Implementation summary: Added Customer.io as a first-class agent/growth-tool sender provisioning option. Customer.io provisioning can now use Vercel-managed domains and Vercel DNS record upserts instead of requiring Namecheap, while preserving the existing Mailpool path. Updated small settings copy so the UI refers to a domain registrar rather than Customer.io + Namecheap.
- Files: src/lib/vercel-domain-registrar.ts, src/lib/outreach-provisioning.ts, src/lib/operator-tools.ts, src/lib/operator-types.ts, src/lib/operator-runtime.ts, src/lib/growth-tool-registry.ts, src/lib/brand-activation-autopilot.ts, src/app/api/brands/[brandId]/outreach-account/route.ts, src/app/settings/outreach/sender-provision-card.tsx, src/app/settings/outreach/outreach-settings-client.tsx
- Components: Brand GPT operator tool catalog, Growth tool registry, Customer.io provisioning runtime, Vercel registrar helper, Outreach settings sender provisioning copy
- Assumptions used: Patch mode: no new Customer.io wizard, keep manual UI simple and put autonomy in Brand GPT tools., Vercel registrar mode should be used for Customer.io sender domains whenever OUTREACH_DOMAIN_REGISTRAR is not set to mailpool.
## Doc Sync
- 2026-05-25 Synced after implementation.
- States touched: partial, error
- Code touched: src/lib/vercel-domain-registrar.ts, src/lib/outreach-provisioning.ts, src/lib/operator-tools.ts, src/lib/operator-types.ts, src/lib/operator-runtime.ts, src/lib/growth-tool-registry.ts, src/lib/brand-activation-autopilot.ts, src/app/api/brands/[brandId]/outreach-account/route.ts, src/app/settings/outreach/sender-provision-card.tsx, src/app/settings/outreach/outreach-settings-client.tsx
