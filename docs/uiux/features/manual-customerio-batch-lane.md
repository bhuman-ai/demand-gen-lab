# Manual Customer.io Batch Lane

## Primary Action
Paste operator-supplied contacts, select a ready Customer.io sender, and send the first Customer.io chunk immediately.

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
- The launch request now claims the initial `manual_batch_dispatch` job inline so the first chunk is sent before the button returns; any remainder stays queued for the normal dispatcher.
- Global outbound sending, Customer.io App API key presence, invalid/role/placeholder email suppression, and reply-to presence remain blocking.

## Implementation Update
- 2026-06-14 immediate-manual-batch-dispatch: Manual batch launch now returns immediate dispatch counts (`sent`, `failed`, `canceled`, `remaining`) and the Send Mail surface reports actual first-chunk sends instead of only saying messages were queued.
