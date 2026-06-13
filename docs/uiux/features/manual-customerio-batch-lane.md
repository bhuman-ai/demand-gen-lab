# Manual Customer.io Batch Lane

## Primary Action
Paste operator-supplied contacts, select a ready Customer.io sender, and queue a manual batch for dispatch.

## Primary Risk
The operator may believe mail is sending while a sender, global outbound flag, or Customer.io App API key blocks dispatch.

## Information Budget
- One launch form.
- One sender readiness panel.
- One recent-batches table.
- Rejected contacts stay behind a disclosure.

## View Model Contract
The surface answers: can I send today, from which sender, how many contacts are queued or sent, and have linked replies arrived?

## Implementation Notes
- Manual batches are normal campaign-owned outreach runs marked with `manual_batch:*`.
- Contact leads use `manual-batch:*` source markers so the dispatcher can distinguish operator-supplied contacts from autonomous sourced leads.
- Dispatch runs through a dedicated `manual_batch_dispatch` job that sends Customer.io transactional email in chunks and records normal run messages/events for reply attribution.
- Global outbound sending, Customer.io App API key presence, invalid/role/placeholder email suppression, and reply-to presence remain blocking.
