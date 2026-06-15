# Outbox V1 Policy Send

## Primary Action
Describe target prospects once, choose a sender, and let Outbox source prospects, resolve emails, and send only the currently allowed policy-capped volume. Manual people/email paste remains a fallback.

## Primary Risk
The operator could confuse held messages with sent messages if the UI does not separate sent, held, failed, and replies.

## Information Budget
- One sender policy strip.
- One launch form.
- One sender readiness panel.
- One recent-batches table.
- Rejected contacts stay behind a disclosure.

## View Model Contract
The surface answers: which sender is active, how much it can safely send now, how many messages were accepted by the provider, how many are held by policy, and whether replies arrived.

## Implementation Notes
- Outbox V1 is a separate code path from autonomous campaign preflight and EnrichAnything sourcing.
- It reuses existing outreach persistence tables for immediate deployability, marking runs with `outbox_v1:*` and messages with `generationMeta.outboxV1`.
- Exa is the default prospect discovery path. Operators describe the ICP, the server sources people/company-domain rows, Airscale resolves only high-confidence sendable work emails, and rejected rows stay visible after launch.
- The autonomous path runs from the internal ops cron when `OUTBOX_AUTOPILOT_ENABLED=true`. It first releases held Outbox messages when sender capacity opens, then sources a fresh batch only after cooldown and only when outbound sending plus sender policy allow sends.
- Autopilot configuration is env-driven: `OUTBOX_AUTOPILOT_BRAND_ID(S)`, `OUTBOX_AUTOPILOT_SENDER_ACCOUNT_ID`, `OUTBOX_AUTOPILOT_TARGET_AUDIENCE`, `OUTBOX_AUTOPILOT_SUBJECT`, `OUTBOX_AUTOPILOT_BODY`, `OUTBOX_AUTOPILOT_MAX_PROSPECTS`, `OUTBOX_AUTOPILOT_REQUESTED_SEND_NOW`, and `OUTBOX_AUTOPILOT_MIN_HOURS_BETWEEN_BATCHES`.
- Sender policy acts as a cap/hold governor, not an enrichment gate.
- A message becomes `sent` only after provider acceptance returns a provider message id and `sent_at` is written.
- Customer.io remains the first transport adapter; the outbox ledger is the app-level source of truth.
