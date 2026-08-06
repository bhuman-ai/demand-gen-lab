# Feature: TapIn YouTube eligibility

## Request

Use one inclusive 100-subscriber minimum throughout TapIn YouTube discovery, drafting, and posting. Preserve the existing UI.

## Mode

Patch.

## Target Users

TapIn campaign operators.

## Success Moment

A relevant channel with exactly 100 subscribers can enter the queue and proceed through drafting and dispatch; a channel with 99 cannot.

## Failure Policy

Fail closed when the subscriber count is missing or invalid. Keep the existing safety, freshness, relevance, pacing, and account checks intact.

## Primary Action

No new action. Operators continue using the existing campaign queue.

## Primary Risk

Frontend and backend eligibility drifting apart, or the provisioned SafeAgain seed identity leaking into BHuman discovery and generated comments.

## Information Budget

No additional UI information. This is a behavioral consistency patch.

## View Model Contract

- Primary user: TapIn campaign operator.
- Current decision: whether a discovered video is eligible for the existing queue.
- Rationale: channel has at least 100 subscribers and passes the existing relevance and safety checks.
- Next action: unchanged existing queue workflow.
- Top risk: wrong campaign identity or inconsistent subscriber boundaries.

## Concept Options

Not applicable in patch mode; no layout, interaction, or visual concept changes.

## Concept Winner

Preserve the existing surface and centralize eligibility behavior in shared code.

## Decisions

- Exactly 100 subscribers passes; 99 fails.
- Missing or invalid subscriber counts fail closed.
- Relevant, commentable YouTube matches graded `watch` or `target` may enter the queue; `skip` candidates may not.
- TapIn runtime uses the campaign identity saved in its prompt instead of inherited seed-brand semantics.
- Saving campaign settings invalidates the cached search strategy so changed topics take effect.
- Existing UI structure, controls, branding, and styles remain unchanged.

## Open Questions

None.

## Design Notes

No visual or interaction changes.

## Implementation Notes

- Shared subscriber eligibility is used by discovery, the campaign queue, manual drafting, and automatic dispatch.
- Runtime campaign context is used by search planning, relevance scoring, drafting, and delivery validation.
- Regression coverage includes the 99/100 boundary, seed-brand isolation, and personalized/personalization word forms.

## Doc Sync

Synced after implementation on 2026-08-06.
