# Feature: youtube-discovery-watch-comment

## Request
Add a simple first-pass YouTube discovery flow for a growth operator: enter niche/search terms, find recent matching videos, inspect channel subscriber counts and basic relevance, and provide a simple click-to-comment action for selected results. Keep the UI low-clutter and beginner-friendly. Reuse existing watch/comment pipeline where possible. This is a Patch mode change unless the repo source of truth indicates otherwise.
## Autonomy Mode
guided
## Target Users
growth operator
## Optimization Target
decision speed and low cognitive load
## Hard Constraints
- Simple first implementation
- User wants button click to comment
- Reuse existing watches/comment pipeline if possible
## Scope
In scope now: simple YouTube-only discovery from niche search terms, show recent matching videos plus channel subscriber counts and basic relevance clues, allow one-click path into the existing manual comment composer, and allow watch-channel from a result. Out of scope for this first slice: full auto-comment on search results, advanced filters, bulk actions, redesigning the full social discovery architecture, and non-YouTube sources.
## Touched Surfaces
- youtube discovery
- social discovery
## Success Moment
User searches a niche term, sees recent YouTube videos with channel subscriber counts, picks one clear match, and posts a comment from the existing composer without leaving the flow.
## Failure Policy
Retry inline first. If YouTube search cannot load channel stats or post comments, keep the typed search/comment context visible, show the error in place, and route the user to add/connect a YouTube account if credentials are missing.
## Decisions
- Object Definition: Video lead (source: human)
- Magic Moment: User searches a niche, sees recent YouTube videos with channel subscriber counts, opens one obvious result, and clicks Comment on a good fit. (source: human)
- Scope: In scope now: simple YouTube-only discovery from niche search terms, show recent matching videos plus channel subscriber counts and basic relevance clues, allow one-click path into the existing manual comment composer, and allow watch-channel from a result. Out of scope for this first slice: full auto-comment on search results, advanced filters, bulk actions, redesigning the full social discovery architecture, and non-YouTube sources. (source: human)
- Raw human context (2026-04-20): growth operator finding channels to watch/comment from a niche, automatically commenting. search terms like we have for insta >> finds videos >> checks them >> comments if good. keep it simple for first implementation I want to click button to comment. Emergency override: implement now.
- Success Moment: User searches a niche term, sees recent YouTube videos with channel subscriber counts, picks one clear match, and posts a comment from the existing composer without leaving the flow. (source: agent_assumption; why: Matches the user's desired proof of value and keeps hierarchy focused on search -> pick -> comment.)
- Failure Policy: Retry inline first. If YouTube search cannot load channel stats or post comments, keep the typed search/comment context visible, show the error in place, and route the user to add/connect a YouTube account if credentials are missing. (source: agent_assumption; why: Simple recovery path for a first implementation.)
- Happy Paths: Enter niche search term, Run YouTube search, See recent video leads with subscriber counts, Open one result in the built-in comment composer, Edit or accept suggested draft, Click Post comment or Watch channel (source: agent_assumption; why: Minimal happy path for the requested feature.)
- Raw agent context (2026-04-20): Emergency override requested by user. Recording durable assumptions to unblock first-pass implementation.
## Open Questions
[TODO] Track unresolved blockers here.

## Design Notes
[TODO] Record layout, IA, and state-machine notes here.

## Implementation Notes
[TODO] Record final code-level outcome here.

## Doc Sync
[TODO] Record what source-of-truth docs were updated.
