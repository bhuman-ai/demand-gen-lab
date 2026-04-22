# Feature: social-discovery-youtube-redesign

## Request
Simplify the Accounts workspace further. The user says it feels bulky and like an account within a box. They want a sleek easy list of connected YouTube accounts with profile pic/name, plus a clear button to add another YouTube account. Needs-sign-in accounts should feel secondary, not dominate the screen.
## Autonomy Mode
holistic_autopilot
## Target Users
founder/operator
## Optimization Target
clarity and decision speed
## Hard Constraints
- Keep both automation and manual override paths covered.
- Support roughly 15 YouTube accounts without repetitive one-account-at-a-time setup dominating the main view.
- Default first screen must optimize for actionability under operator stress
- not completeness.
- Preserve queue/draft/account context across retries and partial failures.
- Make account health
- job health
- and channel health visibly different.
- Legacy Instagram and prompt setup may stay secondary or hidden
- but not lost.
## Scope
In scope: redesign Social Discovery around an automation-first YouTube workflow. Cover auto-comment queue management, watched-channel management, multi-account fleet management, manual search/post override, and failure recovery. Preserve existing behavior where needed, but rethink structure, grouping, hierarchy, and default navigation.

Out of scope for this redesign pass: changing core comment-generation logic, replacing account connection internals, or expanding beyond directly related YouTube/social discovery surfaces.
## Touched Surfaces
- social-discovery
- social-account-pool
## Success Moment
Operator opens Social Discovery and can immediately tell: what jobs are ready now, what is blocked, which account should act, and how to keep automation moving. They can approve or override one job fast, or jump into channels/accounts without losing the queue model.
## Failure Policy
Retry safe failures inline, preserve queue and draft context, pause or isolate failing accounts/jobs after repeated failure, and keep the rest of the automation moving.
## Primary Action
See the highest-priority comment opportunity, inspect it, and keep automation moving with one action: approve, edit, skip, pause, or reroute.
## Primary Risk
User cannot tell whether the system is healthy, which item needs intervention, or whether a failure came from the draft, the account, or the watched-channel pipeline.
## Information Budget
First viewport: one queue, one selected inspector, one visible system-health summary. Channels, accounts, manual search, and setup move into dedicated surfaces. No stacked mode cards as the dominant structure.
## View Model Contract
Primary user: founder/operator running YouTube auto-comment ops.
Current decision: what needs action now, and is automation healthy enough to keep running?
Why now: queue health and account health are time-sensitive; hidden failures compound fast.
Next action: review selected opportunity and either approve, edit, skip, pause, or reroute.
Top risk: mixing search, channels, accounts, setup, and posting into one undifferentiated page hides the real state of the system.
## Concept Options
### Concept A: One-page dashboard

Primary archetype: compact operations dashboard.
Primary action: scan top summaries, then act from mixed cards on one page.
Navigation model: one long page with sections.
What changes: keeps manual search, queue, channels, and accounts together; relies on collapse/expand to fight clutter.

```text
[Health strip][Ready][Failed][Accounts]
[Queue list................][Selected job......]
[Manual search.............][Channels..........]
[Accounts summary..........][Setup.............]
```

Pros: lowest migration cost, easy to compare sections quickly.
Cons: still mixes too many jobs in one view; 15-account scale will push it back into clutter.

### Concept B: Queue control tower

Primary archetype: moderation / ops queue with inspector.
Primary action: work the queue and keep automation healthy.
Navigation model: persistent nav with dedicated workspaces.
What changes: Queue becomes default. Channels, Accounts, and Manual Search get their own surfaces. One selected inspector handles most detailed work.

```text
[Nav: Queue | Channels | Accounts | Manual Search]
[Health strip: ready / blocked / failed / paused / active accounts]
---------------------------------------------------------------
| Queue filters + dense job list | Selected inspector          |
| Ready                          | Video                       |
| Needs review                   | Draft                       |
| Failed                         | Assigned account            |
| Scheduled / posted             | Risk + history              |
|                                | Approve / Edit / Skip / ... |
---------------------------------------------------------------
```

Pros: best hierarchy, cleanest default, scales to automation and 15 accounts, easiest failure handling.
Cons: bigger structural redesign.

### Concept C: Account fleet first

Primary archetype: fleet manager.
Primary action: manage capacity and health per account.
Navigation model: account lanes/cards first, queue secondary.
What changes: accounts become the home screen; jobs hang off each account.

```text
[Health strip][15 accounts][paused][rate-limited]
[Acct 1 lane][jobs][channels][status]
[Acct 2 lane][jobs][channels][status]
[Acct 3 lane][jobs][channels][status]
[selected account drawer........................]
```

Pros: strong for scaling account operations.
Cons: weak for content review and queue triage; operator can miss what needs action now.

### Recommendation

Recommend Concept B. It matches real task order: see queue, inspect one item, act, then move to channels/accounts only when needed.
## Concept Winner
Concept B: Queue control tower.

Why it wins:
- Best match for automation-first YouTube ops.
- Makes queue state primary, which is what operator must understand first.
- Scales better to roughly 15 accounts than the current mixed page.
- Gives channels, accounts, and manual override their own surfaces instead of burying them in one long page.
- Strongest failure handling because job health, account health, and channel health can stay distinct.

Implementation direction:
- Default workspace = Queue.
- Top health strip = ready, blocked, failed, paused, active accounts.
- Main split = dense queue list on left, selected inspector on right.
- Secondary nav = Channels, Accounts, Manual Search.
- Advanced setup = prompt + legacy Instagram only.
## Decisions
- Scope: In scope: Redesign the existing social discovery UI shown in this thread, focusing on the current brand/social discovery YouTube comment workflow screen. Preserve required functionality but rethink structure, hierarchy, and flow before coding. Out of scope: unrelated workflow changes beyond the touched surface and directly supporting behavior. (source: request_inference; why: Directly stated or tightly implied by the current request, so asking the human again would duplicate supplied intent.)
- Primary Action: founder/operator running comment drafting and posting workflows should be able to Redesign the existing social discovery UI shown in this thread, focusing on the current brand/social discovery YouTube comment workflow . Preserve required functionality but rethink structure, hierarchy, and before coding. from the first obvious interaction. (source: request_inference; why: Directly stated or tightly implied by the current request, so asking the human again would duplicate supplied intent.)
- Primary Risk: founder/operator running comment drafting and posting workflows should not have to guess what matters first or what can go wrong. (source: request_inference; why: Directly stated or tightly implied by the current request, so asking the human again would duplicate supplied intent.)
- Information Budget: Keep the first screen to one primary action, one primary risk, and one rationale. Hide audit detail behind explicit drilldowns. (source: request_inference; why: Directly stated or tightly implied by the current request, so asking the human again would duplicate supplied intent.)
- View Model Contract: Primary user: founder/operator running comment drafting and posting workflows
Current decision: Redesign the existing social discovery UI shown in this thread, focusing on the current brand/social discovery YouTube comment workflow . Preserve required functionality but rethink structure, hierarchy, and before coding.
Why now: founder/operator running comment drafting and posting workflows needs to see whether this flow works immediately.
Next action: Focus the default view on the dominant task instead of secondary system detail.
Top risk: founder/operator running comment drafting and posting workflows should not have to guess what matters first or what can go wrong. (source: request_inference; why: Directly stated or tightly implied by the current request, so asking the human again would duplicate supplied intent.)
- Success Moment: Redesign the existing social discovery UI shown in this thread. (source: request_inference; why: Directly stated or tightly implied by the current request, so asking the human again would duplicate supplied intent.)
- Technical Constraints: Web app with async API work plus background automation jobs. UI must support automatic commenting workflows, multi-account orchestration across roughly 15 YouTube accounts, real loading/error states, queue-safe retries, and account-level failure handling without losing context. (source: human)
- Volume & Density: High density (source: human)
- Failure Policy: Retry safe failures inline, preserve queue and draft context, pause or isolate failing accounts/jobs after repeated failure, and keep the rest of the automation moving. (source: human)
- Raw human context (2026-04-22): well yea but with understanding that we want to automate this thing so it auto comments for it. also i wanna add in so many more youtube accounts like 15 of them
## Open Questions
- Human concept choice still needed before code.
- Recommended winner is Concept B: Queue control tower.
- If approved, next pre-code step is persona walkthrough + critique on Concept B, then implementation.
## Design Notes
## Feature Inventory

| ID | Feature | Priority | Requirement | Notes |
|---|---|---|---|---|
| F01 | Review auto-comment queue | P0 | Must | Ready, blocked, failed, scheduled states |
| F02 | Inspect one opportunity deeply | P0 | Must | Video context, draft, account, risk, history |
| F03 | Approve/edit/skip/pause/reroute job | P0 | Must | One clear action path |
| F04 | Manage watched channels | P0 | Must | Add/remove, auto-comment toggle, latest upload state |
| F05 | Manage 15-account YouTube fleet | P0 | Must | Connect, health, role, cooldown, assignment visibility |
| F06 | Manual search and manual post override | P0 | Must | Search -> inspect -> draft -> post |
| F07 | Failure recovery | P0 | Must | Retry, pause account, reroute, preserve context |
| F08 | Delivery proof/history | P1 | Should | Last comment, link, scheduled reply, timestamps |
| F09 | Prompt/setup and legacy Instagram tools | P2 | Could | Secondary, hidden by default |

## Flow Inventory

| ID | Flow | Priority | Non-negotiable |
|---|---|---|---|
| FL01 | New upload becomes comment job -> user reviews selected job -> approve/edit/post | P0 | Yes |
| FL02 | Add watched channel -> assign automation behavior -> monitor channel state | P0 | Yes |
| FL03 | Add/connect/manage many YouTube accounts -> use them safely in queue | P0 | Yes |
| FL04 | Recover from failed job/account/channel without losing queue context | P0 | Yes |
| FL05 | Run manual search override -> pick video -> draft/post comment | P0 | Yes |

## Screen / Area Inventory

| Area | Purpose | Must contain |
|---|---|---|
| Queue | Current work | filters, job list, health summary |
| Inspector | Decision panel | video context, draft, account, action buttons |
| Channels | Automation coverage | watched list, last upload, auto-comment config |
| Accounts | Fleet management | 15-account health, capacity, connect/edit actions |
| Manual search | Override path | search, result list, selected video draft/post |
| Advanced setup | Secondary config | prompt, legacy Instagram |

## Coverage Matrix

| Item | A One-page dashboard | B Queue control tower | C Account fleet first |
|---|---|---|---|
| F01 Queue review | D | D | S |
| F02 Deep inspector | P | D | P |
| F03 Act on job | D | D | P |
| F04 Channels | S | D | S |
| F05 Accounts | S | D | D |
| F06 Manual override | S | D | H |
| F07 Failure recovery | P | D | P |
| F08 History/proof | S | D | S |
| F09 Setup | H | H | H |
| FL01 Review job | P | D | P |
| FL02 Manage channels | S | D | S |
| FL03 Manage many accounts | S | D | D |
| FL04 Recover failures | P | D | P |
| FL05 Manual override | S | D | H |

## Scorecard

| Concept | Coverage | Flow integrity | Clarity | Hierarchy | Density fit | Archetype fit | Risk | Total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| A One-page dashboard | 4 | 3 | 3 | 3 | 3 | 3 | 4 | 23 |
| B Queue control tower | 5 | 5 | 5 | 5 | 5 | 5 | 4 | 34 |
| C Account fleet first | 3 | 3 | 3 | 4 | 4 | 4 | 3 | 24 |

Gate result: Concept B strongest. Concept A too mixed. Concept C over-optimizes fleet management and weakens job review.
## Implementation Notes
- 2026-04-22 Implementation summary: Implemented the winning Queue control tower concept on the social discovery surface. The default page now uses workspace tabs for Queue, Channels, Accounts, and Manual search. Queue shows KPI ledger cards, queue filters, a dense jobs list, and an inspector panel for the selected post. Channels now lives in its own workspace with watched/auto-comment/error summaries and channel management. Accounts now has its own workspace for the multi-account YouTube fleet and embeds the existing social account pool panel. Manual search is secondary and routes selected search results through the same inspector. Advanced setup is collapsed into a dedicated drilldown section. Queue behavior now distinguishes post attention from channel attention so top-level counts route to the correct workspace, queue items are sorted by operational priority, and the selected job row has a stronger visual state.
- Files: src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- Components: SocialDiscoveryClient, SocialAccountPoolPanel, PageIntro, SectionPanel, StatLedger, EmptyState
- 2026-04-22 Implementation summary: Polished the Accounts workspace to reduce YouTube-account confusion. The global Accounts stat now reports connected YouTube accounts rather than every account tagged for YouTube. Posting and channel-assignment options now only include connected YouTube identities. The Accounts workspace itself is filtered to YouTube accounts, shows only connected vs needs-sign-in counts, hides unrelated non-YouTube accounts from the main list, and removes extra metrics that did not help the next action. The add-account area is reduced to a single YouTube action in this workspace.
- Files: src/app/brands/[id]/social-discovery/social-discovery-client.tsx, src/app/brands/[id]/social-discovery/social-account-pool-panel.tsx
- Components: SocialDiscoveryClient, SocialAccountPoolPanel, StatLedger, SectionPanel
- 2026-04-22 Implementation summary: Simplified the Accounts workspace from a stacked dashboard-plus-detail-card into a compact connected-accounts list. The parent Accounts view now removes the extra metric ledger and presents only the connected YouTube account list surface. Within the YouTube account pool panel, connected accounts are the default primary list with add and refresh actions in the header, sign-in-needed accounts move into a collapsed secondary section, and advanced controls are hidden until explicitly opened on one row. The always-visible selected-account box was removed from this YouTube view so the screen reads as one clean list instead of an account inside another account frame.
- Files: src/app/brands/[id]/social-discovery/social-account-pool-panel.tsx, src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- Components: SocialAccountPoolPanel, SocialDiscoveryClient, SectionPanel, EmptyState
## Doc Sync
- 2026-04-22 Synced after implementation.
- Code touched: src/app/brands/[id]/social-discovery/social-discovery-client.tsx
- 2026-04-22 Synced after implementation.
- Code touched: src/app/brands/[id]/social-discovery/social-discovery-client.tsx, src/app/brands/[id]/social-discovery/social-account-pool-panel.tsx
- 2026-04-22 Synced after implementation.
- Code touched: src/app/brands/[id]/social-discovery/social-account-pool-panel.tsx, src/app/brands/[id]/social-discovery/social-discovery-client.tsx
