# Feature: youtube-account-disconnected-row-status

## Request
If a YouTube account is disconnected or its OAuth token is expired/revoked, show it as disconnected in the visible Connected YouTube accounts list so the operator knows which account needs reconnection.
## Autonomy Mode
holistic_autopilot
## Target Users
Founder/operator managing YouTube Social Discovery accounts
## Optimization Target
Make reconnection needs obvious in the account row without adding clutter
## Hard Constraints
- Do not show expired/revoked YouTube OAuth accounts as Connected
- Keep the row action obvious: reconnect the broken account
- Preserve existing account connect/reconnect flow
## Scope
Add backend YouTube credential health to the social account list and render expired/revoked accounts as `Needs sign-in` directly in the visible YouTube rows.
## Touched Surfaces
- /brands/[id]/social-discovery YouTube account pool
## Success Moment
The operator can open the YouTube accounts list and immediately see which account needs reconnection without expanding another panel.

## Failure Policy
If the credential check fails or credentials are missing, the account defaults to `Needs sign-in` and keeps the existing reconnect action available.

## Primary Action
Reconnect the specific YouTube account whose token is dead.
## Primary Risk
An expired/revoked token being labeled `Connected`, causing the operator to think posting should work.
## Information Budget
Each row shows account identity, one plain status, and the reconnect action. Token diagnostics stay out of the default row.
## View Model Contract
Primary user: Founder/operator managing YouTube Social Discovery accounts
Current decision: which YouTube account needs reconnection.
Why now: posting and search recovery depend on valid account credentials.
Next action: click `Reconnect` on the row marked `Needs sign-in`.
Top risk: hiding a bad token behind a green connected state.
## Concept Options

1. Inline row status fix
- Keep every YouTube account in the visible account list.
- Replace the misleading `Connected` row state with `Needs sign-in` when credentials are missing or the YouTube refresh token is expired/revoked.
- Keep the existing `Reconnect` action as the primary next action for broken accounts.
- Keep advanced details behind the existing `Advanced` disclosure.

2. Separate disconnected-only panel
- Move expired/revoked accounts into the existing collapsed `Needs sign-in` group.
- Rejected because the user is looking at the visible list and needs the bad rows visible without opening a second section.

3. Add an account health dashboard
- Add counts, diagnostics, and token error history above the list.
- Rejected because the immediate job is identifying which row needs reconnection, not adding more operational UI.
## Concept Winner
Use option 1: inline row status fix.

Primary Action: reconnect the specific YouTube account whose token is dead.

Primary Risk: an expired/revoked token being labeled `Connected`, causing the operator to think posting should work.

Information Budget: each row shows account identity, one plain status, and the reconnect action. Token diagnostics stay out of the default row.

View Model Contract:
- Primary user: founder/operator managing YouTube Social Discovery accounts.
- Current decision: which YouTube account needs reconnection.
- Why now: posting and search recovery depend on valid account credentials.
- Next action: click `Reconnect` on the row marked `Needs sign-in`.
- Top risk: hiding a bad token behind a green connected state.

Implementation notes:
- Add backend credential-health metadata for YouTube accounts in the Social Discovery account pool API.
- Treat missing OAuth parts or Google refresh errors such as expired/revoked token as `needs_sign_in`.
- Keep accounts in the same visible list, but render broken rows with plain warning state instead of `Connected`.
## Decisions
- Scope: Add backend YouTube credential health to the social account list and render expired/revoked accounts as `Needs sign-in` directly in the visible YouTube rows. (source: agent_assumption; why: Smallest coherent slice that satisfies the request.)
- Primary Action: Reconnect the specific YouTube account whose token is dead. (source: agent_assumption; why: The row should make the next operator action obvious.)
- Primary Risk: An expired/revoked token being labeled `Connected`, causing the operator to think posting should work. (source: agent_assumption; why: This is the misleading state shown in the screenshot.)
- Information Budget: Each row shows account identity, one plain status, and the reconnect action. (source: agent_assumption; why: Token diagnostics would add clutter to the default list.)
- View Model Contract: Primary user: Founder/operator managing YouTube Social Discovery accounts
Current decision: which YouTube account needs reconnection.
Why now: posting and search recovery depend on valid account credentials.
Next action: click `Reconnect` on the row marked `Needs sign-in`.
Top risk: hiding a bad token behind a green connected state. (source: agent_assumption; why: The row status controls operator trust.)
## Open Questions
None.

## Design Notes
Use one visible YouTube account list. Remove the collapsed needs-sign-in subsection from the platform-filtered view. Keep Advanced collapsed.

## Implementation Notes
- 2026-04-30 Implementation summary: Added YouTube credential-health metadata to the social accounts API and changed the Social Discovery YouTube account list to show all YouTube accounts in one visible list. Rows with missing, expired, or revoked YouTube OAuth credentials now render `Needs sign-in` instead of `Connected`, while keeping the existing reconnect action on the same row. Removed the separate collapsed needs-sign-in section from the platform-filtered view so the operator can identify the broken account without opening another panel.
- Files: src/lib/factory-types.ts, src/lib/youtube.ts, src/app/api/outreach/accounts/route.ts, src/app/brands/[id]/social-discovery/social-account-pool-panel.tsx
- Components: Social Discovery YouTube account pool, Outreach accounts API, YouTube OAuth credential check, Outreach account model
- Assumptions used: An expired or revoked YouTube refresh token should be treated as needs sign-in even when the account still has a YouTube channel identity., The visible YouTube account list should include connected and broken accounts together because the user pointed at that list and needs row-level clarity., Detailed token error text should stay out of the default row; the row only needs a plain status and reconnect action.
## Doc Sync
- 2026-04-30 Synced after implementation.
- States touched: partial, error, loading
- Code touched: src/lib/factory-types.ts, src/lib/youtube.ts, src/app/api/outreach/accounts/route.ts, src/app/brands/[id]/social-discovery/social-account-pool-panel.tsx
