# Outbox V1 Policy Send

## Primary Action
Paste contacts, choose a sender, and send only the currently allowed policy-capped volume.

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
- Sender policy acts as a cap/hold governor, not an enrichment gate.
- A message becomes `sent` only after provider acceptance returns a provider message id and `sent_at` is written.
- Customer.io remains the first transport adapter; the outbox ledger is the app-level source of truth.
