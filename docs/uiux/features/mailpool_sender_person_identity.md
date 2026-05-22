# Feature: mailpool_sender_person_identity

## Request
Require Mailpool sender provisioning to collect and use a real person first and last name, separate from brand/internal account name, so outbound senders appear as people instead of brand labels.
## Autonomy Mode
holistic_autopilot
## Target Users
founder/operator provisioning outbound senders
## Optimization Target
Prevent accidental brand-name sender identities while keeping sender setup simple.
## Hard Constraints
- Do not default external sender identity to brand name
- domain
- or mailbox local-part.
- Require explicit human first and last name for Mailpool provisioning.
- Keep accountName as internal label only.
## Scope
Optimize for Prevent accidental brand-name sender identities while keeping sender setup simple.. Start with smallest coherent slice that proves Require Mailpool sender provisioning to collect and use a real person first and last name, separate from brand/internal account name, so outbound senders appear as people instead of brand labels..
## Touched Surfaces
- operator sender provisioning form
- outreach settings sender provisioning card
- Mailpool provisioning runtime
## Success Moment
[TODO] Define exact user outcome that proves this feature works.

## Failure Policy
[TODO] Describe recovery path on failure.

## Primary Action
founder/operator provisioning outbound senders should be able to Require Mailpool sender provisioning to collect and use a real person first and last name, separate from brand/internal account name, so outbound senders appear as people instead of brand labels. with one obvious first move.
## Primary Risk
founder/operator provisioning outbound senders should not have to guess what matters first or what can go wrong.
## Information Budget
First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown.
## View Model Contract
Primary user: founder/operator provisioning outbound senders
Current decision: Require Mailpool sender provisioning to collect and use a real person first and last name, separate from brand/internal account name, so outbound senders appear as people instead of brand labels.
Why now: founder/operator provisioning outbound senders needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: founder/operator provisioning outbound senders should not have to guess what matters first or what can go wrong.
## Concept Options
Option A: Add required Sender Person fields inline, Option B: Separate identity step before provisioning, Option C: Infer name from local-part or brand
## Concept Options

### Option A: Add required Sender Person fields inline
Primary action: enter sender email plus real first and last name in the same provisioning flow.
Primary risk: users may confuse sender identity with domain registrant identity.
Information budget: show only sender email, sender first name, sender last name in the sender section; keep registrant fields only for new-domain purchase.

### Option B: Separate identity step before provisioning
Primary action: confirm the human identity first, then choose domain/email.
Primary risk: adds another step and slows urgent sender setup.
Information budget: clearer separation, but more visible process.

### Option C: Infer name from local-part or brand
Primary action: no extra input.
Primary risk: repeats current failure by creating fake or brand-like display names.
Information budget: simplest UI, worst correctness.
## Concept Winner
Option A: Add required Sender Person fields inline. Sender email, sender first name, and sender last name are collected together; registrant identity stays separate for new-domain registration only.
## Concept Winner

Choose Option A: required Sender Person fields inline.

Rationale: this is the smallest systemic fix. It prevents brand-name Mailpool identities at the point of creation without adding a separate wizard step. The sender email and human display identity belong together; domain registrant identity remains separate and only appears for new-domain registration.

View model contract:
- Primary user: founder/operator provisioning outbound senders.
- Current decision: who should this mailbox appear to be from?
- Why now: sender display identity affects replies and trust immediately.
- Next action: enter a real first and last name before provisioning.
- Top risk: accidentally using brand, domain, or generic mailbox labels as the external sender identity.

Implementation rule: Mailpool provisioning must reject missing, generic, brand-derived, domain-derived, or account-label-derived sender names. Existing mailbox updates may only happen when an explicit first and last name is supplied.
## Decisions
- Scope: Optimize for Prevent accidental brand-name sender identities while keeping sender setup simple.. Start with smallest coherent slice that proves Require Mailpool sender provisioning to collect and use a real person first and last name, separate from brand/internal account name, so outbound senders appear as people instead of brand labels.. (source: agent_assumption; why: Autopilot inferred default for feature_scope from request, audience, optimization target, and mode.)
- Primary Action: founder/operator provisioning outbound senders should be able to Require Mailpool sender provisioning to collect and use a real person first and last name, separate from brand/internal account name, so outbound senders appear as people instead of brand labels. with one obvious first move. (source: agent_assumption; why: Autopilot inferred default for primary_action from request, audience, optimization target, and mode.)
- Primary Risk: founder/operator provisioning outbound senders should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for primary_risk from request, audience, optimization target, and mode.)
- Information Budget: First screen shows one primary decision, one primary risk, and one current rationale. Audit detail stays behind an explicit drilldown. (source: agent_assumption; why: Autopilot inferred default for information_budget from request, audience, optimization target, and mode.)
- View Model Contract: Primary user: founder/operator provisioning outbound senders
Current decision: Require Mailpool sender provisioning to collect and use a real person first and last name, separate from brand/internal account name, so outbound senders appear as people instead of brand labels.
Why now: founder/operator provisioning outbound senders needs immediate clarity on this flow.
Next action: Let Codex structure the surface around one dominant move.
Top risk: founder/operator provisioning outbound senders should not have to guess what matters first or what can go wrong. (source: agent_assumption; why: Autopilot inferred default for view_model_contract from request, audience, optimization target, and mode.)
- Concept Options: Option A: Add required Sender Person fields inline, Option B: Separate identity step before provisioning, Option C: Infer name from local-part or brand (source: agent_assumption; why: The design gate requires real concept alternatives before code. These cover inline, stepwise, and inference approaches.)
- Concept Winner: Option A: Add required Sender Person fields inline. Sender email, sender first name, and sender last name are collected together; registrant identity stays separate for new-domain registration only. (source: agent_assumption; why: Smallest coherent fix that prevents brand-name sender identities without adding another wizard step.)
- Raw agent context (2026-04-27): Chose inline required Sender Person fields as the minimal systemic fix for Mailpool provisioning.
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
- 2026-04-27 Implementation summary: Mailpool sender provisioning now treats external sender identity as explicit human first/last name data instead of deriving it from brand, domain, mailbox local-part, or internal account labels. Operator forms, settings provisioning UI, API payloads, and client types now collect and forward senderFirstName/senderLastName. Mailpool provisioning rejects brand/domain/generic mailbox names, creates or updates the Mailpool mailbox profile and signature with the person name, and defaults internal account labels to person-plus-email when the supplied label is brand/domain-like.
- Files: /Users/don/lastb2b/src/lib/outreach-provisioning.ts, /Users/don/lastb2b/src/lib/operator-tools.ts, /Users/don/lastb2b/src/lib/operator-runtime.ts, /Users/don/lastb2b/src/components/operator/operator-panel.tsx, /Users/don/lastb2b/src/app/api/brands/[brandId]/outreach/provision-sender/route.ts, /Users/don/lastb2b/src/lib/client-api.ts, /Users/don/lastb2b/src/app/settings/outreach/sender-provision-card.tsx
- Components: Mailpool sender provisioning, Operator provisioning form, Outreach sender settings card, Provision sender API/client
- Assumptions used: A real sender person must be supplied by the operator; the system should not invent human names for deliverability-sensitive mailboxes., Existing Mailpool mailboxes with bad names should be migrated only after the real person names are known.
- 2026-04-27 Implementation summary: Extended the sender identity system fix with a live-auditable operator script. The system now prevents new Mailpool provisioning from deriving sender display names from brands/domains/generic mailbox labels, collects real sender first/last names through Operator and Settings provisioning flows, updates existing Mailpool mailbox profile fields when re-provisioned with explicit names, and provides `npm run mailpool:identity-audit` to flag existing bad mailbox identities and apply explicit real-name mappings safely.
- Files: /Users/don/lastb2b/src/lib/outreach-provisioning.ts, /Users/don/lastb2b/src/lib/operator-tools.ts, /Users/don/lastb2b/src/lib/operator-runtime.ts, /Users/don/lastb2b/src/components/operator/operator-panel.tsx, /Users/don/lastb2b/src/app/api/brands/[brandId]/outreach/provision-sender/route.ts, /Users/don/lastb2b/src/lib/client-api.ts, /Users/don/lastb2b/src/app/settings/outreach/sender-provision-card.tsx, /Users/don/lastb2b/scripts/mailpool_sender_identity_audit.ts, /Users/don/lastb2b/package.json
- Components: Mailpool sender provisioning, Operator provisioning form, Outreach sender settings card, Provision sender API/client, Mailpool sender identity audit tooling
- Assumptions used: The system should require real sender names from operators and should not invent identities for live outbound mailboxes., Existing bad Mailpool display names should only be rewritten from explicit real-name mappings, while automated audit can detect unsafe brand/domain/generic identities.
## Doc Sync
- 2026-04-27 Synced after implementation.
- States touched: error
- Code touched: /Users/don/lastb2b/src/lib/outreach-provisioning.ts, /Users/don/lastb2b/src/lib/operator-tools.ts, /Users/don/lastb2b/src/lib/operator-runtime.ts, /Users/don/lastb2b/src/components/operator/operator-panel.tsx, /Users/don/lastb2b/src/app/api/brands/[brandId]/outreach/provision-sender/route.ts, /Users/don/lastb2b/src/lib/client-api.ts, /Users/don/lastb2b/src/app/settings/outreach/sender-provision-card.tsx
- 2026-04-27 Synced after implementation.
- States touched: error, partial
- Code touched: /Users/don/lastb2b/src/lib/outreach-provisioning.ts, /Users/don/lastb2b/src/lib/operator-tools.ts, /Users/don/lastb2b/src/lib/operator-runtime.ts, /Users/don/lastb2b/src/components/operator/operator-panel.tsx, /Users/don/lastb2b/src/app/api/brands/[brandId]/outreach/provision-sender/route.ts, /Users/don/lastb2b/src/lib/client-api.ts, /Users/don/lastb2b/src/app/settings/outreach/sender-provision-card.tsx, /Users/don/lastb2b/scripts/mailpool_sender_identity_audit.ts, /Users/don/lastb2b/package.json
